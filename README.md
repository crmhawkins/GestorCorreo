# Mail Manager con IA Local

Aplicación de escritorio para gestión de correo IMAP/SMTP con clasificación automática mediante IA local (Ollama).

## 🎯 Estado del Proyecto

✅ **Fases Completadas:**
- ✅ Fase 0: Scaffolding (Backend + Frontend + DB)
- ✅ Fase 1: Motor IMAP/SMTP Básico
- ✅ Fase 2: Lectura de Correo + Adjuntos
- ✅ Fase 4: Integración IA + Consenso
- ✅ Fase 5: Acciones de Clasificación (parcial)

🔧 **Pendiente (Opcional):**
- Fase 3: Envío SMTP completo
- Auto-clasificación al sincronizar
- Filtros UI por categoría
- Empaquetado Tauri para Windows

## 🚀 Stack Tecnológico

- **Desktop**: Tauri (pendiente) / Web App
- **Frontend**: TypeScript + React + Vite
- **Backend**: Python + FastAPI
- **Base de datos**: SQLite + SQLAlchemy
- **IA**: Ollama (`gpt-oss:120b-cloud`, `qwen3-coder:480b-cloud`)
- **Email**: imaplib + aiosmtplib
- **Seguridad**: Fernet + keyring

## 📋 Requisitos Previos

- Node.js 18+ y npm
- Python 3.10+
- Ollama instalado y ejecutándose
- Modelos de Ollama:
  ```bash
  ollama pull gpt-oss:120b-cloud
  ollama pull qwen3-coder:480b-cloud
  ```

## 🛠️ Instalación

1. **Instalar dependencias**
```bash
npm install
npm run setup
```

2. **Verificar Ollama**
```bash
ollama serve
curl http://localhost:11434/api/tags
```

## 🏃 Ejecución

```bash
# Ejecutar todo (frontend + backend)
npm run dev

# O por separado:
npm run dev:backend  # http://localhost:8000
npm run dev:frontend # http://localhost:5173
```

## 📖 Documentación

- **[USAGE.md](./USAGE.md)** - Guía de uso completa
- **[DESIGN.md](./DESIGN.md)** - Arquitectura técnica detallada
- **[Walkthrough](../.gemini/antigravity/brain/4cc4c701-9e47-41c5-8c37-94621de35c3b/walkthrough.md)** - Implementación paso a paso
- **API Docs**: http://localhost:8000/docs (cuando el backend esté corriendo)

## ✨ Características Principales

### 🔄 Sincronización IMAP
- Conexión segura (SSL)
- Sync incremental (solo nuevos mensajes)
- Múltiples cuentas
- Cache local en SQLite

### 📧 Lectura de Correos
- Parser MIME completo
- Soporte HTML y texto plano
- Sanitización HTML (DOMPurify)
- Descarga de adjuntos

### 🤖 Clasificación IA con Consenso
- **Dual AI**: GPT + Qwen clasifican en paralelo
- **Consenso**: Si coinciden → clasificación directa
- **Desempate**: Si difieren → GPT revisa y decide
- **Reglas de prioridad**:
  1. Servicios (whitelist)
  2. EnCopia (múltiples @hawkins.es)
  3. IA (GPT + Qwen)

### 📂 Categorías
- **Interesantes**: Solicitudes de presupuesto/servicios
- **SPAM**: Spam, phishing, cold outreach
- **EnCopia**: Múltiples destinatarios internos
- **Servicios**: Notificaciones transaccionales

### ⚙️ Whitelist Configurable
- Dominios que siempre son "Servicios"
- Soporte para wildcards (`@*.amazon.*`)
- Gestión vía UI

## 🔐 Seguridad

- Credenciales cifradas localmente (Fernet + keyring)
- Sin exfiltración de datos
- Procesamiento 100% local (excepto IMAP/SMTP)
- Sanitización HTML en UI

## 🎯 Uso Rápido

1. **Añadir cuenta**: Click en "+ Add Account"
2. **Sincronizar**: Seleccionar cuenta → Click "Sync"
3. **Leer correo**: Click en mensaje para abrir viewer
4. **Clasificar**: `POST /api/classify/{message_id}`
5. **Configurar whitelist**: Settings → Whitelist

## 📊 Estructura del Proyecto

```
Mail/
├── backend/          # FastAPI + Python
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── routers/
│   │   └── services/
│   └── requirements.txt
├── frontend/         # React + TypeScript
│   ├── src/
│   │   ├── components/
│   │   └── services/
│   └── package.json
├── data/            # SQLite DB + adjuntos
├── DESIGN.md        # Arquitectura
├── USAGE.md         # Guía de uso
└── README.md        # Este archivo
```

## 🤝 Contribuir

Este es un proyecto privado para Hawkins (@hawkins.es).

## 📝 Licencia

Privado - Hawkins

