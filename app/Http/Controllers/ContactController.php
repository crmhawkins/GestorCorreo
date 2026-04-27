<?php

namespace App\Http\Controllers;

use App\Models\Contact;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ContactController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $contacts = Contact::where('user_id', $user->id)
            ->orderBy('name')
            ->orderBy('email')
            ->get();

        return response()->json($contacts);
    }

    public function search(Request $request): JsonResponse
    {
        $user = $request->user();
        $q = $request->input('q', '');

        if (strlen($q) < 1) {
            return response()->json([]);
        }

        $escaped = str_replace(['%', '_'], ['\\%', '\\_'], $q);
        $contacts = Contact::where('user_id', $user->id)
            ->where(function ($query) use ($escaped) {
                $query->where('name', 'like', "%{$escaped}%")
                      ->orWhere('email', 'like', "%{$escaped}%");
            })
            ->orderBy('name')
            ->limit(10)
            ->get();

        return response()->json($contacts);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'name'  => 'sometimes|nullable|string|max:255',
            'email' => 'required|string|email|max:255',
        ]);

        $contact = Contact::updateOrCreate(
            ['user_id' => $user->id, 'email' => strtolower($validated['email'])],
            ['name' => $validated['name'] ?? '']
        );

        return response()->json($contact, 201);
    }

    public function storeBatch(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'contacts'         => 'required|array|min:1',
            'contacts.*.email' => 'required|string|email|max:255',
            'contacts.*.name'  => 'sometimes|nullable|string|max:255',
        ]);

        $created = 0;
        foreach ($validated['contacts'] as $c) {
            Contact::updateOrCreate(
                ['user_id' => $user->id, 'email' => strtolower($c['email'])],
                ['name' => $c['name'] ?? '']
            );
            $created++;
        }

        return response()->json(['created' => $created]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $contact = Contact::where('id', $id)->where('user_id', $user->id)->first();

        if (!$contact) {
            return response()->json(['error' => 'Contacto no encontrado.'], 404);
        }

        $contact->delete();
        return response()->json(['message' => 'Contacto eliminado.']);
    }
}
