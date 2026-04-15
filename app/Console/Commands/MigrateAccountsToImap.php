<?php

namespace App\Console\Commands;

use App\Models\Account;
use App\Models\AuditLog;
use App\Services\EncryptionService;
use App\Services\ImapService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Migra cuentas POP3 → IMAP.
 *
 * Por defecto hace DRY-RUN: sólo muestra qué cambiaría, no toca la BD.
 * Usa --execute para aplicar los cambios de verdad.
 *
 * Ejemplos:
 *   php artisan accounts:migrate-to-imap                              # lista cuentas POP3 sin tocar nada
 *   php artisan accounts:migrate-to-imap --account=5                  # dry-run de la cuenta 5
 *   php artisan accounts:migrate-to-imap --account=5 --execute        # migra la cuenta 5
 *   php artisan accounts:migrate-to-imap --all --execute              # migra TODAS las POP3
 *   php artisan accounts:migrate-to-imap --account=5 --imap-host=imap.hawkins.es --imap-port=993 --execute
 */
class MigrateAccountsToImap extends Command
{
    protected $signature = 'accounts:migrate-to-imap
                            {--account= : ID de la cuenta a migrar (omitir y usar --all para todas las POP3)}
                            {--all : Migrar todas las cuentas POP3 activas}
                            {--imap-host= : Host IMAP de destino (si no, se infiere del host actual)}
                            {--imap-port=993 : Puerto IMAP (993 por defecto)}
                            {--execute : APLICAR los cambios (sin esto, sólo dry-run)}
                            {--force : No pedir confirmación interactiva}';

    protected $description = 'Migra una cuenta (o todas) de POP3 a IMAP, verificando la conexión antes de aplicar cambios.';

