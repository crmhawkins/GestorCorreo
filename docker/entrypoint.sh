#!/bin/sh
set -e

cd /var/www/html

# Cache config/routes/views for production
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Run migrations
php artisan migrate --force

# Start all services
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
