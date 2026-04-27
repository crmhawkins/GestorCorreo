<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\Message;
use App\Models\Attachment;
use App\Models\Classification;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

class MessageController extends Controller
{
    public function unreadCounts(Request $request): JsonResponse
    {
        $user = $request->user();
        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $countsByFolder = Message::whereIn('account_id', $accountIds)
            ->where('is_read', false)
            ->selectRaw('folder, COUNT(*) as total')
            ->groupBy('folder')
            ->pluck('total', 'folder');

        $labelCounts = Classification::query()
            ->join('messages', 'messages.id', '=', 'classifications.message_id')
            ->whereIn('messages.account_id', $accountIds)
            ->where('messages.is_read', false)
            ->whereNotNull('classifications.final_label')
            ->selectRaw('classifications.final_label as label, COUNT(*) as total')
            ->groupBy('classifications.final_label')
            ->pluck('total', 'label');

        return response()->json([
            'all' => (int)(Message::whereIn('account_id', $accountIds)
                ->where('is_read', false)
                ->where('folder', 'INBOX')
                ->count()),
            'starred' => (int)Message::whereIn('account_id', $accountIds)
                ->where('is_read', false)
                ->where('is_starred', true)
                ->count(),
            'Interesantes' => (int)($labelCounts['Interesantes'] ?? 0),
            'Servicios' => (int)($labelCounts['Servicios'] ?? 0),
            'EnCopia' => (int)($labelCounts['EnCopia'] ?? 0),
            'Sent' => (int)($countsByFolder['Sent'] ?? 0),
            'SPAM' => (int)($labelCounts['SPAM'] ?? 0),
            'deleted' => (int)($countsByFolder['deleted'] ?? 0),
            'labels' => $labelCounts,
        ]);
    }