    public function handle(EncryptionService $encryption): int
    {
        $accountId = $this->option('account');
        $all       = (bool) $this->option('all');
        $execute   = (bool) $this->option('execute');
        $force     = (bool) $this->option('force');
        $imapHost  = $this->option('imap-host');
        $imapPort  = (int) $this->option('imap-port');

        if (!$accountId && !$all) {
            $this->error('Debes especificar --account=ID o --all.');
            $this->line('');
            $this->line('Ejemplos:');
            $this->line('  php artisan accounts:migrate-to-imap --account=5                # dry-run');
            $this->line('  php artisan accounts:migrate-to-imap --account=5 --execute      # aplicar');
            $this->line('  php artisan accounts:migrate-to-imap --all --execute            # todas');
            return self::FAILURE;
        }

        $query = Account::where('is_active', true)->where('is_deleted', false);

        if ($accountId) {
            $query->where('id', (int) $accountId);
        } else {
            // Seleccionar sólo cuentas POP3 (por protocolo explícito o por puerto típico POP3)
            $query->where(function ($q) {
                $q->where('protocol', 'pop3')
                  ->orWhereIn('imap_port', [110, 995])
                  ->orWhere(function ($q2) {
                      $q2->where('imap_host', 'like', 'pop.%')
                         ->orWhere('imap_host', 'like', 'pop3.%')
                         ->orWhere('imap_host', 'like', '%.pop.%')
                         ->orWhere('imap_host', 'like', '%pop3%');
                  });
            });
        }

        $accounts = $query->get();

        if ($accounts->isEmpty()) {
            $this->warn('No hay cuentas que coincidan con el filtro.');
            return self::SUCCESS;
        }

        $this->info(sprintf('Encontradas %d cuenta(s) a procesar. Modo: %s',
            $accounts->count(),
            $execute ? 'EJECUCIÓN REAL' : 'DRY-RUN (sin cambios)'
        ));
        $this->line('');

        // Mostrar tabla previa
        $rows = [];
        foreach ($accounts as $a) {
            $rows[] = [
                $a->id,
                $a->email_address,
                $a->imap_host,
                $a->imap_port,
                $a->protocol ?? '?',
                $imapHost ?: $this->inferImapHost($a->imap_host),
                $imapPort,
            ];
        }
        $this->table(
            ['ID', 'Email', 'Host actual', 'Puerto', 'Proto', 'Host nuevo', 'Puerto nuevo'],
            $rows
        );

        if ($execute && !$force) {
            if (!$this->confirm('¿Aplicar estos cambios a la base de datos?', false)) {
                $this->warn('Cancelado.');
                return self::SUCCESS;
            }
        }

        $ok      = 0;
        $failed  = 0;
        $skipped = 0;

        foreach ($accounts as $account) {
            $this->line('');
            $this->line("─── Cuenta #{$account->id} — {$account->email_address} ───");

            $originalHost = $account->imap_host;
            $originalPort = (int) $account->imap_port;
            $originalProto = $account->protocol;

            $newHost = $imapHost ?: $this->inferImapHost($originalHost);
            $newPort = $imapPort;

            $this->line("  Host:     {$originalHost}  →  {$newHost}");
            $this->line("  Puerto:   {$originalPort}  →  {$newPort}");
            $this->line("  Proto:    " . ($originalProto ?: '?') . "  →  imap");

            // Desencriptar password
            try {
                $password = $encryption->decrypt($account->encrypted_password);
            } catch (\Throwable $e) {
                $this->error("  ✗ No se pudo desencriptar la contraseña: {$e->getMessage()}");
                $failed++;
                continue;
            }

            // Probar conexión IMAP ANTES de tocar nada
            $this->line('  → Probando conexión IMAP...');
            $testAccount = clone $account;
            $testAccount->imap_host = $newHost;
            $testAccount->imap_port = $newPort;
            $testAccount->protocol  = 'imap';

            $imap = new ImapService($testAccount, $password);
            $connected = false;
            try {
                $connected = $imap->connect();
            } catch (\Throwable $e) {
                $this->error("  ✗ Excepción al conectar: {$e->getMessage()}");
            }

            if (!$connected) {
                $this->error("  ✗ No se pudo conectar a {$newHost}:{$newPort} con IMAP.");
                $this->warn('     Puedes reintentar pasando --imap-host=<host-correcto> manualmente.');
                try { $imap->disconnect(); } catch (\Throwable) {}
                $failed++;
                continue;
            }

            // Verificar que INBOX existe y se puede listar
            try {
                $imap->selectFolder('INBOX');
                $uids = $imap->getNewMessageUids(0);
                $this->line('  ✓ Conexión OK. INBOX tiene ' . count($uids) . ' mensajes.');
            } catch (\Throwable $e) {
                $this->error("  ✗ Conexión OK pero no se pudo listar INBOX: {$e->getMessage()}");
                try { $imap->disconnect(); } catch (\Throwable) {}
                $failed++;
                continue;
            } finally {
                try { $imap->disconnect(); } catch (\Throwable) {}
            }

            if (!$execute) {
                $this->info('  ✓ Dry-run: la cuenta es migrable. No se ha tocado la BD.');
                $skipped++;
                continue;
            }

            // Aplicar cambios en transacción
            try {
                DB::transaction(function () use ($account, $newHost, $newPort, $originalHost, $originalPort, $originalProto) {
                    $account->imap_host = $newHost;
                    $account->imap_port = $newPort;
                    $account->protocol  = 'imap';
                    $account->last_sync_error = null;
                    $account->save();

                    // Auditar el cambio
                    AuditLog::create([
                        'message_id'    => null,
                        'action'        => 'migrate_to_imap',
                        'payload'       => [
                            'account_id'   => $account->id,
                            'email'        => $account->email_address,
                            'from_host'    => $originalHost,
                            'from_port'    => $originalPort,
                            'from_proto'   => $originalProto,
                            'to_host'      => $newHost,
                            'to_port'      => $newPort,
                            'to_proto'     => 'imap',
                        ],
                        'status'        => 'success',
                        'error_message' => null,
                        'created_at'    => now(),
                    ]);
                });

                // Invalidar cache del scheduler para esta cuenta → sync inmediato en el próximo tick
                cache()->forget("last_sync_account_{$account->id}");

                $this->info('  ✓ Migrada. Los mensajes POP3 existentes siguen en la BD (dedup por message_id).');
                $this->line('    El próximo auto-sync empezará IMAP desde UID 0 y omitirá duplicados.');
                Log::info('MigrateAccountsToImap: Cuenta migrada', [
                    'account_id' => $account->id,
                    'email'      => $account->email_address,
                    'from'       => "{$originalHost}:{$originalPort}",
                    'to'         => "{$newHost}:{$newPort}",
                ]);
                $ok++;
            } catch (\Throwable $e) {
                $this->error("  ✗ Error aplicando cambios: {$e->getMessage()}");
                Log::error('MigrateAccountsToImap: Error aplicando cambios', [
                    'account_id' => $account->id,
                    'error'      => $e->getMessage(),
                ]);
                $failed++;
            }
        }

        $this->line('');
        $this->line('─── Resumen ───');
        $this->line("  Migradas:  {$ok}");
        $this->line("  Dry-run:   {$skipped}");
        $this->line("  Fallidas:  {$failed}");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * Infiere el host IMAP a partir del host POP3.
     * Reglas:
     *   pop.dominio.com   → imap.dominio.com
     *   pop3.dominio.com  → imap.dominio.com
     *   mail.dominio.com  → mail.dominio.com (muchos proveedores lo soportan en ambos)
     *   otro              → mismo host
     */
    private function inferImapHost(string $host): string
    {
        $host = strtolower($host);
        if (str_starts_with($host, 'pop3.')) {
            return 'imap.' . substr($host, 5);
        }
        if (str_starts_with($host, 'pop.')) {
            return 'imap.' . substr($host, 4);
        }
        return $host; // mail.X, smtp.X raros, y cualquier cosa custom: dejamos igual
    }
}
