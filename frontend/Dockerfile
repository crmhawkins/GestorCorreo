FROM node:20-alpine AS builder

# URL del backend API — se pasa como build arg en Coolify
ARG VITE_API_URL=https://correos-api.hawkins.es
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm ci

# Copiar fuente y construir
COPY . .
RUN npm run build

# ── Producción con Nginx ──────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
