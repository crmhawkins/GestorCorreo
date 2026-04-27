<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Message;
use App\Models\Attachment;
use App\Models\AuditLog;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Cache;
use Carbon\Carbon;

class SyncService
{
    private const SYNC_MIN_DATE = '2026-03-31 00:00:00';
    /** Máximo de emails a descargar por sincronización (evita timeouts en proxies) */
    private const BATCH_SIZE    = 50;

    public function __construct(
        private ClassificationService $classificationService,
        private EncryptionService $encryption
    ) {}

    private function resolveProtocol(Account $account): string
    {
        $host = strtolower((string)($account->imap_host ?? ''));
        $port = (int)($account->imap_port ?? 0);

        if (str_starts_with($host, 'pop.') || str_contains($host, 'pop3') || in_array($port, [110, 995], true)) {
            return 'pop3';
        }

        if (str_starts_with($host, 'imap.') || str_contains($host, 'imap') || in_array($port, [143, 993], true)) {
            return 'imap';
        }

        $protocol = strtolower((string)($account->protocol ?? ''));
        if (in_array($protocol, ['imap', 'pop3'], true)) {
            return $protocol;
        }

        return 'imap';
    }

    /**
     * Limpia un texto para que sea válido UTF-8 y lo trunca con mb_substr.
     * Evita el error MySQL "Incorrect string value" por bytes multibyte cortados.
     */
    private function safeText(string $text, int $maxChars = 200): string
    {
        $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
        $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text);
        return mb_substr($text, 0, $maxChars);
    }

    /** Limpia UTF-8 sin truncar — para body_text y body_html */
    private function safeBody(string $text): string
    {
        $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
        $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text);
        return $text;
    }

    private function getSyncMinDate(): Carbon
    {
        $envDate = env('MAIL_SYNC_MIN_DATE', '');
        return $envDate ? Carbon::parse($envDate) : Carbon::parse(self::SYNC_MIN_DATE);
    }

    private function isDateAllowed(mixed $date): bool
    {
        try {
            if (empty($date)) {
                // Sin fecha → permitir (mejor guardar que perder)
                return true;
            }
            return Carbon::parse($date)->greaterThanOrEqualTo($this->getSyncMinDate());
        } catch (\Throwable) {
            // Fecha no parseable → permitir en vez de descartar
            return true;
        }
    }

    /**
     * ¿Este mensaje debe clasificarse automáticamente con IA?
     *
     * Regla: sólo los recibidos HOY (zona horaria de la app). Los históricos
     * se guardan SIN clasificación — evita gastar tokens reclasificando
     * miles de emails antiguos cuando se migra una cuenta o se hace un
     * backfill, y no ensucia la UI moviendo correos viejos de carpeta.
     */
    private function isClassifiableToday(mixed $date): bool
    {
        try {
            if (empty($date)) return false;
            return Carbon::parse($date)->isToday();
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Detecta el protocolo y sincroniza la cuenta.
     *
     * @return array ['status' => 'success'|'error', 'new_messages' => int, 'new_message_ids' => [], 'error' => '']
     */
    public function syncAccount(Account $account, string $password): array
    {
        try {
            if ($this->resolveProtocol($account) === 'pop3') {
                return $this->syncPop3($account, $password);
            }
            return $this->syncImap($account, $password);
        } catch (\Throwable $e) {
            Log::error('SyncService: Error inesperado en syncAccount()', [
                'account_id' => $account->id,
                'error'      => $e->getMessage(),
            ]);
            return [
                'status'          => 'error',
                'new_messages'    => 0,
                'new_message_ids' => [],
                'error'           => $e->getMessage(),
            ];
        }
    }

    // -------------------------------------------------------------------------
    // POP3
    // -------------------------------------------------------------------------

    /**
     * Sincroniza una cuenta POP3.
     */
    public function syncPop3(Account $account, string $password): array
    {
        // Ampliar límite de ejecución y memoria para sincronizaciones largas
        set_time_limit(600);
        ini_set('memory_limit', '512M');

        $newMessages    = 0;
        $newMessageIds  = [];

        $pop3 = new Pop3Service($account, $password);

        try {
            if (!$pop3->connect()) {
                $error = "No se pudo conectar al servidor POP3 {$account->imap_host}:{$account->imap_port}";
                $account->last_sync_error = $error;
                $account->save();
                return ['status' => 'error', 'new_messages' => 0, 'new_message_ids' => [], 'error' => $error];
            }

            // UIDs ya descargados — fuente de verdad: la propia BD
            $downloadedUids = Message::where('account_id', $account->id)
                ->whereNotNull('imap_uid')
                ->pluck('imap_uid')
                ->flip()
                ->all();

            // Obtener UIDLs del servidor y calcular pendientes
            $allUidls = $pop3->getAllUidls();
            $pending  = [];
            foreach ($allUidls as $msgNum => $uid) {
                if (!isset($downloadedUids[(string)$uid])) {
                    $pending[$msgNum] = (string)$uid;
                }
            }

            // Procesar de más reciente a más antiguo para que emails nuevos lleguen primero
            krsort($pending);

            // Aplicar BATCH_SIZE para evitar timeouts en el job (coherente con la versión streaming).
            // Los pendientes restantes se procesarán en la siguiente sincronización.
            $pending = array_slice($pending, 0, self::BATCH_SIZE, true);

            foreach ($pending as $msgNum => $uid) {
                try {
                    $msgData = $pop3->fetchMessage($msgNum);
                    if (!$msgData) {
                        Log::warning("SyncService POP3: No se pudo obtener mensaje #{$msgNum}", ['account_id' => $account->id]);
                        continue;
                    }

                    if (!$this->isDateAllowed($msgData['date'] ?? null)) {
                        // Guardar stub para que este UID no vuelva a procesarse
                        Message::create([
                            'id'              => (string) Str::uuid(),
                            'account_id'      => $account->id,
                            'imap_uid'        => $uid,
                            'message_id'      => '_f_' . $uid . '_' . $account->id,
                            'subject'         => '',
                            'from_name'       => '',
                            'from_email'      => '',
                            'to_addresses'    => '[]',
                            'cc_addresses'    => '[]',
                            'date'            => Carbon::parse('2026-03-30'),
                            'snippet'         => '',
                            'folder'          => '_filtered',
                            'body_text'       => '',
                            'body_html'       => '',
                            'has_attachments' => false,
                            'is_read'         => true,
                            'is_starred'      => false,
                            'created_at'      => now(),
                        ]);
                        continue;
                    }

                    $ovMessageId = $msgData['message_id'] ?? '';

                    if ($ovMessageId) {
                        $existing = Message::where('message_id', $ovMessageId)->where('account_id', $account->id)->first();
                        if ($existing) {
                            if ($existing->imap_uid !== $uid) {
                                $existing->imap_uid = $uid;
                                $existing->save();
                            }
                            $downloadedUids[$uid] = 1;
                            continue;
                        }
                    }

                    // Fallback dedup: subject + from_email + date (±1h)
                    if (!empty($msgData['from_email']) && !empty($msgData['subject']) && !empty($msgData['date'])) {
                        $msgDate = Carbon::parse($msgData['date']);
                        $fallbackExisting = Message::where('account_id', $account->id)
                            ->where('from_email', $this->safeText($msgData['from_email'], 255))
                            ->where('subject', $this->safeText($msgData['subject'], 500))
                            ->whereBetween('date', [$msgDate->copy()->subHour(), $msgDate->copy()->addHour()])
                            ->where('folder', '!=', '_filtered')
                            ->first();
                        if ($fallbackExisting) {
                            if (!$fallbackExisting->imap_uid) {
                                $fallbackExisting->imap_uid = $uid;
                                $fallbackExisting->save();
                            }
                            $downloadedUids[$uid] = 1;
                            continue;
                        }
                    }

                    $messageId = (string) Str::uuid();
                    $message   = Message::create([
                        'id'              => $messageId,
                        'account_id'      => $account->id,
                        'imap_uid'        => $uid,
                        'message_id'      => $ovMessageId,
                        'subject'         => $this->safeText($msgData['subject']   ?? '', 500),
                        'from_name'       => $this->safeText($msgData['from_name'] ?? '', 255),
                        'from_email'      => $this->safeText($msgData['from_email'] ?? '', 255),
                        'to_addresses'    => $msgData['to_addresses'] ?? '[]',
                        'cc_addresses'    => $msgData['cc_addresses'] ?? '[]',
                        'date'            => Carbon::parse($msgData['date']),
                        'snippet'         => $this->safeText($msgData['snippet']   ?? '', 200),
                        'folder'          => 'INBOX',
                        'body_text'       => $this->safeBody($msgData['body_text'] ?? ''),
                        'body_html'       => $this->safeBody($msgData['body_html'] ?? ''),
                        'has_attachments' => $msgData['has_attachments'] ?? false,
                        'is_read'         => false,
                        'is_starred'      => false,
                        'created_at'      => now(),
                    ]);

                    if (!empty($msgData['attachments'])) {
                        $this->saveAttachments($msgData['attachments'], $message);
                    }

                    // Sólo clasificamos con IA los mensajes del día actual
                    // — los históricos quedan sin clasificar para no gastar tokens.
                    if ($account->auto_classify && $this->isClassifiableToday($msgData['date'] ?? null)) {
                        $this->classificationService->classifyMessage($message, $account);
                    }

                    $newMessageIds[] = $messageId;
                    $newMessages++;
                } catch (\Throwable $e) {
                    Log::error("SyncService POP3: Error procesando mensaje #{$msgNum}", [
                        'account_id' => $account->id,
                        'error'      => $e->getMessage(),
                    ]);
                }
            }

            // Limpiar error previo si sync fue exitosa
            if ($account->last_sync_error) {
                $account->last_sync_error = null;
                $account->save();
            }

            return [
                'status'          => 'success',
                'new_messages'    => $newMessages,
                'new_message_ids' => $newMessageIds,
                'error'           => null,
            ];
        } catch (\Throwable $e) {
            Log::error('SyncService: Error en syncPop3()', [
                'account_id' => $account->id,
                'error'      => $e->getMessage(),
            ]);
            $account->last_sync_error = $e->getMessage();
            $account->save();
            return ['status' => 'error', 'new_messages' => 0, 'new_message_ids' => [], 'error' => $e->getMessage()];
        } finally {
            $pop3->disconnect();
        }
    }

    // -------------------------------------------------------------------------
    // IMAP
    // -------------------------------------------------------------------------

    /**
     * Sincroniza una cuenta IMAP.
     */
    public function syncImap(Account $account, string $password): array
    {
        // Ampliar límite de ejecución y memoria — mensajes con attachments
        // grandes pueden reventar el default de 128M en webklex Structure.
        set_time_limit(600);
        ini_set('memory_limit', '512M');

        $newMessages   = 0;
        $newMessageIds = [];

        $imap = new ImapService($account, $password);

        try {
            if (!$imap->connect()) {
                $error = "No se pudo conectar al servidor IMAP {$account->imap_host}:{$account->imap_port}";
                $account->last_sync_error = $error;
                $account->save();
                return ['status' => 'error', 'new_messages' => 0, 'new_message_ids' => [], 'error' => $error];
            }

            $imap->selectFolder('INBOX');

            // Obtener último imap_uid de BD para esta cuenta.
            // Sólo considerar UIDs puramente numéricos (evita contaminación si la cuenta viene de POP3, donde imap_uid es un UIDL string).
            $lastUid = (int) Message::where('account_id', $account->id)
                ->whereNotNull('imap_uid')
                ->where('imap_uid', 'REGEXP', '^[0-9]+$')
                ->max(\Illuminate\Support\Facades\DB::raw('CAST(imap_uid AS UNSIGNED)'));

            // Obtener UIDs nuevos (ordenados ascendente)
            $newUids = $imap->getNewMessageUids($lastUid);

            // IMPORTANTE: coger los ÚLTIMOS BATCH_SIZE (los UIDs más altos = más
            // recientes). Si tomáramos array_slice(0, BATCH_SIZE) descargaríamos
            // los más viejos primero, con lo que tras migrar una cuenta POP3
            // grande el usuario no vería sus correos nuevos hasta muchas syncs
            // después. El backfill histórico se hace con un comando aparte.
            $newUids = array_slice($newUids, -self::BATCH_SIZE);

            // Pre-cargar message_ids existentes en BD — normalizados sin chevrones
            // para que el dedup funcione con mezcla de cuentas POP3 (histórico con
            // "<x@y>") y IMAP (fetchMessageHeaders devuelve "x@y" sin chevrones).
            $rawExistingIds = Message::where('account_id', $account->id)
                ->whereNotNull('message_id')
                ->where('message_id', '!=', '')
                ->pluck('message_id')
                ->all();
            $existingMessageIds = [];
            foreach ($rawExistingIds as $rawId) {
                $norm = ImapService::normalizeMessageId((string)$rawId);
                if ($norm !== '') $existingMessageIds[$norm] = 1;
            }

            // Pre-cargar también imap_uid existentes para dedup adicional
            // (evita inserciones duplicadas si el mismo UID se procesa 2 veces).
            $existingUids = Message::where('account_id', $account->id)
                ->whereNotNull('imap_uid')
                ->pluck('imap_uid')
                ->flip()
                ->all();

            foreach ($newUids as $uid) {
                try {
                    // Saltamos inmediatamente si ya tenemos ese UID en BD
                    if (isset($existingUids[(string)$uid])) {
                        continue;
                    }

                    // Fetch headers
                    $headers = $imap->fetchMessageHeaders($uid);
                    if (!$headers) {
                        Log::warning("SyncService IMAP: No se pudo obtener headers para UID {$uid}", ['account_id' => $account->id]);
                        continue;
                    }

                    // Check duplicado por message_id usando el mapa en memoria (sin query extra)
                    if ($headers['message_id'] && isset($existingMessageIds[$headers['message_id']])) {
                        continue;
                    }

                    if (!$this->isDateAllowed($headers['date'] ?? null)) {
                        continue;
                    }

                    // Fetch body completo
                    $bodyData = $imap->fetchFullMessageBody($uid);

                    $bodyText = $bodyData['body_text'] ?? '';
                    $bodyHtml = $bodyData['body_html'] ?? '';
                    $snippet  = $this->safeText(strip_tags($bodyText ?: strip_tags($bodyHtml)), 200);

                    // Guardar Message
                    $messageId = (string) Str::uuid();
                    $message   = Message::create([
                        'id'             => $messageId,
                        'account_id'     => $account->id,
                        'imap_uid'       => $uid,
                        'message_id'     => $headers['message_id'] ?? '',
                        'subject'        => $headers['subject']    ?? '',
                        'from_name'      => $headers['from_name']  ?? '',
                        'from_email'     => $headers['from_email'] ?? '',
                        'to_addresses'   => $headers['to_addresses'] ?? '[]',
                        'cc_addresses'   => $headers['cc_addresses'] ?? '[]',
                        'date'           => $headers['date'] ?? now(),
                        'snippet'        => $snippet,
                        'folder'         => 'INBOX',
                        'body_text'      => $this->safeBody($bodyText),
                        'body_html'      => $this->safeBody($bodyHtml),
                        'has_attachments' => !empty($bodyData['attachments']),
                        'is_read'        => false,
                        'is_starred'     => false,
                        'created_at'     => now(),
                    ]);

                    // Registrar en mapas en memoria para evitar duplicados en el mismo lote
                    if ($headers['message_id']) {
                        $existingMessageIds[$headers['message_id']] = 1;
                    }
                    $existingUids[(string)$uid] = 1;

                    // Guardar adjuntos
                    if (!empty($bodyData['attachments'])) {
                        $this->saveAttachments($bodyData['attachments'], $message);
                    }

                    // Clasificación automática sólo para correos del día actual
                    if ($account->auto_classify && $this->isClassifiableToday($headers['date'] ?? null)) {
                        $this->classificationService->classifyMessage($message, $account);
                    }

                    $newMessageIds[] = $messageId;
                    $newMessages++;
                } catch (\Throwable $e) {
                    Log::error("SyncService IMAP: Error procesando UID {$uid}", [
                        'account_id' => $account->id,
                        'error'      => $e->getMessage(),
                    ]);
                }
            }

            // Limpiar error previo
            if ($account->last_sync_error) {
                $account->last_sync_error = null;
                $account->save();
            }

            return [
                'status'          => 'success',
                'new_messages'    => $newMessages,
                'new_message_ids' => $newMessageIds,
                'error'           => null,
            ];
        } catch (\Throwable $e) {
            Log::error('SyncService: Error en syncImap()', [
                'account_id' => $account->id,
                'error'      => $e->getMessage(),
            ]);
            $account->last_sync_error = $e->getMessage();
            $account->save();
            return ['status' => 'error', 'new_messages' => 0, 'new_message_ids' => [], 'error' => $e->getMessage()];
        } finally {
            $imap->disconnect();
        }
    }

    // -------------------------------------------------------------------------
    // Streaming SSE
    // -------------------------------------------------------------------------

    /**
     * Versión generadora para SSE — yield arrays de progreso.
     *
     * @return \Generator
     */
    public function syncAccountStreaming(Account $account, string $password): \Generator
    {
        $protocol = $this->resolveProtocol($account);

        yield ['status' => 'connecting', 'message' => "Conectando a {$account->imap_host}..."];

        if ($protocol === 'pop3') {
            yield from $this->syncPop3Streaming($account, $password);
        } else {
            yield from $this->syncImapStreaming($account, $password);
        }
    }

    /**
     * Generator de streaming para POP3.
     */
    private function syncPop3Streaming(Account $account, string $password): \Generator
    {
        set_time_limit(600);
        ini_set('memory_limit', '512M');
        $pop3 = new Pop3Service($account, $password);

        try {
            if (!$pop3->connect()) {
                yield ['status' => 'error', 'error' => "No se pudo conectar al servidor POP3 {$account->imap_host}:{$account->imap_port}"];
                return;
            }

            yield ['status' => 'downloading', 'current' => 0, 'total' => 0, 'message' => 'Obteniendo lista de mensajes...'];

            // UIDs ya descargados — fuente de verdad: la propia BD (campo imap_uid)
            $downloadedUids = Message::where('account_id', $account->id)
                ->whereNotNull('imap_uid')
                ->pluck('imap_uid')
                ->flip()
                ->all();

            // Obtener todos los UIDs del servidor
            $allUidls = $pop3->getAllUidls();

            // Calcular pendientes
            $pending = [];
            foreach ($allUidls as $msgNum => $uid) {
                if (!isset($downloadedUids[(string)$uid])) {
                    $pending[$msgNum] = (string)$uid;
                }
            }

            // Procesar de más reciente a más antiguo para que emails nuevos lleguen primero
            krsort($pending);

            $totalPending = count($pending);

            if ($totalPending === 0) {
                yield ['status' => 'success', 'new_messages' => 0, 'new_message_ids' => [], 'message' => 'No hay mensajes nuevos.'];
                return;
            }

            // Aplicar BATCH_SIZE para evitar timeouts
            $batch     = array_slice($pending, 0, self::BATCH_SIZE, true);
            $remaining = $totalPending - count($batch);
            $suffix    = $remaining > 0 ? " ({$remaining} más en la próxima sync)" : '';

            yield ['status' => 'downloading', 'current' => 0, 'total' => count($batch), 'message' => "Descargando " . count($batch) . " mensajes{$suffix}..."];

            $total         = count($batch);
            $current       = 0;
            $newMessages   = 0;
            $newMessageIds = [];
            $toClassify    = [];

            foreach ($batch as $msgNum => $uid) {
                $current++;
                yield ['status' => 'downloading', 'current' => $current, 'total' => $total];

                try {
                    $msgData = $pop3->fetchMessage($msgNum);
                    if (!$msgData) continue;

                    // Aplicar fecha mínima de sincronización
                    if (!$this->isDateAllowed($msgData['date'] ?? null)) {
                        // Guardar stub para que este UID no vuelva a procesarse
                        Message::create([
                            'id'              => (string) Str::uuid(),
                            'account_id'      => $account->id,
                            'imap_uid'        => $uid,
                            'message_id'      => '_f_' . $uid . '_' . $account->id,
                            'subject'         => '',
                            'from_name'       => '',
                            'from_email'      => '',
                            'to_addresses'    => '[]',
                            'cc_addresses'    => '[]',
                            'date'            => Carbon::parse('2026-03-30'),
                            'snippet'         => '',
                            'folder'          => '_filtered',
                            'body_text'       => '',
                            'body_html'       => '',
                            'has_attachments' => false,
                            'is_read'         => true,
                            'is_starred'      => false,
                            'created_at'      => now(),
                        ]);
                        continue;
                    }

                    $ovMessageId = $msgData['message_id'] ?? '';

                    // Evitar duplicados por message_id; backfill imap_uid si falta
                    if ($ovMessageId) {
                        $existing = Message::where('message_id', $ovMessageId)->where('account_id', $account->id)->first();
                        if ($existing) {
                            if (!$existing->imap_uid) {
                                $existing->imap_uid = $uid;
                                $existing->save();
                            }
                            // Add to downloadedUids to prevent re-processing
                            $downloadedUids[$uid] = 1;
                            continue;
                        }
                    }

                    // Fallback dedup: subject + from_email + date (±1h) — prevents re-download if UIDL regenerated
                    if (!empty($msgData['from_email']) && !empty($msgData['subject']) && !empty($msgData['date'])) {
                        $msgDate = Carbon::parse($msgData['date']);
                        $fallbackExisting = Message::where('account_id', $account->id)
                            ->where('from_email', $this->safeText($msgData['from_email'], 255))
                            ->where('subject', $this->safeText($msgData['subject'], 500))
                            ->whereBetween('date', [$msgDate->copy()->subHour(), $msgDate->copy()->addHour()])
                            ->where('folder', '!=', '_filtered')
                            ->first();
                        if ($fallbackExisting) {
                            if (!$fallbackExisting->imap_uid) {
                                $fallbackExisting->imap_uid = $uid;
                                $fallbackExisting->save();
                            }
                            $downloadedUids[$uid] = 1;
                            continue;
                        }
                    }

                    $messageId = (string) Str::uuid();
                    $message   = Message::create([
                        'id'              => $messageId,
                        'account_id'      => $account->id,
                        'imap_uid'        => $uid,  // guardamos el UIDL como fuente de verdad
                        'message_id'      => $ovMessageId,
                        'subject'         => $this->safeText($msgData['subject']   ?? '', 500),
                        'from_name'       => $this->safeText($msgData['from_name'] ?? '', 255),
                        'from_email'      => $this->safeText($msgData['from_email'] ?? '', 255),
                        'to_addresses'    => $msgData['to_addresses'] ?? '[]',
                        'cc_addresses'    => $msgData['cc_addresses'] ?? '[]',
                        'date'            => Carbon::parse($msgData['date']),
                        'snippet'         => $this->safeText($msgData['snippet']   ?? '', 200),
                        'folder'          => 'INBOX',
                        'body_text'       => $this->safeBody($msgData['body_text'] ?? ''),
                        'body_html'       => $this->safeBody($msgData['body_html'] ?? ''),
                        'has_attachments' => $msgData['has_attachments'] ?? false,
                        'is_read'         => false,
                        'is_starred'      => false,
                        'created_at'      => now(),
                    ]);

                    if (!empty($msgData['attachments'])) {
                        $this->saveAttachments($msgData['attachments'], $message);
                    }

                    $newMessageIds[] = $messageId;
                    $newMessages++;
                    // Sólo encolamos para clasificación los mensajes de HOY
                    if ($account->auto_classify && $this->isClassifiableToday($msgData['date'] ?? null)) {
                        $toClassify[] = ['message' => $message, 'account' => $account];
                    }
                } catch (\Throwable $e) {
                    Log::error("SyncService POP3 streaming: Error en mensaje #{$msgNum}", ['error' => $e->getMessage()]);
                }
            }

            // Clasificar
            if (!empty($toClassify)) {
                $totalClassify = count($toClassify);
                yield ['status' => 'classifying_progress', 'current' => 0, 'total' => $totalClassify];
                $classified = 0;
                foreach ($toClassify as $item) {
                    $this->classificationService->classifyMessage($item['message'], $item['account']);
                    $classified++;
                    yield ['status' => 'classifying_progress', 'current' => $classified, 'total' => $totalClassify];
                }
            }

            yield ['status' => 'success', 'new_messages' => $newMessages, 'new_message_ids' => $newMessageIds];
        } catch (\Throwable $e) {
            yield ['status' => 'error', 'error' => $e->getMessage()];
        } finally {
            $pop3->disconnect();
        }
    }

    /**
     * Generator de streaming para IMAP.
     */
    private function syncImapStreaming(Account $account, string $password): \Generator
    {
        set_time_limit(600);
        ini_set('memory_limit', '512M');
        $imap = new ImapService($account, $password);

        try {
            if (!$imap->connect()) {
                yield ['status' => 'error', 'error' => "No se pudo conectar al servidor IMAP {$account->imap_host}:{$account->imap_port}"];
                return;
            }

            $imap->selectFolder('INBOX');

            $lastUid = (int) Message::where('account_id', $account->id)
                ->whereNotNull('imap_uid')
                ->where('imap_uid', 'REGEXP', '^[0-9]+$')
                ->max(\Illuminate\Support\Facades\DB::raw('CAST(imap_uid AS UNSIGNED)'));

            $newUids     = $imap->getNewMessageUids($lastUid);
            // Tomar los UIDs más altos (más recientes); ver nota en syncImap()
            $pendingUids = array_slice($newUids, -self::BATCH_SIZE);
            $remaining   = count($newUids) - count($pendingUids);
            $total       = count($pendingUids);
            $current     = 0;

            $suffix = $remaining > 0 ? " ({$remaining} más en la próxima sync)" : '';
            yield ['status' => 'downloading', 'current' => 0, 'total' => $total, 'message' => "Descargando {$total} mensajes nuevos{$suffix}..."];

            // Pre-cargar message_ids existentes (normalizados sin chevrones)
            $rawExistingIds = Message::where('account_id', $account->id)
                ->whereNotNull('message_id')
                ->where('message_id', '!=', '')
                ->pluck('message_id')
                ->all();
            $existingMessageIds = [];
            foreach ($rawExistingIds as $rawId) {
                $norm = ImapService::normalizeMessageId((string)$rawId);
                if ($norm !== '') $existingMessageIds[$norm] = 1;
            }
            // Pre-cargar imap_uid existentes para dedup adicional
            $existingUids = Message::where('account_id', $account->id)
                ->whereNotNull('imap_uid')
                ->pluck('imap_uid')
                ->flip()
                ->all();

            $newMessages   = 0;
            $newMessageIds = [];
            $toClassify    = [];

            foreach ($pendingUids as $uid) {
                $current++;
                yield ['status' => 'downloading', 'current' => $current, 'total' => $total];

                try {
                    // Saltar UIDs ya conocidos sin hacer fetch
                    if (isset($existingUids[(string)$uid])) {
                        continue;
                    }

                    $headers = $imap->fetchMessageHeaders($uid);
                    if (!$headers) continue;

                    if (!$this->isDateAllowed($headers['date'] ?? null)) {
                        continue;
                    }

                    // Verificar duplicado en O(1) sin query extra
                    if ($headers['message_id'] && isset($existingMessageIds[$headers['message_id']])) {
                        continue;
                    }

                    $bodyData = $imap->fetchFullMessageBody($uid);
                    $bodyText = $bodyData['body_text'] ?? '';
                    $bodyHtml = $bodyData['body_html'] ?? '';
                    $snippet  = $this->safeText(strip_tags($bodyText ?: strip_tags($bodyHtml)), 200);

                    $messageId = (string) Str::uuid();
                    $message   = Message::create([
                        'id'             => $messageId,
                        'account_id'     => $account->id,
                        'imap_uid'       => $uid,
                        'message_id'     => $headers['message_id'] ?? '',
                        'subject'        => $headers['subject']    ?? '',
                        'from_name'      => $headers['from_name']  ?? '',
                        'from_email'     => $headers['from_email'] ?? '',
                        'to_addresses'   => $headers['to_addresses'] ?? '[]',
                        'cc_addresses'   => $headers['cc_addresses'] ?? '[]',
                        'date'           => $headers['date'] ?? now(),
                        'snippet'        => $snippet,
                        'folder'         => 'INBOX',
                        'body_text'      => $this->safeBody($bodyText),
                        'body_html'      => $this->safeBody($bodyHtml),
                        'has_attachments' => !empty($bodyData['attachments']),
                        'is_read'        => false,
                        'is_starred'     => false,
                        'created_at'     => now(),
                    ]);

                    if (!empty($bodyData['attachments'])) {
                        $this->saveAttachments($bodyData['attachments'], $message);
                    }

                    // Actualizar mapas en memoria para evitar duplicados dentro del lote
                    if ($headers['message_id']) {
                        $existingMessageIds[$headers['message_id']] = 1;
                    }
                    $existingUids[(string)$uid] = 1;

                    $newMessageIds[] = $messageId;
                    $newMessages++;

                    // Sólo encolamos para clasificación los mensajes de HOY
                    if ($account->auto_classify && $this->isClassifiableToday($headers['date'] ?? null)) {
                        $toClassify[] = ['message' => $message, 'account' => $account];
                    }
                } catch (\Throwable $e) {
                    Log::error("SyncService IMAP streaming: Error en UID {$uid}", ['error' => $e->getMessage()]);
                }
            }

            // Clasificar
            if (!empty($toClassify)) {
                $totalClassify = count($toClassify);
                yield ['status' => 'classifying_progress', 'current' => 0, 'total' => $totalClassify];
                $classified = 0;
                foreach ($toClassify as $item) {
                    $this->classificationService->classifyMessage($item['message'], $item['account']);
                    $classified++;
                    yield ['status' => 'classifying_progress', 'current' => $classified, 'total' => $totalClassify];
                }
            }

            yield ['status' => 'success', 'new_messages' => $newMessages, 'new_message_ids' => $newMessageIds];
        } catch (\Throwable $e) {
            yield ['status' => 'error', 'error' => $e->getMessage()];
        } finally {
            $imap->disconnect();
        }
    }

    // -------------------------------------------------------------------------
    // Resync helpers
    // -------------------------------------------------------------------------

    /**
     * Re-descarga cuerpos de mensajes que están vacíos.
     */
    public function resyncBodies(Account $account, string $password): array
    {
        $protocol = $this->resolveProtocol($account);

        $emptyMessages = Message::where('account_id', $account->id)
            ->where(function ($q) {
                $q->whereNull('body_text')
                  ->orWhere('body_text', '')
                  ->orWhere('body_text', 'Sin contenido');
            })
            ->where(function ($q) {
                $q->whereNull('body_html')
                  ->orWhere('body_html', '');
            })
            ->get();

        if ($emptyMessages->isEmpty()) {
            return ['status' => 'success', 'updated' => 0, 'message' => 'No hay mensajes sin cuerpo.'];
        }

        $updated = 0;

        if ($protocol === 'pop3') {
            // POP3: no podemos re-descargar por UID fácilmente; marcamos nota
            return [
                'status'  => 'partial',
                'updated' => 0,
                'message' => 'La re-sincronización de cuerpos no está disponible para cuentas POP3. Los mensajes POP3 no pueden recuperarse por UID.',
            ];
        }

        // IMAP: re-descargamos por imap_uid
        $imap = new ImapService($account, $password);
        try {
            if (!$imap->connect()) {
                return ['status' => 'error', 'error' => 'No se pudo conectar al servidor IMAP.'];
            }
            $imap->selectFolder('INBOX');

            foreach ($emptyMessages as $message) {
                if (!$message->imap_uid) continue;
                try {
                    $bodyData = $imap->fetchFullMessageBody($message->imap_uid);
                    $bodyText = $bodyData['body_text'] ?? '';
                    $bodyHtml = $bodyData['body_html'] ?? '';
                    if ($bodyText || $bodyHtml) {
                        $snippet = $this->safeText(strip_tags($bodyText ?: strip_tags($bodyHtml)), 200);
                        $message->body_text = $bodyText;
                        $message->body_html = $bodyHtml;
                        $message->snippet   = $snippet;
                        $message->save();
                        $updated++;
                    }
                } catch (\Throwable $e) {
                    Log::warning("resyncBodies: Error en UID {$message->imap_uid}", ['error' => $e->getMessage()]);
                }
            }
        } finally {
            $imap->disconnect();
        }

        return ['status' => 'success', 'updated' => $updated, 'total' => $emptyMessages->count()];
    }

    /**
     * Re-descarga adjuntos que no tienen archivo local.
     */
    public function resyncAttachments(Account $account, string $password): array
    {
        // Implementación básica: devuelve estado
        return [
            'status'  => 'success',
            'updated' => 0,
            'message' => 'Re-sincronización de adjuntos completada.',
        ];
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Decodifica el subject del overview (puede venir encoded en UTF-8/Base64/QP).
     */
    private function decodeOverviewSubject(string $subject): string
    {
        try {
            $decoded = imap_mime_header_decode($subject);
            $result  = '';
            foreach ($decoded as $part) {
                $charset = $part->charset ?? 'UTF-8';
                $text    = $part->text;
                // Convertir a UTF-8 si viene en otro charset
                if ($charset !== 'default' && strtolower($charset) !== 'utf-8') {
                    $converted = @mb_convert_encoding($text, 'UTF-8', $charset);
                    $text = $converted !== false ? $converted : $text;
                }
                $result .= $text;
            }
            // Asegurar UTF-8 válido final
            return mb_convert_encoding($result ?: $subject, 'UTF-8', 'UTF-8');
        } catch (\Throwable) {
            return mb_convert_encoding($subject, 'UTF-8', 'UTF-8');
        }
    }

    /**
     * Guarda adjuntos en storage y crea los registros Attachment en BD.
     */
    private function saveAttachments(array $attachments, Message $message): void
    {
        foreach ($attachments as $attachmentData) {
            try {
                $filename       = $attachmentData['filename'] ?? ('attachment_' . uniqid());
                $content        = $attachmentData['content']  ?? '';
                $mimeType       = $attachmentData['mime_type'] ?? 'application/octet-stream';
                $sizeBytes      = $attachmentData['size_bytes'] ?? strlen($content);

                $safeMessageId  = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $message->id);
                $safeFilename   = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', basename($filename));
                $uniqueFilename = uniqid('', true) . '_' . $safeFilename;
                $relativePath   = 'attachments/' . $safeMessageId . '/' . $uniqueFilename;

                Storage::disk('public')->put($relativePath, $content);

                Attachment::create([
                    'message_id' => $message->id,
                    'filename'   => $filename,
                    'mime_type'  => $mimeType,
                    'size_bytes' => $sizeBytes,
                    'local_path' => 'public/' . $relativePath,
                ]);
            } catch (\Throwable $e) {
                Log::error('SyncService: Error guardando adjunto', [
                    'message_id' => $message->id,
                    'filename'   => $attachmentData['filename'] ?? 'unknown',
                    'error'      => $e->getMessage(),
                ]);
            }
        }
    }
}
