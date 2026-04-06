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
     * Autentica con username + password y devuelve un token Sanctum.
     */
    public function login(Request $request): JsonResponse
    {
        // Acepta JSON y también application/x-www-form-urlencoded (compatibilidad FastAPI)
        $username = $request->input('username');
        $password = $request->input('password');

        if (!$username || !$password) {
            return response()->json(['error' => 'Username y password son requeridos.'], 422);
        }

        $user = User::where('username', $username)->first();

        if (!$user || !Hash::check($password, $user->password_hash)) {
            return response()->json(['error' => 'Credenciales incorrectas.'], 401);
        }

        if (!$user->is_active) {
            return response()->json(['error' => 'La cuenta de usuario está desactivada.'], 403);
        }

        // Revocar tokens anteriores opcionales (uncomment si se desea sesión única)
        // $user->tokens()->delete();

        $token = $user->createToken('api-token')->plainTextToken;

        return response()->json([
            'access_token' => $token,  // compatibilidad FastAPI
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
     * Revoca el token actual del usuario autenticado.
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
     * Crea un nuevo usuario. Solo admins o si no existen usuarios todavía.
     */
    public function register(Request $request): JsonResponse
    {
        $currentUser = $request->user();

        // Verificar si es el primer usuario
        $userCount = User::count();
        $isFirstUser = $userCount === 0;

        $validated = $request->validate([
            'username' => 'required|string|max:255|unique:users,username,NULL,id,deleted_at,NULL',
            'password' => 'required|string|min:6',
            'is_admin' => 'sometimes|boolean',
        ]);

        // Solo el primer usuario, o un admin autenticado, puede crear cuentas de admin
        $isAdminRequest = $validated['is_admin'] ?? false;
        $canCreateAdmin = $isFirstUser || ($currentUser && $currentUser->is_admin);
        $finalIsAdmin = $isAdminRequest && $canCreateAdmin;

        // Si no hay usuarios, el primero siempre es admin por defecto
        if ($isFirstUser) {
            $finalIsAdmin = true;
        }

        // Si existe un usuario borrado lógicamente, lo restauramos
        $existingUser = User::withTrashed()->where('username', $validated['username'])->first();

        if ($existingUser && $existingUser->trashed()) {
            $existingUser->restore();
            $existingUser->password_hash = bcrypt($validated['password']);
            $existingUser->is_active = true;
            $existingUser->is_admin = $finalIsAdmin;
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
                'id'       => $user->id,
                'username' => $user->username,
                'is_active' => $user->is_active,
                'is_admin'  => $user->is_admin,
            ],
        ], 201);
    }

    /**
     * GET /auth/me
     * Devuelve el usuario autenticado actualmente.
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
     * HawCert notifica un cambio de credencial → actualiza login y contraseña de correo.
     * Protegido por secreto compartido (HAWCERT_SYNC_SECRET).
     */
    public function hawcertSync(Request $request): JsonResponse
    {
        $secret = env('HAWCERT_SYNC_SECRET', '');

        if ($secret === '' || $request->input('secret') !== $secret) {
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

        // Actualizar contraseña de login
        $user->password_hash = bcrypt($validated['password']);
        $user->save();

        // Sincronizar contraseña de correo en todas las cuentas del usuario
        $encryption = app(EncryptionService::class);
        Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->each(function (Account $account) use ($validated, $encryption) {
                $account->encrypted_password = $encryption->encrypt($validated['password']);
                $account->save();
            });

        return response()->json(['success' => true, 'message' => 'Credenciales sincronizadas correctamente.']);
    }
}
