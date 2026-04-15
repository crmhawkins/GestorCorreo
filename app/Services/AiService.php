<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use App\Models\AiConfig;
use Illuminate\Support\Facades\Log;

/**
 * AiService — compatible con la API personalizada en https://192.168.1.45/chat
 *
 * Formato de la API:
 *   POST {api_url}/chat   body: {"prompt":"...","model":"..."}
 *   Header: x-api-key: {api_key}
 *   Respuesta: texto plano o {"response":"..."} o {"choices":[...]}
 *
 *   GET {api_url}/text/models
 *   Respuesta: array de nombres de modelos o {"models":[...]}
 */
class AiService
{
    private ?AiConfig $config = null;

    public function __construct()
    {
        $this->config = AiConfig::first();
    }

    // -------------------------------------------------------------------------
    // Método principal: Clasifica un mensaje
    // -------------------------------------------------------------------------

    /**
     * Clasifica un mensaje usando el modelo primario y secundario.
     *
     * Si el primario falla (HTTP KO, timeout, sin tokens/cuota agotada),
     * cae al fallback_model configurado (modelo local). El secundario
     * se usa igualmente como segunda opinión cuando el primario SÍ
     * responde — para el consenso / desacuerdo habitual.
     */
    public function classifyMessage(array $messageData, array $categories, ?string $customPrompt = null): array
    {
        if (!$this->config) {
            Log::warning('AiService: No hay configuración IA disponible.');
            return $this->fallbackResult();
        }

        $primaryModel   = $this->config->primary_model;
        $secondaryModel = $this->config->secondary_model ?: $primaryModel;
        $fallbackModel  = $this->config->fallback_model  ?: null;

        $prompt = $this->buildClassificationPrompt($messageData, $categories, $customPrompt);

        // Llamamos al modelo primario
        $gptResult = $this->callModel($primaryModel, $prompt);

        // Si el primario falló y tenemos fallback distinto, usarlo
        if (isset($gptResult['error']) && $fallbackModel && $fallbackModel !== $primaryModel) {
            Log::warning('AiService: primario {$primaryModel} falló, usando fallback local', [
                'primary'  => $primaryModel,
                'fallback' => $fallbackModel,
                'error'    => $gptResult['error'],
            ]);
            $gptResult = $this->callModel($fallbackModel, $prompt);
            // Marcamos que la primera respuesta viene del fallback para rastrearlo
            if (!isset($gptResult['error'])) {
                $gptResult['source'] = 'fallback';
            }
        }

        // Llamamos al modelo secundario (puede ser el mismo)
        $qwenResult = $primaryModel !== $secondaryModel
            ? $this->callModel($secondaryModel, $prompt)
            : $gptResult;

        // Si el secundario también falló y hay fallback, intentarlo también
        if (isset($qwenResult['error']) && $fallbackModel && $fallbackModel !== $secondaryModel && $fallbackModel !== $primaryModel) {
            $qwenResult = $this->callModel($fallbackModel, $prompt);
        }

        $gptLabel  = $gptResult['label']  ?? null;
        $qwenLabel = $qwenResult['label'] ?? null;

        $result = [
            'gpt_label'       => $gptLabel,
            'gpt_confidence'  => $gptResult['confidence']  ?? null,
            'gpt_rationale'   => $gptResult['rationale']   ?? null,
            'qwen_label'      => $qwenLabel,
            'qwen_confidence' => $qwenResult['confidence'] ?? null,
            'qwen_rationale'  => $qwenResult['rationale']  ?? null,
            'final_label'     => null,
            'final_reason'    => null,
            'decided_by'      => null,
            'status'          => 'ok',
        ];

        if (!$gptLabel && !$qwenLabel) {
            Log::warning('AiService: Ambos modelos fallaron.');
            return array_merge($result, $this->fallbackResult());
        }

        if ($gptLabel && !$qwenLabel) {
            $result['final_label']  = $gptLabel;
            $result['final_reason'] = 'Solo el modelo primario respondió.';
            $result['decided_by']   = 'primary';
            return $result;
        }

        if (!$gptLabel && $qwenLabel) {
            $result['final_label']  = $qwenLabel;
            $result['final_reason'] = 'Solo el modelo secundario respondió.';
            $result['decided_by']   = 'secondary';
            return $result;
        }

        // Ambos respondieron
        if (strtolower(trim($gptLabel)) === strtolower(trim($qwenLabel))) {
            $result['final_label']  = $gptLabel;
            $result['final_reason'] = 'Ambos modelos coincidieron.';
            $result['decided_by']   = 'consensus';
            return $result;
        }

        // Desacuerdo: usar primario
        $result['final_label']  = $gptLabel;
        $result['final_reason'] = "Desacuerdo entre modelos ({$gptLabel} vs {$qwenLabel}). Se usó el primario.";
        $result['decided_by']   = 'primary';
        return $result;
    }

