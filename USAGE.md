# Mail Manager con IA Local - Guía de Uso

## 🚀 Inicio Rápido

### 1. Requisitos Previos

- **Node.js 18+** y npm
- **Python 3.10+**
- **Ollama** instalado y ejecutándose
- Modelos de Ollama descargados:
  ```bash
  ollama pull gpt-oss:120b-cloud
  ollama pull qwen3-coder:480b-cloud
  ```

### 2. Instalación

```bash
# Clonar el repositorio
cd Mail

# Instalar dependencias
npm install
npm run setup

# O manualmente:
cd frontend && npm install
cd ../backend && pip install -r requirements.txt
```

### 3. Ejecución

**Opción 1: Todo en uno**
```bash
npm run dev
```

**Opción 2: Por separado**
```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Frontend
npm run dev:frontend
```

La aplicación estará disponible en:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Documentación API: http://localhost:8000/docs

---

## 📧 Configuración de Cuenta de Correo

### Añadir una Cuenta

1. Click en "+ Add Account" en el sidebar
2. Completar el formulario:
   - **Email**: tu@email.com
   - **Username**: generalmente el mismo email
   - **Password**: contraseña de la cuenta
   - **IMAP Host**: imap.gmail.com (para Gmail)
   - **IMAP Port**: 993
   - **SMTP Host**: smtp.gmail.com
   - **SMTP Port**: 587

### Ejemplos de Configuración

**Gmail:**
- IMAP: imap.gmail.com:993
- SMTP: smtp.gmail.com:587
- Nota: Requiere "App Password" si tienes 2FA

**Outlook/Hotmail:**
- IMAP: outlook.office365.com:993
- SMTP: smtp.office365.com:587

**Custom/Empresa:**
- Consulta con tu proveedor de email

---

## 🔄 Sincronización de Correos

1. Selecciona una cuenta en el sidebar
2. Click en "🔄 Sync" en la toolbar
3. Los mensajes nuevos se descargarán automáticamente
4. El sync es **incremental** (solo descarga nuevos)

---

## 🤖 Clasificación Automática con IA

### Cómo Funciona

1. **Reglas de Prioridad** (se aplican primero):
   - **Servicios**: Si el remitente está en la whitelist
   - **EnCopia**: Si hay múltiples destinatarios @hawkins.es

2. **Clasificación IA** (si no hay regla):
   - GPT y Qwen clasifican el correo en paralelo
   - Si **coinciden** → clasificación directa
   - Si **difieren** → GPT revisa y decide

### Categorías

- **Interesantes**: Solicitudes de presupuesto, propuestas comerciales
- **SPAM**: Spam, phishing, cold outreach (intentos de vendernos)
- **EnCopia**: Correos con múltiples destinatarios internos
- **Servicios**: Notificaciones transaccionales (bancos, booking, etc.)

### Clasificar un Mensaje

**Opción 1: API**
```bash
curl -X POST http://localhost:8000/api/classify/{message_id}
```

**Opción 2: Automático al sincronizar** (pendiente de implementar)

---

## ⚙️ Configuración de Whitelist

### Añadir Dominios de Servicios

1. Ir a Settings → Whitelist
2. Añadir dominio con patrón:
   - `@booking.com` - Dominio exacto
   - `@*.amazon.*` - Con wildcards
   - `@ionos.es`
   - `@movistar.es`

3. Los correos de estos dominios siempre se clasificarán como "Servicios"

---

## 📖 Leer Correos

1. Click en un mensaje de la lista
2. Se abre el MessageViewer modal
3. **Toggle HTML/Texto** para cambiar vista
4. **Adjuntos**: Click para descargar

---

## 🔍 Búsqueda

En la lista de mensajes, usa el filtro de búsqueda para encontrar por:
- Asunto
- Remitente
- Contenido

---

## 🛠️ Troubleshooting

### Ollama no conecta

```bash
# Verificar que Ollama está corriendo
curl http://localhost:11434/api/tags

# Si no responde, iniciar Ollama
ollama serve
```

### Backend no inicia

```bash
# Verificar dependencias
cd backend
pip install -r requirements.txt

# Verificar puerto
# Si 8000 está ocupado, cambiar en main.py
```

### Frontend no conecta al backend

- Verificar que el backend está en http://localhost:8000
- Revisar CORS en `backend/app/main.py`

---

## 📊 Estructura de Datos

### Base de Datos (SQLite)

Ubicación: `data/mail.db`

**Tablas principales:**
- `accounts` - Cuentas de correo
- `messages` - Mensajes sincronizados
- `attachments` - Adjuntos
- `classifications` - Resultados de clasificación IA
- `service_whitelist` - Dominios whitelistados
- `audit_logs` - Logs de operaciones

### Adjuntos

Ubicación: `data/attachments/`

Los adjuntos se guardan con nombres únicos para evitar colisiones.

---

## 🔐 Seguridad

- **Contraseñas cifradas** con Fernet + keyring del sistema
- **Sanitización HTML** con DOMPurify
- **Sin exfiltración**: IA se ejecuta localmente vía Ollama
- **Base de datos local**: SQLite en `data/`

---

## 📝 API Endpoints

### Cuentas
- `GET /api/accounts` - Listar
- `POST /api/accounts` - Crear
- `POST /api/accounts/{id}/test` - Probar conexión

### Mensajes
- `GET /api/messages` - Listar (con filtros)
- `GET /api/messages/{id}` - Obtener
- `GET /api/messages/{id}/body` - Obtener cuerpo completo

### Sincronización
- `POST /api/sync/start` - Iniciar sync
- `GET /api/sync/status` - Estado

### Clasificación
- `POST /api/classify/{message_id}` - Clasificar
- `GET /api/classify/{message_id}` - Obtener clasificación

### Whitelist
- `GET /api/whitelist` - Listar
- `POST /api/whitelist` - Añadir
- `DELETE /api/whitelist/{id}` - Eliminar

Documentación completa: http://localhost:8000/docs

---

## 🎯 Próximos Pasos (Opcional)

1. **Implementar Fase 3**: Envío de correos (SMTP)
2. **Auto-clasificación**: Clasificar automáticamente al sincronizar
3. **Filtros UI**: Filtrar mensajes por clasificación
4. **Métricas**: Panel de estadísticas de clasificación
5. **Tauri**: Empaquetar como aplicación de escritorio

---

## 🤝 Soporte

Para más información, consulta:
- [DESIGN.md](./DESIGN.md) - Arquitectura técnica
- [Walkthrough](../.gemini/antigravity/brain/4cc4c701-9e47-41c5-8c37-94621de35c3b/walkthrough.md) - Implementación completa
