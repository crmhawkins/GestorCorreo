@extends('layouts.app')
@section('title', 'Hawkins Mail v.18')

@section('content')
<div class="mail-app" id="app">

    <!-- SIDEBAR -->
    <aside class="sidebar">
        <div class="sidebar-header">
            <div class="sidebar-logo-row">
                <div class="sidebar-brand">
                    <div class="sidebar-brand-mark">H</div>
                    <div class="sidebar-brand-name">
                        Hawkins Mail
                        <span class="version">v.18</span>
                    </div>
                </div>
                <div class="sidebar-header-actions">
                    <span id="ai-health-dot" title="Estado IA" style="width:8px;height:8px;border-radius:50%;background:#6b7280;display:inline-block"></span>
                    <div class="settings-dropdown-wrap">
                        <button class="btn-icon" id="btn-settings" title="Ajustes">
                            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>
                        </button>
                        <div class="settings-dropdown" id="settings-dropdown">
                            <button class="settings-dropdown-item" id="btn-edit-account">
                                <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;flex-shrink:0"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"/></svg>
                                Editar cuenta
                            </button>
                            <button class="settings-dropdown-item" id="btn-manage-contacts">
                                <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;flex-shrink:0"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>
                                Contactos
                            </button>
                            <button class="settings-dropdown-item" id="btn-manage-templates">
                                <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;flex-shrink:0"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
                                Plantillas
                            </button>
                            <div class="settings-dropdown-divider"></div>
                            <button class="settings-dropdown-item" id="btn-toggle-theme">
                                <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;flex-shrink:0"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
                                <span id="theme-label">Modo claro</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="sidebar-user" id="sidebar-user"></div>
        </div>

        <div class="sidebar-actions">
            <button class="btn-sync" id="btn-sync" title="Sincronizar correos">
                <span class="sync-icon">&#8635;</span>
                <span class="sync-spinner">&#8635;</span>
                Sincronizar
            </button>
            <button class="btn-compose-sidebar" id="btn-compose-sidebar">&#9998; Redactar</button>
        </div>

        <div id="sync-status" class="sync-status" style="display:none"></div>

        <div class="accounts-section">
            <div class="accounts-header">
                <h3>Cuentas</h3>
                <button class="btn-icon" id="btn-add-account" title="Añadir cuenta">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/></svg>
                </button>
            </div>
            <div id="accounts-list"></div>
        </div>

        <div class="folders-section">
            <div class="accounts-header">
                <h3>Carpetas</h3>
                <div style="display:flex; gap:.25rem;">
                    <button class="btn-folder-action" id="btn-add-folder" title="Crear carpeta">+ Nueva</button>
                    <button class="btn-folder-action btn-folder-delete" id="btn-delete-folder" title="Eliminar carpeta">Eliminar</button>
                </div>
            </div>
            <div id="folders-list">
                <div class="folder-item active" data-filter="all">Bandeja de entrada <span class="total-count" id="count-all"></span></div>
                <div class="folder-item" data-filter="Sent">Enviados <span class="total-count" id="count-Sent"></span></div>
                <div class="folder-item" data-filter="starred">Destacados <span class="total-count" id="count-starred"></span></div>
                <div class="folder-item" data-filter="Interesantes">Interesantes <span class="total-count" id="count-Interesantes"></span></div>
                <div class="folder-item" data-filter="Servicios">Servicios <span class="total-count" id="count-Servicios"></span></div>
                <div class="folder-item" data-filter="EnCopia">En copia <span class="total-count" id="count-EnCopia"></span></div>
                <div class="folder-item" data-filter="SPAM">SPAM <span class="total-count" id="count-SPAM"></span></div>
                <div class="folder-item" data-filter="deleted">Eliminados <span class="total-count" id="count-deleted"></span></div>
            </div>
        </div>

        <div class="sidebar-footer">
            <a href="/admin" id="btn-admin" class="btn-logout" style="display:none;text-decoration:none;text-align:left;margin-bottom:.35rem">Panel de administracion</a>
            <button class="btn-logout" id="btn-logout">Cerrar sesion</button>
        </div>
    </aside>

    <!-- MAIN -->
    <div class="main-content">
        <div class="toolbar">
            <div class="toolbar-left">
                <div class="search-toolbar">
                    <div class="search-wrap" style="flex:1">
                        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/></svg>
                        <input type="search" id="search-input" class="search-input" placeholder="Buscar por asunto, remitente o contenido..." autocomplete="off">
                    </div>
                    <button class="btn-save-search" id="btn-save-search" title="Guardar busqueda actual">+ Guardar</button>
                    <div class="search-wrap">
                        <button class="btn-save-search" id="btn-saved-searches" title="Busquedas guardadas">&#9776;</button>
                        <div class="saved-searches-popover" id="saved-searches-popover"></div>
                    </div>
                </div>
                <div class="toolbar-filters">
                    <input type="date" id="filter-date-from" class="form-control" style="max-width:140px" title="Desde">
                    <input type="date" id="filter-date-to" class="form-control" style="max-width:140px" title="Hasta">
                    <select id="filter-read" class="form-control" style="max-width:140px">
                        <option value="">Todos</option>
                        <option value="0">No leidos</option>
                        <option value="1">Leidos</option>
                    </select>
                    <button class="btn-toolbar" id="btn-clear-filters" type="button">Limpiar</button>
                </div>
            </div>
            <div class="toolbar-actions">
                <button class="btn-toolbar" id="btn-toggle-conversations" title="Agrupar por conversacion">&#128172; Hilos</button>
                <button class="btn-toolbar" id="btn-mark-read">Marcar leidos</button>
                <button class="btn-toolbar" id="btn-empty-trash" style="display:none">Vaciar</button>
            </div>
        </div>

        <div class="content-split-pane">
            <div class="list-pane" id="list-pane">
                <div class="list-select-bar">
                    <input type="checkbox" id="select-all-checkbox" title="Seleccionar todos">
                    <span id="select-all-label">Seleccionar todo</span>
                </div>
                <div class="bulk-bar" id="bulk-bar">
                    <span class="bulk-bar-count" id="bulk-bar-count">0</span>
                    <span>seleccionados</span>
                    <span class="bulk-bar-spacer"></span>
                    <button class="btn-toolbar" id="bulk-mark-read">Leidos</button>
                    <select class="btn-toolbar" id="bulk-move-select" title="Mover a">
                        <option value="">Mover a...</option>
                    </select>
                    <button class="btn-toolbar" id="bulk-export" title="Exportar como .eml/.zip">Exportar</button>
                    <button class="btn-toolbar danger" id="bulk-spam">SPAM</button>
                    <button class="btn-toolbar danger" id="bulk-delete">Eliminar</button>
                    <button class="btn-toolbar" id="bulk-clear">&#10005;</button>
                </div>
                <div id="messages-container"></div>
            </div>
            <div class="detail-pane" id="detail-pane" style="display:none">
                <div id="message-viewer"></div>
            </div>
        </div>
    </div>