    // -------------------------------------------------------------------------
    // Genera respuesta de email
    // -------------------------------------------------------------------------

    public function generateReply(
        string $originalFromName,
        string $originalFromEmail,
        string $originalSubject,
        string $originalBody,
        string $userInstruction,
        string $ownerProfile
    ): string {
        if (!$this->config) {
            throw new \RuntimeException('No hay configuración IA disponible.');
        }

        $prompt = <<<PROMPT
Eres un asistente de redacción de emails profesional.
Perfil del remitente: {$ownerProfile}

Redacta una respuesta al siguiente email siguiendo la instrucción del usuario.
Devuelve SOLO el texto del email de respuesta, sin asunto, sin encabezados, sin explicaciones.
NO uses placeholders ni campos entre corchetes o llaves (ejemplos prohibidos: [Tu nombre], [Nombre], {firma}, {empresa}).
El texto debe quedar final y utilizable tal cual, sin pedir datos adicionales.

Email original:
- De: {$originalFromName} <{$originalFromEmail}>
- Asunto: {$originalSubject}
- Contenido: {$originalBody}

Instrucción: {$userInstruction}

Respuesta:
PROMPT;

        $content = $this->callModelRaw($this->config->primary_model, $prompt);

        // Fallback a modelo local si el primario falla o no tiene tokens
        if ($content === null && $this->config->fallback_model && $this->config->fallback_model !== $this->config->primary_model) {
            Log::warning('AiService::generateReply: primario falló, usando fallback', [
                'primary'  => $this->config->primary_model,
                'fallback' => $this->config->fallback_model,
            ]);
            $content = $this->callModelRaw($this->config->fallback_model, $prompt);
        }

        if ($content === null) {
            throw new \RuntimeException('La IA no devolvió contenido (primario ni fallback).');
        }

        return trim($content);
    }

    // -------------------------------------------------------------------------
    // Comprueba disponibilidad de la IA
    // -------------------------------------------------------------------------

    public function checkStatus(): array
    {
        if (!$this->config || !$this->config->api_url || !$this->config->api_key) {
            return ['available' => false, 'reason' => 'Sin configuración IA'];
        }

        try {
            $content = $this->callModelRaw($this->config->primary_model, 'ping', 5);
            if ($content !== null) {
                return ['available' => true, 'model' => $this->config->primary_model, 'via' => 'primary'];
            }

            // Primario KO, probar fallback local
            if ($this->config->fallback_model && $this->config->fallback_model !== $this->config->primary_model) {
                $content = $this->callModelRaw($this->config->fallback_model, 'ping', 5);
                if ($content !== null) {
                    return [
                        'available' => true,
                        'model'     => $this->config->fallback_model,
                        'via'       => 'fallback',
                        'reason'    => "El primario {$this->config->primary_model} no respondió. Usando fallback.",
                    ];
                }
            }

            return ['available' => false, 'reason' => 'Ni el primario ni el fallback respondieron.'];
        } catch (\Throwable $e) {
            return ['available' => false, 'reason' => $e->getMessage()];
        }
    }

    // -------------------------------------------------------------------------
    // Llamadas HTTP internas
    // -------------------------------------------------------------------------

    /**
     * Llama al modelo y devuelve la clasificación parseada.
     */
    private function callModel(string $modelName, string $prompt): array
    {
        try {
            $content = $this->callModelRaw($modelName, $prompt);

            if ($content === null) {
                return ['error' => 'Sin respuesta del modelo'];
            }

            return $this->parseAiResponse($content);
        } catch (\Throwable $e) {
            Log::error("AiService: Error llamando modelo {$modelName}", ['error' => $e->getMessage()]);
            return ['error' => $e->getMessage()];
        }
    }

