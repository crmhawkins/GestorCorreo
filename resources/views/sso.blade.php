<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Entrando…</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0f172a; color: #cbd5e1; margin: 0;
               display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .box { text-align: center; }
        .spinner { width: 40px; height: 40px; border: 3px solid #334155;
                   border-top-color: #0ea5e9; border-radius: 50%;
                   animation: spin 0.8s linear infinite; margin: 0 auto 20px; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="box">
        <div class="spinner"></div>
        <p>Entrando con SSO…</p>
    </div>
    <script>
        // Guardamos token y user en localStorage con las mismas claves que usa
        // el flujo de login normal, para que el dashboard los lea al cargar.
        try {
            localStorage.setItem('token', @json($token));
            localStorage.setItem('user',  JSON.stringify(@json($user)));
            // Pequeño delay visual para que no parpadee y redirigir al dashboard
            setTimeout(() => { window.location.href = '/'; }, 150);
        } catch (e) {
            document.body.innerHTML = '<p style="color:#ef4444">Error: no se pudo guardar la sesión. localStorage bloqueado.</p>';
        }
    </script>
</body>
</html>