</div>

<!-- MODAL: Mail password -->
<div id="modal-mail-password" style="display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.7);align-items:center;justify-content:center">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:2rem;width:100%;max-width:400px;box-shadow:var(--shadow-lg)">
        <div style="font-weight:600;color:var(--text-bright);font-size:.92rem;margin-bottom:.25rem">Configuracion requerida</div>
        <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:1rem">Introduce tu contrasena de correo</div>
        <div class="form-group">
            <label>Contrasena del correo IONOS</label>
            <input id="password" type="password" class="form-control" placeholder="Introduce tu contrasena" autocomplete="current-password">
        </div>
        <div id="mail-password-error" style="display:none;font-size:.78rem;color:var(--danger);margin-bottom:.65rem"></div>
        <button id="btn-set-mail-password" class="btn-primary" style="width:100%">Guardar y continuar</button>
    </div>
</div>

<!-- MODAL: Compose -->
<div class="modal-overlay" id="modal-compose" style="display:none">
    <div class="modal-box compose-box">
        <div class="modal-header">
            <h3 id="compose-title">Nuevo mensaje</h3>
            <button class="btn-icon" id="btn-close-compose">&#10005;</button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Desde</label>
                <select id="compose-from" class="form-control"></select>
            </div>
            <div class="form-group">
                <label>Para</label>
                <div class="contact-input-wrap" id="wrap-compose-to">
                    <div class="contact-tags" id="tags-compose-to">
                        <input type="text" class="contact-tag-input" id="input-compose-to" placeholder="destinatario@dominio.com" autocomplete="off">
                    </div>
                    <div class="contact-suggestions" id="suggestions-compose-to"></div>
                </div>
            </div>
            <div class="form-group">
                <label>CC</label>
                <div class="contact-input-wrap" id="wrap-compose-cc">
                    <div class="contact-tags" id="tags-compose-cc">
                        <input type="text" class="contact-tag-input" id="input-compose-cc" placeholder="cc@dominio.com" autocomplete="off">
                    </div>
                    <div class="contact-suggestions" id="suggestions-compose-cc"></div>
                </div>
            </div>
            <div class="form-group">
                <label>Asunto</label>
                <input type="text" id="compose-subject" class="form-control" placeholder="Asunto">
            </div>
            <div class="form-group">
                <label>Mensaje</label>
                <div id="compose-editor" style="min-height:200px"></div>
            </div>
            <div class="form-group">
                <label>Instruccion para IA (tu estilo)</label>
                <input type="text" id="compose-ai-instruction" class="form-control" placeholder="Ej: Dile que si, amable y breve">
            </div>
            <div class="form-group">
                <label>Adjuntar archivos</label>
                <input type="file" id="compose-files" class="form-control" multiple>
            </div>
        </div>
        <div class="modal-footer">
            <div class="template-dropdown-wrap">
                <button class="btn-secondary" id="btn-templates" type="button">Plantillas &#9662;</button>
                <div class="template-dropdown" id="template-dropdown"></div>
            </div>
            <button class="btn-secondary" id="btn-generate-compose-ai">Generar con IA</button>
            <button class="btn-secondary" id="btn-cancel-compose">Cancelar</button>
            <button class="btn-primary" id="btn-send">Enviar</button>
        </div>
    </div>