    /**
     * Llamada HTTP cruda a la API personalizada.
     * Devuelve el texto de respuesta o null si falla.
     *
     * Considera "fallo" (y devuelve null):
     *  - HTTP != 2xx
     *  - Timeout / excepción de red
     *  - HTTP 402/429 (pagos/rate limit)
     *  - Body con "success": false o campos típicos de cuota/tokens agotados
     *  - Respuesta vacía o parseo fallido
     */
    private function callModelRaw(string $modelName, string $prompt, int $timeout = 60): ?string
    {
        if (!$this->config) return null;

        $endpoint = $this->resolveChatEndpoint((string)$this->config->api_url);

        try {
            $response = Http::withHeaders(['x-api-key' => $this->config->api_key])
                ->withoutVerifying()
                ->timeout($timeout)
                ->post($endpoint, [
                    'prompt' => $prompt,
                    // Compatibilidad con APIs que esperan "modelo" o "model"
                    'modelo' => $modelName,
                    'model'  => $modelName,
                ]);
        } catch (\Throwable $e) {
            // Timeout, DNS, conexión, etc. → fallback
            Log::warning("AiService: excepción HTTP con modelo {$modelName}: {$e->getMessage()}");
            return null;
        }

        // HTTP 402/429/5xx/etc → fallback
        if ($response->failed()) {
            Log::warning("AiService: HTTP {$response->status()} desde {$endpoint}", [
                'model' => $modelName,
                'body'  => mb_substr($response->body(), 0, 300),
            ]);
            return null;
        }

        // Detectar errores "blandos" dentro de HTTP 200:
        //   {"success": false, ...}
        //   {"error": "..."}
        //   body con "quota", "token", "rate limit", "insufficient_quota", etc.
        $data = $response->json();
        if (is_array($data)) {
            if (isset($data['success']) && $data['success'] === false) {
                Log::warning("AiService: success=false para modelo {$modelName}", [
                    'body' => mb_substr($response->body(), 0, 300),
                ]);
                return null;
            }
            if (isset($data['error']) && !empty($data['error'])) {
                Log::warning("AiService: error en body para modelo {$modelName}", [
                    'error' => is_string($data['error']) ? $data['error'] : json_encode($data['error']),
                ]);
                return null;
            }
        }

        // Heurística final sobre el texto bruto
        $bodyLower = strtolower(mb_substr($response->body(), 0, 2000));
        $quotaHints = ['insufficient_quota', 'out of tokens', 'tokens agotados', 'rate limit', 'quota exceeded', 'sin créditos', 'sin creditos', 'no tokens'];
        foreach ($quotaHints as $hint) {
            if (str_contains($bodyLower, $hint)) {
                Log::warning("AiService: body indica sin tokens/cuota para modelo {$modelName}", ['hint' => $hint]);
                return null;
            }
        }

        $text = $this->extractTextFromResponse($response);
        // Respuesta vacía también cuenta como fallo
        if ($text === null || trim($text) === '') {
            return null;
        }
        return $text;
    }

    private function resolveChatEndpoint(string $apiUrl): string
    {
        $url = rtrim($apiUrl, '/');

        if (str_ends_with($url, '/chat/chat')) {
            return $url;
        }

        if (str_ends_with($url, '/chat/text/chat')) {
            return substr($url, 0, -strlen('/text/chat')) . '/chat';
        }

        if (str_ends_with($url, '/chat')) {
            return $url;
        }

        return $url . '/chat/chat';
    }

