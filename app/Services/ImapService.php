<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Log;
use Webklex\PHPIMAP\Client;
use Webklex\PHPIMAP\ClientManager;

class ImapService
{
    private ?Client $client = null;
    private $account;
    private string $password;
    private string $currentFolderName = '';

    public function __construct($account, string $password)
    {
        $this->account  = $account;
        $this->password = $password;
    }

    /**
     * Conectar al servidor con LOGS DETALLADOS.
     */
    public function connect(int $maxRetries = 3): bool
    {
        Log::info('--- INICIANDO DIAGNÓSTICO DE CONEXIÓN IMAP ---');
        Log::info('Entorno PHP:', [
            'version' => PHP_VERSION,
            'imap_extension_detectada' => function_exists('imap_open') ? 'SÍ' : 'NO',
            'allow_url_fopen' => ini_get('allow_url_fopen') ? 'SÍ' : 'NO',
        ]);

        $cm = new ClientManager();
        
        $encryption = 'ssl';
        if ((int)$this->account->imap_port === 143) {
            $encryption = 'notls';
        }

        $config = [
            'host'          => $this->account->imap_host,
            'port'          => (int)$this->account->imap_port,
            'encryption'    => $encryption,
            'validate_cert' => false,
            'username'      => $this->account->username,
            'password'      => '********', // Oculta por seguridad
            'protocol'      => 'imap',
            'timeout'       => 60,
        ];

        Log::info('Configuración que estamos enviando:', $config);

        // Intentar la conexión real
        $this->client = $cm->make(array_merge($config, ['password' => $this->password]));

        try {
            $this->client->connect();
            Log::info('¡ÉXITO! Conexión IMAP establecida correctamente.');
            return true;
        } catch (\Exception $e) {
            Log::error('ERROR CRÍTICO DE CONEXIÓN IMAP:', [
                'mensaje' => $e->getMessage(),
                'archivo' => $e->getFile(),
                'linea'   => $e->getLine(),
                'traza'   => substr($e->getTraceAsString(), 0, 500) . '...' // Solo los 500 primeros chars
            ]);

            // Comprobar si es un problema de red externo
            $this->checkServerConnectivity($this->account->imap_host, (int)$this->account->imap_port);

            return false;
        }
    }

    private function checkServerConnectivity($host, $port)
    {
        Log::info("Comprobando si el servidor puede llegar a {$host}:{$port}...");
        $connection = @fsockopen($host, $port, $errno, $errstr, 5);
        if (is_resource($connection)) {
            Log::info("TCP Check: El servidor TIENE acceso físico a {$host}:{$port}.");
            fclose($connection);
        } else {
            Log::error("TCP Check: El servidor NO puede llegar a {$host}:{$port}. Motivo: ({$errno}) {$errstr}");
        }
    }

    public function disconnect(): void
    {
        if ($this->client) {
            try {
                $this->client->disconnect();
            } catch (\Exception $e) {}
        }
    }

    public function selectFolder(string $folder = 'INBOX'): bool
    {
        if (!$this->client || !$this->client->isConnected()) return false;
        $this->currentFolderName = $folder;
        return true;
    }

    /**
     * Devuelve los UIDs (ordenados asc) de los mensajes con UID > $lastUid.
     *
     * Evitamos la API WhereQuery de webklex porque:
     *  - whereUidGreaterThan() NO existe en php-imap 6.x.
     *  - whereUid("X:*") se escapa entre comillas en generate_query() → IMAP BAD.
     *  - ->all()->get() descarga headers completos y es muy lento en buzones
     *    grandes (>1 min para 6k mensajes), colgando el sync.
     *
     * Alternativa: hablamos al IMAP a pelo via $protocol->search(['UID','X:*']).
     * Eso manda SEARCH UID X:* al servidor y recibe una lista de UIDs sin
     * descargar nada más. Comparable a lo que hacen Thunderbird/Outlook.
     */
    public function getNewMessageUids(int $lastUid = 0): array
    {
        if (!$this->client) {
            Log::warning('getNewMessageUids: client null');
            return [];
        }
        if (!$this->client->isConnected()) {
            Log::warning('getNewMessageUids: client not connected');
            return [];
        }
        try {
            // Asegurar que INBOX (o la carpeta seleccionada) está abierto en el servidor.
            $folderName = $this->currentFolderName ?: 'INBOX';
            $this->client->openFolder($folderName);

            $protocol = $this->client->getConnection();
            $from = max(1, $lastUid + 1);

            // SEARCH UID {$from}:* — devuelve lista de UIDs. IMAP::ST_UID indica
            // que queremos UIDs de vuelta en lugar de message sequence numbers.
            $response = $protocol->search(['UID', "{$from}:*"], \Webklex\PHPIMAP\IMAP::ST_UID);
            $data = $response->validatedData();

            Log::info('getNewMessageUids: SEARCH UID result', [
                'lastUid' => $lastUid,
                'from'    => $from,
                'raw_type' => gettype($data),
                'raw_count' => is_array($data) ? count($data) : 'n/a',
                'raw_sample' => is_array($data) ? array_slice($data, -5) : $data,
            ]);

            if (!is_array($data)) {
                return [];
            }

            $uids = [];
            foreach ($data as $id) {
                $uid = (int) $id;
                if ($uid > $lastUid) {
                    $uids[] = $uid;
                }
            }
            $uids = array_values(array_unique($uids));
            sort($uids);
            return $uids;
        } catch (\Exception $e) {
            Log::error('Error descargando UIDs:', [
                'error' => $e->getMessage(),
                'trace' => substr($e->getTraceAsString(), 0, 500),
            ]);
            return [];
        }
    }

    public function fetchMessageHeaders(int $uid): ?array
    {
        try {
            $folder = $this->client->getFolder($this->currentFolderName ?: 'INBOX');
            $message = $folder->query()->whereUid($uid)->get()->first();
            if (!$message) return null;

            return [
                'uid'          => $uid,
                'message_id'   => (string)$message->getMessageId(),
                'subject'      => (string)$message->getSubject(),
                'from_name'    => (string)($message->getFrom()[0]->personal ?? ''),
                'from_email'   => (string)($message->getFrom()[0]->mail ?? ''),
                'to_addresses' => json_encode($this->parseAddresses($message->getTo())),
                'cc_addresses'   => json_encode($this->parseAddresses($message->getCc())),
                'date'         => Carbon::parse($message->getDate()),
                'snippet'      => '',
            ];
        } catch (\Exception $e) {
            return null;
        }
    }

    public function fetchFullMessageBody(int $uid): ?array
    {
        try {
            $folder = $this->client->getFolder($this->currentFolderName ?: 'INBOX');
            $message = $folder->query()->whereUid($uid)->get()->first();
            if (!$message) return null;

            $attachments = [];
            foreach ($message->getAttachments() as $at) {
                $attachments[] = [
                    'filename'   => $at->getName(),
                    'mime_type'  => $at->getMimeType() ?? 'application/octet-stream',
                    'content'    => $at->getContent(),
                    'size_bytes' => strlen($at->getContent()),
                ];
            }

            return [
                'body_text'   => (string)$message->getTextBody(),
                'body_html'   => (string)$message->getHtmlBody(),
                'attachments' => $attachments,
            ];
        } catch (\Exception $e) {
            return null;
        }
    }

    private function parseAddresses($addressCollection): array
    {
        $res = [];
        foreach ($addressCollection as $addr) {
            $res[] = [
                'name'  => (string)$addr->personal,
                'email' => (string)$addr->mail
            ];
        }
        return $res;
    }
}
