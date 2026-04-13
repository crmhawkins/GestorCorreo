<?php

return [
    'paths'                    => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods'          => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins'          => [env('FRONTEND_URL', 'http://localhost:5173')],
    'allowed_origins_patterns' => [],
    'allowed_headers'          => ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    'exposed_headers'          => [],
    'max_age'                  => 3600,
    'supports_credentials'     => true,
];
