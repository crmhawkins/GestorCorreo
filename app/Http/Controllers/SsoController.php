<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * SSO endpoint: recibe un token firmado por HMAC-SHA256 desde sistemas externos
 * (actualmente el CRM ivan) y, si valida, loguea al usuario sin pedir credenciales.
 *
 * Flujo:
 *   GET /sso?username=pepe@x.es&expires=1776263972&sig=HEX
 *   → valida la firma (secret en SSO_SHARED_SECRET, compartido con el CRM)
 *   → valida que no ha expirado
 *   → busca User por username
 *   → genera Sanctum token
 *   → devuelve vista que guarda token+user en localStorage y redirige a /
 */
class SsoController extends Controller
{
    public function handle(Request $request)
    {
        $username = (string) $request->query('username', '');
        $expires  = (int) $request->query('expires', 0);
        $sig      = (string) $request->query('sig', '');

        if ($username === '' || $expires === 0 || $sig === '') {
            return response('SSO: parámetros incompletos (username, expires, sig)', 400);
        }

        if (time() > $expires) {
            return response('SSO: token expirado', 410);
        }

        $secret = (string) env('SSO_SHARED_SECRET', '');
        if ($secret === '') {
            Log::error('SSO: SSO_SHARED_SECRET no configurado en .env');
            return response('SSO: servidor mal configurado', 500);
        }

        $expected = hash_hmac('sha256', $username . ':' . $expires, $secret);
        if (!hash_equals($expected, $sig)) {
            Log::warning('SSO: firma no válida', ['username' => $username]);
            return response('SSO: firma no válida', 403);
        }

        $user = User::where('username', $username)->first();
        if (!$user) {
            return response("SSO: usuario {$username} no existe en este gestor de correo", 404);
        }

        if (!$user->is_active) {
            return response('SSO: usuario inactivo', 403);
        }

        // Generar un Sanctum token como si fuera un login normal
        $token = $user->createToken('sso-' . now()->timestamp)->plainTextToken;

        Log::info('SSO: login correcto', ['username' => $username]);

        return view('sso', [
            'token' => $token,
            'user'  => [
                'id'       => $user->id,
                'username' => $user->username,
                'is_admin' => (bool) ($user->is_admin ?? false),
            ],
        ]);
    }
}