    /**
     * GET /messages
     * Lista mensajes con filtros: account_id, folder, category, search, page.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'account_id' => 'sometimes|integer',
            'folder'     => 'sometimes|string',
            'category'   => 'sometimes|string',
            'label'      => 'sometimes|string',
            'search'     => 'sometimes|string|max:255',
            'page'       => 'sometimes|integer|min:1',
            'starred'    => 'sometimes|boolean',
            'deleted'    => 'sometimes|boolean',
            'is_read'    => 'sometimes|boolean',
            'date_from'  => 'sometimes|date',
            'date_to'    => 'sometimes|date',
        ]);

        // Obtener IDs de cuentas del usuario
        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $query = Message::with(['classification', 'attachments'])
            ->whereIn('account_id', $accountIds);

        // Filtro por cuenta específica
        if (!empty($validated['account_id'])) {
            if (!$accountIds->contains($validated['account_id'])) {
                return response()->json(['error' => 'Cuenta no autorizada.'], 403);
            }
            $query->where('account_id', $validated['account_id']);
        }

        // Filtro por carpeta
        if (!empty($validated['folder'])) {
            $query->where('folder', $validated['folder']);
        }

        $category = $validated['category'] ?? $validated['label'] ?? null;
        if (!empty($category)) {
            $query->whereHas('classification', function ($q) use ($validated) {
                $q->where('final_label', $validated['category'] ?? $validated['label']);
            });
        }

        if (array_key_exists('starred', $validated)) {
            $query->where('is_starred', (bool)$validated['starred']);
        }

        if (array_key_exists('is_read', $validated)) {
            $query->where('is_read', (bool)$validated['is_read']);
        }

        if (array_key_exists('deleted', $validated)) {
            $query->where('folder', (bool)$validated['deleted'] ? 'deleted' : 'INBOX');
        }

        if (!empty($validated['date_from'])) {
            $query->where('date', '>=', $validated['date_from']);
        }

        if (!empty($validated['date_to'])) {
            $query->where('date', '<=', $validated['date_to'] . ' 23:59:59');
        }

        // Búsqueda por asunto o remitente
        if (!empty($validated['search'])) {
            $escaped = str_replace(['%', '_'], ['\\%', '\\_'], $validated['search']);
            $search = '%' . $escaped . '%';
            $query->where(function ($q) use ($search) {
                $q->where('subject', 'like', $search)
                  ->orWhere('from_name', 'like', $search)
                  ->orWhere('from_email', 'like', $search);
            });
        }

        $query->orderBy('date', 'desc');

        $perPage  = 50;
        $page     = $validated['page'] ?? 1;
        $paginated = $query->paginate($perPage, ['*'], 'page', $page);

        // Devolver array directo de mensajes (compatibilidad frontend)
        return response()->json($paginated->items());
    }

    /**
     * GET /messages/{id}
     * Detalle completo del mensaje con classification y attachments.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $message = Message::with(['classification', 'attachments'])
            ->whereIn('account_id', $accountIds)
            ->find($id);

        if (!$message) {
            return response()->json(['error' => 'Mensaje no encontrado.'], 404);
        }

        // Devolver objeto directo (compatibilidad frontend)
        return response()->json($message);
    }

    /**
     * PUT /messages/{id}/read
     * Actualiza el estado is_read del mensaje.
     */
    public function markRead(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'is_read' => 'required|boolean',
        ]);

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $message = Message::whereIn('account_id', $accountIds)->find($id);

        if (!$message) {
            return response()->json(['error' => 'Mensaje no encontrado.'], 404);
        }

        $message->is_read = $validated['is_read'];
        $message->save();

        return response()->json([
            'message' => 'Estado de lectura actualizado.',
            'id'      => $message->id,
            'is_read' => $message->is_read,
        ]);
    }

    /**
     * DELETE /messages/{id}
     * Elimina un mensaje y sus adjuntos.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $message = Message::with('attachments')
            ->whereIn('account_id', $accountIds)
            ->find($id);

        if (!$message) {
            return response()->json(['error' => 'Mensaje no encontrado.'], 404);
        }

        // Eliminar archivos de adjuntos del disco
        foreach ($message->attachments as $attachment) {
            if ($attachment->local_path) {
                try {
                    // local_path puede ser 'public/attachments/...' o relativo
                    $path = str_replace('public/', '', $attachment->local_path);
                    Storage::disk('public')->delete($path);
                } catch (\Throwable) {
                    // Continuar aunque falle la eliminación del archivo
                }
            }
        }

        // Eliminar adjuntos de BD, clasificación y mensaje
        $message->attachments()->delete();

        if ($message->classification) {
            $message->classification()->delete();
        }

        $message->delete();

        return response()->json(['message' => 'Mensaje eliminado correctamente.']);
    }

    /**
     * PATCH /messages/mark-all-read
     * Marca todos los mensajes como leídos, opcionalmente filtrado por account_id.
     */
    public function markAllRead(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'account_id' => 'sometimes|integer',
        ]);

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $query = Message::whereIn('account_id', $accountIds)
            ->where('is_read', false);

        if (!empty($validated['account_id'])) {
            if (!$accountIds->contains($validated['account_id'])) {
                return response()->json(['error' => 'Cuenta no autorizada.'], 403);
            }
            $query->where('account_id', $validated['account_id']);
        }

        $updated = $query->update(['is_read' => true]);

        return response()->json([
            'message'  => "Se marcaron {$updated} mensajes como leídos.",
            'updated'  => $updated,
        ]);
    }

    /**
     * PUT /messages/{id}/flags  — alias FastAPI
     * Actualiza is_read y/o is_starred.
     */
    public function updateFlags(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $accountIds = Account::where('user_id', $user->id)->where('is_deleted', false)->pluck('id');
        $message = Message::whereIn('account_id', $accountIds)->find($id);

        if (!$message) {
            return response()->json(['error' => 'Mensaje no encontrado.'], 404);
        }

        if ($request->has('is_read'))    $message->is_read    = (bool) $request->input('is_read');
        if ($request->has('is_starred')) $message->is_starred = (bool) $request->input('is_starred');
        $message->save();

        return response()->json(['updated' => 1, 'id' => $message->id]);
    }

    /**
     * PATCH /messages/{id}  — alias FastAPI
     * Actualiza campos del mensaje (is_read, is_starred).
     */
    public function patch(Request $request, string $id): JsonResponse
    {
        return $this->updateFlags($request, $id);
    }

    /**
     * POST /messages/bulk/delete
     * Elimina varios mensajes a la vez (solo los del usuario).
     */
    public function bulkDelete(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'ids'   => 'required|array|min:1|max:500',
            'ids.*' => 'string',
        ]);

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $messages = Message::with('attachments', 'classification')
            ->whereIn('account_id', $accountIds)
            ->whereIn('id', $validated['ids'])
            ->get();

        $deleted = 0;
        foreach ($messages as $message) {
            foreach ($message->attachments as $attachment) {
                if ($attachment->local_path) {
                    try {
                        $path = str_replace('public/', '', $attachment->local_path);
                        Storage::disk('public')->delete($path);
                    } catch (\Throwable) {}
                }
            }
            $message->attachments()->delete();
            if ($message->classification) {
                $message->classification()->delete();
            }
            $message->delete();
            $deleted++;
        }

        return response()->json(['deleted' => $deleted]);
    }

    /**
     * POST /messages/bulk/classify
     * Mueve varios mensajes a una etiqueta/carpeta a la vez.
     */
    public function bulkClassify(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'ids'                 => 'required|array|min:1|max:500',
            'ids.*'               => 'string',
            'classification_label' => 'required|string|max:100',
        ]);

        $label = $validated['classification_label'];
        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $messages = Message::whereIn('account_id', $accountIds)
            ->whereIn('id', $validated['ids'])
            ->get();

        $updated = 0;
        foreach ($messages as $message) {
            \App\Models\Classification::updateOrCreate(
                ['message_id' => $message->id],
                [
                    'final_label' => $label,
                    'decided_by'  => 'manual',
                    'final_reason' => 'Etiquetado manualmente (bulk)',
                    'decided_at'  => now(),
                ]
            );
            $message->folder = (strtolower($label) === 'interesantes') ? 'INBOX' : $label;
            $message->save();
            $updated++;
        }

        return response()->json(['updated' => $updated]);
    }

    /**
     * POST /messages/bulk/export
     * Exporta uno o varios mensajes como .eml (single) o .zip (multiple).
     */
    public function bulkExport(Request $request)
    {
        $user = $request->user();
        $validated = $request->validate([
            'ids'   => 'required|array|min:1|max:100',
            'ids.*' => 'string',
        ]);

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $messages = Message::with('attachments')
            ->whereIn('account_id', $accountIds)
            ->whereIn('id', $validated['ids'])
            ->get();

        if ($messages->isEmpty()) {
            return response()->json(['error' => 'No se encontraron mensajes.'], 404);
        }

        if ($messages->count() === 1) {
            $msg = $messages->first();
            $eml = $this->buildEml($msg);
            $filename = $this->safeFilename($msg->subject ?: 'mensaje') . '.eml';
            return response($eml)
                ->header('Content-Type', 'message/rfc822')
                ->header('Content-Disposition', 'attachment; filename="' . $filename . '"');
        }

        // Multiple → ZIP
        if (!class_exists(\ZipArchive::class)) {
            return response()->json(['error' => 'ZipArchive no disponible en el servidor.'], 500);
        }

        $tmpFile = tempnam(sys_get_temp_dir(), 'export_');
        $zip = new \ZipArchive();
        if ($zip->open($tmpFile, \ZipArchive::OVERWRITE) !== true) {
            return response()->json(['error' => 'No se pudo crear el ZIP.'], 500);
        }

        $usedNames = [];
        foreach ($messages as $msg) {
            $base = $this->safeFilename($msg->subject ?: 'mensaje') . '_' . substr($msg->id, 0, 8);
            $name = $base . '.eml';
            $i = 1;
            while (isset($usedNames[$name])) { $name = $base . '_' . (++$i) . '.eml'; }
            $usedNames[$name] = true;
            $zip->addFromString($name, $this->buildEml($msg));
        }
        $zip->close();

        return response()->download($tmpFile, 'correos_' . date('Ymd_His') . '.zip', [
            'Content-Type' => 'application/zip',
        ])->deleteFileAfterSend(true);
    }

    private function safeFilename(string $name): string
    {
        $name = preg_replace('/[^\p{L}\p{N}_\-\. ]/u', '_', $name) ?? 'mensaje';
        $name = trim(preg_replace('/\s+/', '_', $name));
        return mb_substr($name, 0, 80) ?: 'mensaje';
    }

    private function buildEml(Message $msg): string
    {
        $from = $msg->from_name
            ? $msg->from_name . ' <' . $msg->from_email . '>'
            : ($msg->from_email ?: 'unknown@local');
        $to   = $this->formatAddressList($msg->to_addresses);
        $cc   = $this->formatAddressList($msg->cc_addresses);
        $date = $msg->date ? \Carbon\Carbon::parse($msg->date)->format('r') : date('r');
        $subject = $this->encodeMimeHeader((string) ($msg->subject ?? ''));
        $hasHtml = !empty($msg->body_html);
        $bodyText = (string) ($msg->body_text ?? '');
        $bodyHtml = (string) ($msg->body_html ?? '');

        $eml  = "From: " . $this->encodeMimeHeader($from) . "\r\n";
        $eml .= "To: " . ($to ?: 'unknown@local') . "\r\n";
        if ($cc) $eml .= "Cc: " . $cc . "\r\n";
        $eml .= "Subject: " . $subject . "\r\n";
        $eml .= "Date: " . $date . "\r\n";
        $eml .= "Message-ID: <" . ($msg->message_id ?: $msg->id) . ">\r\n";
        $eml .= "MIME-Version: 1.0\r\n";

        if ($hasHtml && $bodyText !== '') {
            $boundary = 'hawkins_' . bin2hex(random_bytes(8));
            $eml .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n\r\n";
            $eml .= "--{$boundary}\r\n";
            $eml .= "Content-Type: text/plain; charset=UTF-8\r\n";
            $eml .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
            $eml .= $bodyText . "\r\n\r\n";
            $eml .= "--{$boundary}\r\n";
            $eml .= "Content-Type: text/html; charset=UTF-8\r\n";
            $eml .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
            $eml .= $bodyHtml . "\r\n\r\n";
            $eml .= "--{$boundary}--\r\n";
        } elseif ($hasHtml) {
            $eml .= "Content-Type: text/html; charset=UTF-8\r\n";
            $eml .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
            $eml .= $bodyHtml;
        } else {
            $eml .= "Content-Type: text/plain; charset=UTF-8\r\n";
            $eml .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
            $eml .= $bodyText;
        }
        return $eml;
    }

    private function formatAddressList($raw): string
    {
        if (empty($raw)) return '';
        $list = is_string($raw) ? json_decode($raw, true) : $raw;
        if (!is_array($list)) return '';
        $parts = [];
        foreach ($list as $a) {
            if (is_string($a)) $parts[] = $a;
            elseif (is_array($a)) {
                $email = $a['email'] ?? '';
                $name  = $a['name']  ?? '';
                if (!$email) continue;
                $parts[] = $name ? $this->encodeMimeHeader($name) . " <{$email}>" : $email;
            }
        }
        return implode(', ', $parts);
    }

    private function encodeMimeHeader(string $value): string
    {
        if (preg_match('/[^\x20-\x7E]/', $value)) {
            return '=?UTF-8?B?' . base64_encode($value) . '?=';
        }
        return $value;
    }

    /**
     * POST /messages/bulk/flags
     * Actualiza is_read/is_starred de varios mensajes a la vez.
     */
    public function bulkFlags(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'ids'        => 'required|array|min:1|max:500',
            'ids.*'      => 'string',
            'is_read'    => 'sometimes|boolean',
            'is_starred' => 'sometimes|boolean',
        ]);

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $updates = [];
        if ($request->has('is_read'))    $updates['is_read']    = (bool) $validated['is_read'];
        if ($request->has('is_starred')) $updates['is_starred'] = (bool) $validated['is_starred'];

        if (empty($updates)) {
            return response()->json(['error' => 'Sin cambios solicitados.'], 422);
        }

        $updated = Message::whereIn('account_id', $accountIds)
            ->whereIn('id', $validated['ids'])
            ->update($updates);

        return response()->json(['updated' => $updated]);
    }

    /**
     * DELETE /messages/purge-old?folder=SPAM&older_than_days=7
     */
    public function purgeOld(Request $request): JsonResponse
    {
        $user = $request->user();
        $folder = $request->query('folder', 'SPAM');
        $days   = max(1, (int) $request->query('older_than_days', 7));

        $accountIds = Account::where('user_id', $user->id)
            ->where('is_deleted', false)
            ->pluck('id');

        $cutoff = now()->subDays($days);

        $query = Message::whereIn('account_id', $accountIds)
            ->where('created_at', '<', $cutoff);

        if ($folder === 'SPAM') {
            $query->where('classification_label', 'SPAM');
        } elseif ($folder === 'deleted') {
            $query->where('is_deleted', true);
        } else {
            $query->where('classification_label', $folder);
        }

        $deleted = $query->delete();

        return response()->json(['deleted' => $deleted]);
    }
}
