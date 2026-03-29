#!/bin/sh
set -e

# Generar APP_KEY si no existe
if [ -z "$APP_KEY" ]; then
    php artisan key:generate --force
fi

# Ejecutar migraciones
php artisan migrate --force

# Limpiar y cachear configuración
php artisan config:cache
php artisan route:cache

# Ajustar permisos
chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

# Iniciar servicios con supervisor
exec supervisord -c /etc/supervisord.conf