    /**
     * Extrae el texto de la respuesta, manejando múltiples formatos posibles.
     * Soporta la API personalizada hawkins.es: {"respuesta":"...","success":true}
     */
    private function extractTextFromResponse($response): ?string
    {
        $body = $response->body();

        // Intentar parsear JSON
        $data = $response->json();

        if (is_array($data)) {
            // Formato hawkins.es: {"respuesta": "...", "success": true}
            if (isset($data['respuesta'])) return (string) $data['respuesta'];

            // Formato: {"response": "..."}
            if (isset($data['response'])) return (string) $data['response'];

            // Formato OpenAI: {"choices":[{"message":{"content":"..."}}]}
            if (isset($data['choices'][0]['message']['content'])) {
                return (string) $data['choices'][0]['message']['content'];
            }

            // Formato: {"text": "..."}
            if (isset($data['text'])) return (string) $data['text'];

            // Formato: {"content": "..."}
            if (isset($data['content'])) return (string) $data['content'];

            // Formato: {"message": "..."}
            if (isset($data['message']) && is_string($data['message'])) {
                return (string) $data['message'];
            }

            // Si es un array plano con texto
            if (count($data) === 1) {
                $val = reset($data);
                if (is_string($val)) return $val;
            }
        }

        // Si el body es texto plano directamente
        if (is_string($body) && strlen($body) > 0) {
            return trim($body);
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Construcción de prompts
    // -------------------------------------------------------------------------

    private function buildClassificationPrompt(array $messageData, array $categories, ?string $customPrompt): string
    {
        $fromName  = $messageData['from_name']  ?? '';
        $fromEmail = $messageData['from_email'] ?? '';
        $subject   = $messageData['subject']    ?? '';
        $date      = $messageData['date']       ?? '';
        $snippet   = $messageData['snippet']    ?? '';
        $bodyText  = mb_substr($messageData['body_text'] ?? '', 0, 1500);

        $toAddresses = $messageData['to_addresses'] ?? [];
        $ccAddresses = $messageData['cc_addresses'] ?? [];

        if (is_string($toAddresses)) $toAddresses = json_decode($toAddresses, true) ?? [];
        if (is_string($ccAddresses)) $ccAddresses = json_decode($ccAddresses, true) ?? [];

        $toList = implode(', ', array_map(fn($a) => is_array($a) ? ($a['email'] ?? '') : $a, $toAddresses));
        $ccList = implode(', ', array_map(fn($a) => is_array($a) ? ($a['email'] ?? '') : $a, $ccAddresses));

        $categoriesText = '';
        foreach ($categories as $cat) {
            $key         = $cat['key']            ?? '';
            $name        = $cat['name']           ?? $key;
            $instruction = $cat['ai_instruction'] ?? '';
            $categoriesText .= "- \"{$name}\" (key: {$key}): {$instruction}\n";
        }

        $customSection = $customPrompt ? "\n## Instrucciones adicionales:\n{$customPrompt}\n" : '';

        return <<<PROMPT
Eres un clasificador de correos electrónicos. Analiza el mensaje y clasifícalo en UNA de las categorías disponibles.

## Categorías disponibles:
{$categoriesText}
{$customSection}
## Datos del mensaje:
- De: {$fromName} <{$fromEmail}>
- Para: {$toList}
- CC: {$ccList}
- Asunto: {$subject}
- Fecha: {$date}
- Resumen: {$snippet}
- Cuerpo:
{$bodyText}

## Instrucciones:
1. Usa el campo "label" con el valor exacto del "key" de la categoría elegida.
2. Asigna una confianza entre 0.0 y 1.0.
3. Proporciona una breve justificación en español.

## Respuesta (SOLO JSON, sin texto adicional):
{"label": "key_de_la_categoria", "confidence": 0.95, "rationale": "Justificación breve en español"}
PROMPT;
    }

    // -------------------------------------------------------------------------
    // Parsing y fallback
    // -------------------------------------------------------------------------

    private function parseAiResponse(string $content): array
    {
        $content = trim($content);

        // Extraer de bloques ```json...```
        if (preg_match('/```(?:json)?\s*([\s\S]+?)\s*```/i', $content, $matches)) {
            $content = trim($matches[1]);
        }

        // Encontrar primer objeto JSON
        if (preg_match('/\{[\s\S]*\}/u', $content, $matches)) {
            $content = $matches[0];
        }

        $data = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            Log::warning('AiService: No se pudo parsear JSON', ['content' => mb_substr($content, 0, 300)]);
            return ['error' => 'JSON inválido'];
        }

        $label = $data['label'] ?? null;
        if (!$label) {
            return ['error' => 'Respuesta sin campo "label"'];
        }

        return [
            'label'      => trim((string) $label),
            'confidence' => is_numeric($data['confidence'] ?? null) ? (float) $data['confidence'] : 0.5,
            'rationale'  => isset($data['rationale']) ? (string) $data['rationale'] : '',
        ];
    }

    private function fallbackResult(): array
    {
        return [
            'gpt_label'       => null,
            'gpt_confidence'  => null,
            'gpt_rationale'   => null,
            'qwen_label'      => null,
            'qwen_confidence' => null,
            'qwen_rationale'  => null,
            'final_label'     => 'Servicios',
            'final_reason'    => 'Fallback por error en la IA.',
            'decided_by'      => 'rule_fallback',
            'status'          => 'fallback',
        ];
    }
}