</div>

<!-- MODAL: Templates manager -->
<div class="modal-overlay" id="modal-templates" style="display:none">
    <div class="modal-box" style="max-width:560px">
        <div class="modal-header">
            <h3>Plantillas de respuesta</h3>
            <button class="btn-icon" id="btn-close-templates">&#10005;</button>
        </div>
        <div class="modal-body">
            <div class="form-group"><label>Nombre</label><input type="text" id="tpl-new-name" class="form-control" placeholder="Ej. Acuse de recibo"></div>
            <div class="form-group"><label>Asunto (opcional)</label><input type="text" id="tpl-new-subject" class="form-control" placeholder="Re: {asunto}"></div>
            <div class="form-group"><label>Cuerpo HTML</label><textarea id="tpl-new-body" class="form-control" rows="5" placeholder="<p>Hola,</p><p>...</p>"></textarea></div>
            <button class="btn-primary" id="btn-add-template">Anadir plantilla</button>
            <hr class="form-divider">
            <div id="templates-list-manager"></div>
        </div>
    </div>
</div>

<!-- Hover preview -->
<div class="hover-preview" id="hover-preview"></div>

<!-- MODAL: Message large -->
<div class="modal-overlay" id="modal-message-large" style="display:none">
    <div class="modal-box" style="max-width:900px;width:94vw;height:85vh;">
        <div class="modal-header">
            <h3>Mensaje</h3>
            <button class="btn-icon" id="btn-close-message-large">&#10005;</button>
        </div>
        <div class="modal-body" id="message-large-content" style="flex:1;overflow-y:auto"></div>
    </div>
</div>

