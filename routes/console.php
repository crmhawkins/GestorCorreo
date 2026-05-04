<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;
use App\Models\Account;
use App\Models\AuditLog;
use App\Services\EncryptionService;
use App\Services\SyncService;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Sync automático — corre cada minuto, respeta auto_sync_interval por cuenta.
 * Ejecuta el sync directamente (sin queue) — no hay tabla jobs en esta instalación.
 * withoutOverlapping(30) evita que se solapen si una cuenta tarda mucho.
 */
Schedule::call(function () {
    $syncService = app(SyncService::class);
    $encryption  = app(EncryptionService::class);

    $accounts = Account::where('is_active', true)
        ->where('is_deleted', false)
        ->where('auto_sync_interval', '>', 0)
        ->get();

    foreach ($accounts as $account) {
        $cacheKey        = "last_sync_account_{$account->id}";
        $lastSync        = cache($cacheKey);
        $intervalMinutes = (int) $account->auto_sync_interval;
        $elapsed         = $lastSync ? now()->diffInMinutes($lastSync, true) : null;

        if ($elapsed !== null && $elapsed < $intervalMinutes) {
            continue;
        }

        $startedAt = now();
        try {
            $password = $encryption->decrypt($account->encrypted_password);
            $result   = $syncService->syncAccount($account, $password);

            cache([$cacheKey => now()], now()->addHours(24));

            AuditLog::create([
                'message_id'    => null,
                'action'        => 'background_sync',
                'payload'       => [
                    'account_id'    => $account->id,
                    'email_address' => $account->email_address,
                    'new_messages'  => $result['new_messages'] ?? 0,
                    'duration_ms'   => now()->diffInMilliseconds($startedAt),
                ],
                'status'        => $result['status'] ?? 'success',
                'error_message' => $result['error'] ?? null,
                'created_at'    => now(),
            ]);

            Log::info("Auto-sync OK: {$account->email_address} — " . ($result['new_messages'] ?? 0) . " nuevos");
        } catch (\Throwable $e) {
            Log::error("Auto-sync ERROR: {$account->email_address} — " . $e->getMessage());
        }
    }
})->everyMinute()->name('auto-sync-accounts')->withoutOverlapping(30);
