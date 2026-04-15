<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\User;
use App\Services\EncryptionService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    /**
     * POST /auth/login
     * Autentica validando contra IONOS POP3.
     * Si la contraseña es RESCUE_PASSWORD, permite entrar sin validar IONOS.
     */
    public function login(Request $request): JsonResponse
    {
        $username = $request->input('username');
        $password = $request->input('password');

        if (!$username || !$password) {
            return response()->json(['error' => 'Username y password son requeridos.'], 422);
        }

        $user = User::where('username', $username)->first();

        if (!$user) {
            return response()->json(['error' => 'Credenciales incorrectas.'], 401);
        }

        if (!$user->is_active) {
            return response()->json(['error' => 'La cuenta de usuario está desactivada.'], 403);
        }

        $rescuePassword = env('RESCUE_PASSWORD', '');
        $isRescue = $rescuePassword !== '' && $password === $rescuePassword;

        if (!$isRescue) {
            // Validar contra IONOS POP3
            $account = Account::where('user_id', $user->id)->where('is_deleted', false)->first();
            $imapHost = $account?->imap_host ?? 'pop.ionos.es';
            $imapPort = (int) ($account?->imap_port ?? 995);

            if (!$this->testPop3Connection($username, $password, $imapHost, $imapPort)) {
                return response()->json(['error' => 'Credenciales incorrectas.'], 401);
            }

            // Sincronizar encrypted_password con la contraseña que acaba de funcionar en IONOS
            $encryption = app(EncryptionService::class);
            Account::where('user_id', $user->id)
                ->where('is_deleted', false)
                ->each(function (Account $account) use ($password, $encryption) {
                    $account->encrypted_password = $encryption->encrypt($password);
                    $account->save();
                });

            // Mantener password_hash actualizado por si se necesita en el futuro
            $user->password_hash = bcrypt($password);
            $user->save();
        }

        $token = $user->createToken('api-token')->plainTextToken;

        return response()->json([
            'access_token' => $token,
            'token'        => $token,
            'token_type'   => 'bearer',
            'user'  => [
                'id'                     => $user->id,
                'username'               => $user->username,
                'is_active'              => $user->is_active,
                'is_admin'               => $user->is_admin,
                'mail_password_required' => (bool) $user->mail_password_required,
            ],
        ]);
    }

    /**
     * POST /auth/logout
     */
    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user) {
            $user->currentAccessToken()->delete();
        }

        return response()->json(['message' => 'Sesión cerrada correctamente.']);
    }

    /**
     * POST /auth/register
     * Crea un nuevo usuario validando primero que las credenciales funcionan en IONOS.
     */
    public function register(Request $request): JsonResponse
    {
        $currentUser = $request->user();

        $userCount = User::count();
        $isFirstUser = $userCount === 0;

        $validated = $request->validate([
            'username' => 'required|string|max:255|unique:users,username,NULL,id,deleted_at,NULL',
            'password' => 'required|string|min:6',
            'is_admin' => 'sometimes|boolean',
        ]);

        $rescuePassword = env('RESCUE_PASSWORD', '');
        $isRescue = $rescuePassword !== '' && $validated['password'] === $rescuePassword;

        if (!$isRescue) {
            // Validar contra IONOS antes de registrar
            if (!$this->testPop3Connection($validated['username'], $validated['password'], 'pop.ionos.es', 995)) {
                return response()->json(['error' => 'No se pudo conectar a IONOS con estas credenciales. Verifica tu usuario y contraseña de correo.'], 422);
            }
        }

        $isAdminRequest = $validated['is_admin'] ?? false;
        $canCreateAdmin = $isFirstUser || ($currentUser && $currentUser->is_admin);
        $finalIsAdmin = $isAdminRequest && $canCreateAdmin;

        if ($isFirstUser) {
            $finalIsAdmin = true;
        }

        $existingUser = User::withTrashed()->where('username', $validated['username'])->first();

        if ($existingUser && $existingUser->trashed()) {
            $existingUser->restore();
            $existingUser->password_hash = bcrypt($validated['password']);
            $existingUser->is_active = true;
            $existingUser->is_admin = $finalIsAdmin && $isFirstUser;
            $existingUser->save();
            $user = $existingUser;
        } else {
            $user = User::create([
                'username'      => $validated['username'],
                'password_hash' => bcrypt($validated['password']),
                'is_active'     => true,
                'is_admin'      => $finalIsAdmin,
            ]);
        }

        $token = $user->createToken('api-token')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user'  => [
                'id'        => $user->id,
                'username'  => $user->username,
                'is_active' => $user->is_active,
                'is_admin'  => $user->is_admin,
            ],
        ], 201);
    }

    /**
     * GET /auth/me
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['error' => 'No autenticado.'], 401);
        }

        return response()->json([
            'user' => [
                'id'                     => $user->id,
                'username'               => $user->username,
                'is_active'              => $user->is_active,
                'is_admin'               => $user->is_admin,
                'mail_password_required' => (bool) $user->mail_password_required,
            ],
        ]);
    }

    /**
     * POST /auth/hawcert-sync
     * HawCert notifica un cambio de credencial → actualiza contraseña de correo.
     */
    public function hawcertSync(Request $request): JsonResponse
    {
        $secret = env('HAWCERT_SYNC_SECRET', '');

        if ($secret === '' || !hash_equals($secret, (string) $request->input('secret', ''))) {
            return response()->json(['error' => 'No autorizado.'], 401);
        }

        $validated = $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $user = User::where('username', $validated['username'])->first();

        if (!$user) {
            return response()->json(['error' => 'Usuario no encontrado en GestorCorreo.'], 404);
        }

        $user->password_hash = bcrypt($validated['password']);
        $user->save();

        $encryption = app(EncryptionService::class);
        Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->each(function (Account $account) use ($validated, $encryption) {
                $account->encrypted_password = $encryption->encrypt($validated['password']);
                $account->save();
            });

        return response()->json(['success' => true, 'message' => 'Credenciales sincronizadas correctamente.']);
    }

    /**
     * Prueba una conexión POP3 real con las credenciales dadas.
     * Devuelve true si la autenticación es exitosa.
     */
    private function testPop3Connection(string $username, string $password, string $host, int $port): bool
    {
        try {
            // Puerto estándar POP3S es 995.
            $isSsl = ($port === 995);
            $transport = $isSsl ? 'tls' : 'tcp';
            $target = sprintf('%s://%s:%d', $transport, $host, $port);

            $ctx = stream_context_create([
                'ssl' => [
                    'verify_peer'       => false,
                    'verify_peer_name'  => false,
                    'allow_self_signed' => true,
                ],
            ]);

            $socket = @stream_socket_client($target, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
            if (!is_resource($socket)) {
                return false;
            }

            stream_set_timeout($socket, 15);

            $line = fgets($socket, 512);
            if (!$line || !str_starts_with(trim($line), '+OK')) {
                fclose($socket);
                return false;
            }

            fwrite($socket, "USER {$username}\r\n");
            $line = fgets($socket, 512);
            if (!$line || !str_starts_with(trim($line), '+OK')) {
                fclose($socket);
                return false;
            }

            fwrite($socket, "PASS {$password}\r\n");
            $line = fgets($socket, 512);
            fwrite($socket, "QUIT\r\n");
            fclose($socket);

            return str_starts_with(trim($line), '+OK');
        } catch (\Throwable $e) {
            return false;
        }
    }
}