<!-- MODAL: Account -->
<div class="modal-overlay" id="modal-account" style="display:none">
    <div class="modal-box">
        <div class="modal-header">
            <h3 id="account-modal-title">Anadir cuenta</h3>
            <button class="btn-icon" id="btn-close-account">&#10005;</button>
        </div>
        <div class="modal-body">
            <div class="form-group"><label>Nombre visible</label><input type="text" id="acc-name" class="form-control" placeholder="Ej. Trabajo"></div>
            <div class="form-group"><label>Correo electronico</label><input type="email" id="acc-email" class="form-control" placeholder="usuario@dominio.com"></div>
            <div class="form-group" style="display:none"><label>Contrasena</label><input type="password" id="acc-password" class="form-control" readonly disabled><small id="acc-password-hint"></small></div>

            <hr class="form-divider">
            <p class="form-section-title">Recepcion (IMAP / POP3)</p>
            <div class="form-row">
                <div class="form-group flex-2"><label>Servidor</label><input type="text" id="acc-imap-host" class="form-control" value="pop.ionos.es"></div>
                <div class="form-group flex-1"><label>Puerto</label><input type="number" id="acc-imap-port" class="form-control" value="995"></div>
                <div class="form-group flex-1"><label>Cifrado</label><select id="acc-imap-ssl" class="form-control"><option value="1">SSL/TLS</option><option value="0">Ninguno</option></select></div>
            </div>

            <hr class="form-divider">
            <p class="form-section-title">Envio (SMTP)</p>
            <div class="form-row">
                <div class="form-group flex-2"><label>Servidor</label><input type="text" id="acc-smtp-host" class="form-control" value="smtp.ionos.es"></div>
                <div class="form-group flex-1"><label>Puerto</label><input type="number" id="acc-smtp-port" class="form-control" value="465"></div>
                <div class="form-group flex-1"><label>Cifrado</label><select id="acc-smtp-ssl" class="form-control"><option value="1">SSL/TLS</option><option value="0">Ninguno</option></select></div>
            </div>

            <hr class="form-divider">
            <p class="form-section-title">Inteligencia Artificial</p>
            <div class="form-group">
                <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;text-transform:none;font-size:.8rem;letter-spacing:0">
                    <input type="checkbox" id="acc-auto-classify" style="width:auto;margin:0">
                    Analizar correos con IA al sincronizar
                </label>
            </div>
            <div class="form-group"><label>Tu perfil / forma de escribir</label><textarea id="acc-owner-profile" class="form-control" rows="2" placeholder="Ej: Respuestas breves, tono profesional"></textarea></div>
            <div class="form-group"><label>Prompt de clasificacion personalizado</label><textarea id="acc-custom-classification-prompt" class="form-control" rows="2" placeholder="Instrucciones extra para clasificar correos"></textarea></div>
            <div class="form-group"><label>Firma HTML</label><textarea id="acc-signature-html" class="form-control" rows="3" placeholder="<p>Un saludo,<br>Tu nombre</p>"></textarea></div>
        </div>
        <div class="modal-footer">
            <button class="btn-secondary" id="btn-cancel-account">Cancelar</button>
            <button class="btn-primary" id="btn-save-account">Guardar</button>
        </div>
    </div>
</div>

<!-- MODAL: Contacts -->
<div class="modal-overlay" id="modal-contacts" style="display:none">
    <div class="modal-box" style="max-width:480px">
        <div class="modal-header">
            <h3>Contactos</h3>
            <button class="btn-icon" id="btn-close-contacts">&#10005;</button>
        </div>
        <div class="modal-body">
            <div class="form-row" style="margin-bottom:.75rem">
                <div class="form-group flex-1" style="margin:0"><input type="text" id="contact-new-name" class="form-control" placeholder="Nombre"></div>
                <div class="form-group flex-2" style="margin:0"><input type="email" id="contact-new-email" class="form-control" placeholder="email@dominio.com"></div>
                <button class="btn-primary" id="btn-add-contact" style="align-self:stretch;white-space:nowrap">Anadir</button>
            </div>
            <div id="contacts-list" style="max-height:350px;overflow-y:auto"></div>
        </div>
    </div>
</div>

<!-- TOASTS -->
<div id="toast-container" class="toast-container"></div>

@push('scripts')
<script src="/js/mail.js"></script>
@endpush
@endsection
