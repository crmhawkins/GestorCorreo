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
        if (!$this->client || !$this->client->isConnected()) return [];
        try {
            // Asegurar que INBOX (o la carpeta seleccionada) está abierto en el servidor.
            $folderName = $this->currentFolderName ?: 'INBOX';
            $this->client->openFolder($folderName);

            $protocol = $this->client->getConnection();
            $from = max(1, $lastUid + 1);

            // SEARCH UID {$from}:* — devuelve lista de UIDs sin descargar headers.
            // IMAP::ST_UID hace que el comando sea "UID SEARCH" y los resultados
            // sean UIDs en lugar de message sequence numbers.
            $response = $protocol->search(['UID', "{$from}:*"], \Webklex\PHPIMAP\IMAP::ST_UID);
            $data = $response->validatedData();

            if (!is_array($data)) return [];

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
            Log::error('Error descargando UIDs:', ['error' => $e->getMessage()]);
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
                'message_id'   => $this->normalizeMessageId((string)$message->getMessageId()),
                'subject'      => $this->decodeMimeHeader((string)$message->getSubject()),
                'from_name'    => $this->decodeMimeHeader((string)($message->getFrom()[0]->personal ?? '')),
                'from_email'   => (string)($message->getFrom()[0]->mail ?? ''),
                'to_addresses' => json_encode($this->parseAddresses($message->getTo())),
                'cc_addresses'   => json_encode($this->parseAddresses($message->getCc())),
                'date'         => Carbon::parse($message->getDate())->utc(),
                'snippet'      => '',
            ];
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * Normaliza un Message-Id RFC822: elimina chevrones y espacios envolventes.
     * POP3 (parser propio) lo guardaba tal cual, webklex lo entrega con <...>.
     * Almacenar SIEMPRE sin chevrones permite dedup consistente entre ambos.
     */
    public static function normalizeMessageId(string $messageId): string
    {
        $messageId = trim($messageId);
        if ($messageId === '') return '';
        return trim($messageId, "<> \t\r\n");
    }

    /**
     * Decodifica headers MIME tipo =?UTF-8?Q?...?= o =?UTF-8?B?...?=.
     * webklex getSubject() a veces devuelve el valor codificado tal cual,
     * especialmente cuando el subject está partido en varias piezas encoded.
     */
    private function decodeMimeHeader(string $value): string
    {
        if ($value === '') return '';

        // Si no hay marca de codificación MIME, devolver tal cual.
        if (!str_contains($value, '=?')) {
            return $value;
        }

        // iconv_mime_decode respeta encodings múltiples en una misma cadena.
        if (function_exists('iconv_mime_decode')) {
            $decoded = @iconv_mime_decode($value, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
            if ($decoded !== false && $decoded !== '') {
                return $decoded;
            }
        }

        if (function_exists('mb_decode_mimeheader')) {
            $decoded = @mb_decode_mimeheader($value);
            if ($decoded !== '') {
                return $decoded;
            }
        }

        return $value;
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
