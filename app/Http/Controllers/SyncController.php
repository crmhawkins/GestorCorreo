<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\AuditLog;
use App\Services\EncryptionService;
use App\Services\SyncService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

class SyncController extends Controller
{
    public function __construct(
        private SyncService $syncService,
        private EncryptionService $encryption
    ) {}

    /**
     * POST /sync/start
     * Lanza la sincronización de una cuenta y devuelve el resultado como JSON.
     */
    public function start(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'account_id' => 'required|integer',
        ]);

        $account = Account::where('id', $validated['account_id'])
            ->where('user_id', $user->id)
            ->where('is_deleted', false)
            ->where('is_active', true)
            ->first();

        if (!$account) {
            return response()->json(['error' => 'Cuenta no encontrada o inactiva.'], 404);
        }

        try {
            $password = $this->encryption->decrypt($account->encrypted_password);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'No se pudo desencriptar la contraseña: ' . $e->getMessage()], 500);
        }

        try {
            $result = $this->syncService->syncAccount($account, $password);
            return response()->json($result);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Error durante la sincronización: ' . $e->getMessage()], 500);
        }
    }

    /**
     * POST /sync/stream
     * SSE — emite eventos de progreso de sincronización en tiempo real.
     */
    public function stream(Request $request): StreamedResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'account_id' => 'nullable|integer',
        ]);

        $sse = [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ];

        $emit = function (array $payload) {
            echo "data: " . json_encode($payload) . "\n\n";
            if (ob_get_level() > 0) ob_flush();
            flush();
        };

        // Resolver cuentas a sincronizar
        if (!empty($validated['account_id'])) {
            $accounts = Account::where('id', $validated['account_id'])
                ->where('user_id', $user->id)
                ->where('is_deleted', false)
                ->where('is_active', true)
                ->get();
        } else {
            $accounts = Account::where('user_id', $user->id)
                ->where('is_deleted', false)
                ->where('is_active', true)
                ->get();
        }

        if ($accounts->isEmpty()) {
            return response()->stream(function () use ($emit) {
                $emit(['status' => 'error', 'error' => 'No hay cuentas activas para sincronizar.']);
            }, 200, $sse);
        }

        // Desencriptar contraseñas antes de abrir el stream
        $accountsWithPass = [];
        foreach ($accounts as $account) {
            try {
                $accountsWithPass[] = [
                    'account'  => $account,
                    'password' => $this->encryption->decrypt($account->encrypted_password),
                ];
            } catch (\Throwable $e) {
                $accountsWithPass[] = [
                    'account'  => $account,
                    'password' => null,
                    'error'    => $e->getMessage(),
                ];
            }
        }

        $syncService = $this->syncService;

        return response()->stream(function () use ($accountsWithPass, $syncService, $emit) {
            $totalAccounts = count($accountsWithPass);

            foreach ($accountsWithPass as $i => $item) {
                $account = $item['account'];

                if ($totalAccounts > 1) {
                    $emit(['status' => 'account_start', 'message' => "Sincronizando cuenta " . ($i + 1) . "/{$totalAccounts}: {$account->email_address}"]);
                }

                if (isset($item['error'])) {
                    $emit(['status' => 'error', 'error' => "No se pudo desencriptar la contraseña de {$account->email_address}: {$item['error']}"]);
                    continue;
                }

                foreach ($syncService->syncAccountStreaming($account, $item['password']) as $progress) {
                    $emit($progress);
                    if (($progress['status'] ?? '') === 'error' && $totalAccounts > 1) {
                        break;
                    }
                }
            }

            if ($totalAccounts > 1) {
                $emit(['status' => 'success', 'message' => "Todas las cuentas sincronizadas."]);
            }
        }, 200, $sse);
    }

    /**
     * POST /sync/resync-bodies
     * Re-descarga los cuerpos de mensajes que no tienen body_text ni body_html.
     */
    public function resyncBodies(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'account_id' => 'required|integer',
        ]);

        $account = Account::where('id', $validated['account_id'])
            ->where('user_id', $user->id)
            ->where('is_deleted', false)
            ->where('is_active', true)
            ->first();

        if (!$account) {
            return response()->json(['error' => 'Cuenta no encontrada o inactiva.'], 404);
        }

        try {
            $password = $this->encryption->decrypt($account->encrypted_password);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'No se pudo desencriptar la contraseña: ' . $e->getMessage()], 500);
        }

        try {
            $result = $this->syncService->resyncBodies($account, $password);
            return response()->json($result);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Error durante la re-sincronización de cuerpos: ' . $e->getMessage()], 500);
        }
    }

    /**
     * POST /sync/resync-attachments
     * Re-descarga los adjuntos de mensajes que no tienen archivos locales.
     */
    public function resyncAttachments(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'account_id' => 'required|integer',
        ]);

        $account = Account::where('id', $validated['account_id'])
            ->where('user_id', $user->id)
            ->where('is_deleted', false)
            ->where('is_active', true)
            ->first();

        if (!$account) {
            return response()->json(['error' => 'Cuenta no encontrada o inactiva.'], 404);
        }

        try {
            $password = $this->encryption->decrypt($account->encrypted_password);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'No se pudo desencriptar la contraseña: ' . $e->getMessage()], 500);
        }

        try {
            $result = $this->syncService->resyncAttachments($account, $password);
            return response()->json($result);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Error durante la re-sincronización de adjuntos: ' . $e->getMessage()], 500);
        }
    }

    /**
     * GET /sync/status
     * Devuelve las últimas 10 entradas de audit_logs con action='background_sync'.
     */
    public function status(Request $request): JsonResponse
    {
        $logs = AuditLog::where('action', 'background_sync')
            ->orderBy('created_at', 'desc')
            ->limit(10)
            ->get();

        return response()->json(['logs' => $logs]);
    }
}
