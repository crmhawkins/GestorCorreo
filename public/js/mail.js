/**
 * Hawkins Mail v.18 – Vanilla JS frontend
 * Calls the existing Laravel API at /api/*
 */
console.log('%c Hawkins Mail v.18', 'color:#3b82f6;font-size:14px;font-weight:bold');

/* ── State ──────────────────────────────────────────────────────── */
const S = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    accounts: [],
    selectedAccount: null,
    messages: [],
    activeMessage: null,
    filter: 'all',
    search: '',
    page: 1,
    hasMore: true,
    syncing: false,
    editingAccountId: null,
    dateFrom: '',
    dateTo: '',
    readFilter: '',
    autoSyncTimer: null,
    categories: [],
    contacts: [],
    composeToEmails: [],
    composeCcEmails: [],
};

/* ── Auth guard ─────────────────────────────────────────────────── */
if (!S.token) { window.location.href = '/login'; }

/* ── API helper ─────────────────────────────────────────────────── */
async function api(method, path, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${S.token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    if (res.status === 401) { doLogout(); return null; }
    const text = await res.text();
    try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
    catch { return { ok: res.ok, status: res.status, data: text }; }
}

/* ── Toast ──────────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${msg}</span>`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

/* ── Logout ─────────────────────────────────────────────────────── */
function doLogout() {
    api('POST', '/auth/logout').catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
}

/* ── Helpers ────────────────────────────────────────────────────── */
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d) {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const startOfWeek = (dt) => {
        const x = new Date(dt); const dow = x.getDay();
        x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow));
        return x;
    };
    if (startOfWeek(date).getTime() === startOfWeek(now).getTime()) {
        return `${dayNames[date.getDay()]} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    }
    if (date.getFullYear() !== now.getFullYear()) return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    return `${date.getDate()} ${monthNames[date.getMonth()]}`;
}

const BADGE_MAP = {
    'Interesantes': ['badge-interesantes', ''],
    'SPAM': ['badge-spam', ''],
    'EnCopia': ['badge-encopia', ''],
    'Servicios': ['badge-servicios', ''],
};
function badge(label) {
    if (!label || !BADGE_MAP[label]) return '';
    const [cls] = BADGE_MAP[label];
    return `<span class="classification-badge ${cls}">${escHtml(label)}</span>`;
}

function parseAddressList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
        return raw.split(',').map(s => ({ name: '', email: s.trim() })).filter(x => x.email);
    }
    return [];
}
function getPrimaryTo(m) {
    const to = parseAddressList(m?.to_addresses);
    if (to.length) return typeof to[0] === 'string' ? to[0] : (to[0]?.email || '');
    return m?.to_email || '';
}
function isSentLikeMessage(m) {
    const from = String(m?.from_email || '').toLowerCase();
    const me = String(S.user?.username || '').toLowerCase();
    return m?.folder === 'Sent' || (from && me && from === me && !!getPrimaryTo(m));
}
function isForwardedMessage(m) {
    if (m?.is_forwarded) return true;
    if (!isSentLikeMessage(m)) return false;
    const s = String(m?.subject || '').trim().toLowerCase();
    return s.startsWith('fwd:') || s.startsWith('fw:');
}
function isRepliedMessage(m) {
    if (m?.is_replied) return true;
    if (!isSentLikeMessage(m)) return false;
    return String(m?.subject || '').trim().toLowerCase().startsWith('re:');
}

function decodeQuotedPrintableText(input) {
    if (!input) return '';
    let s = String(input);
    s = s.replace(/=\r?\n/g, '');
    s = s.replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return s;
}
function stripHtmlToText(html) {
    const el = document.createElement('div');
    el.innerHTML = String(html || '');
    return (el.textContent || el.innerText || '').trim();
}
function normalizeBodyTextForReply(rawText, rawHtml) {
    let text = String(rawText || '');
    if (/=[A-Fa-f0-9]{2}/.test(text) || text.includes('=0D=0A')) text = decodeQuotedPrintableText(text);
    if (/<html|<body|<table|<style/i.test(text)) text = stripHtmlToText(text);
    if (!text && rawHtml) text = stripHtmlToText(decodeQuotedPrintableText(String(rawHtml)));
    return text.trim();
}

function buildPreviewHtml(message) {
    let html = String(message?.body_html || '');
    if (!html) return '';
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const imageAtts = attachments.filter(a => String(a?.mime_type || '').toLowerCase().startsWith('image/'));
    const firstImg = imageAtts[0]?.id ? `/api/attachments/${imageAtts[0].id}/download` : null;
    html = html.replace(/src\s*=\s*(['"])cid:([^'"]+)\1/gi, (full, q, cid) => {
        const c = String(cid).toLowerCase();
        const match = imageAtts.find(a => { const n = String(a?.filename || '').toLowerCase(); return n && (c.includes(n) || n.includes(c)); });
        const url = match?.id ? `/api/attachments/${match.id}/download` : firstImg;
        return url ? `src=${q}${url}${q}` : full;
    });
    return html;
}

/* ── Theme ──────────────────────────────────────────────────────── */
function updateThemeLabel() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const el = document.getElementById('theme-label');
    if (el) el.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
}

/* ── Render: sidebar ───────────────────────────────────────────── */
function renderUser() {
    const el = document.getElementById('sidebar-user');
    if (S.user) el.textContent = S.user.username;
    const adminBtn = document.getElementById('btn-admin');
    if (adminBtn) adminBtn.style.display = S.user?.is_admin ? '' : 'none';
}

function renderAccounts() {
    const list = document.getElementById('accounts-list');
    if (!S.accounts.length) {
        list.innerHTML = '<p style="color:var(--text-dim);font-size:.75rem;padding:.4rem 0">Sin cuentas. Pulsa + para anadir.</p>';
        return;
    }
    list.innerHTML = S.accounts.map(a => `
        <div class="account-item ${S.selectedAccount === a.id ? 'active' : ''}" data-id="${a.id}" onclick="selectAccount(${a.id})">
            <span class="account-name">${escHtml(a.username || a.email_address)}</span>
            <span class="account-email">${escHtml(a.email_address)}</span>
        </div>
    `).join('');
}

function renderFolders() {
    const host = document.getElementById('folders-list');
    host.querySelectorAll('.folder-item[data-custom="1"]').forEach(n => n.remove());
    const builtins = new Set(['Interesantes', 'Servicios', 'EnCopia', 'SPAM']);
    const customCats = (S.categories || []).filter(c => c?.key && !builtins.has(c.key));
    const deletedNode = host.querySelector('.folder-item[data-filter="deleted"]');

    customCats.forEach(cat => {
        const isChild = !!cat.parent_id;
        const div = document.createElement('div');
        div.className = 'folder-item' + (isChild ? ' subfolder' : '');
        div.dataset.filter = cat.key;
        div.dataset.custom = '1';
        div.innerHTML = `${escHtml(cat.name || cat.key)} <span class="total-count" id="count-${cat.key}"></span>`;
        if (deletedNode && deletedNode.parentNode) deletedNode.parentNode.insertBefore(div, deletedNode);
        else host.appendChild(div);
    });

    document.querySelectorAll('.folder-item').forEach(el => {
        el.classList.toggle('active', el.dataset.filter === S.filter);
    });
    const trashBtn = document.getElementById('btn-empty-trash');
    if (trashBtn) trashBtn.style.display = S.filter === 'deleted' ? '' : 'none';
    bindFolderEvents();
}

async function loadUnreadCounts() {
    const r = await api('GET', '/messages/unread-counts');
    if (!r?.ok) return;
    const c = r.data || {};
    const ids = ['all', 'Sent', 'starred', 'Interesantes', 'Servicios', 'EnCopia', 'SPAM', 'deleted', ...(S.categories || []).map(x => x.key)];
    ids.forEach(k => {
        const el = document.getElementById(`count-${k}`);
        if (!el) return;
        const n = Number(c[k] || c?.labels?.[k] || 0);
        el.textContent = n > 0 ? String(n) : '';
    });
}

/* ── Render: messages ──────────────────────────────────────────── */
function renderMessages() {
    const container = document.getElementById('messages-container');
    if (!S.messages.length) {
        container.innerHTML = '<div class="empty-state"><p>Sin mensajes</p><p class="hint">Pulsa Sincronizar para descargar</p></div>';
        return;
    }
    container.innerHTML = S.messages.map(m => `
        <div class="message-item ${m.is_read ? 'read' : 'unread'} ${S.activeMessage?.id === m.id ? 'active' : ''}"
             data-id="${m.id}" draggable="true"
             ondragstart="onMessageDragStart(event,'${m.id}')"
             onclick="openMessage('${m.id}')" ondblclick="openMessageLarge('${m.id}')">
            <div class="message-from">
                ${m.is_read ? '' : '<span style="color:var(--accent);font-size:.5rem">&#9679;</span>'}
                ${escHtml(isSentLikeMessage(m) ? ('Para: ' + (getPrimaryTo(m) || '')) : (m.from_name || m.from_email || ''))}
                ${badge(m.classification_label)}
            </div>
            <div class="message-date">${fmtDate(m.date)}</div>
            <div class="message-subject">${escHtml(m.subject || '(Sin asunto)')}</div>
            <div class="message-meta">
                ${isForwardedMessage(m) ? '<span title="Reenviado" style="font-size:.7rem">&#8618;</span>' : ''}
                ${isRepliedMessage(m) ? '<span title="Respondido" style="font-size:.7rem">&#8617;</span>' : ''}
                ${m.has_attachments ? '<span style="font-size:.7rem">&#128206;</span>' : ''}
                <button class="btn-star ${m.is_starred ? 'starred' : ''}" onclick="toggleStar(event,'${m.id}',${m.is_starred})"
                    title="${m.is_starred ? 'Quitar estrella' : 'Destacar'}">${m.is_starred ? '&#9733;' : '&#9734;'}</button>
            </div>
        </div>
    `).join('');
}

/* ── Render: viewer ────────────────────────────────────────────── */
async function renderViewer(msg) {
    const pane = document.getElementById('detail-pane');
    const viewer = document.getElementById('message-viewer');
    pane.style.display = '';
    document.getElementById('list-pane').classList.add('split');
    viewer.innerHTML = '<div class="loading-state">Cargando...</div>';

    const r = await api('GET', `/messages/${msg.id}`);
    if (!r?.ok) { viewer.innerHTML = '<div class="empty-state"><p>Error al cargar</p></div>'; return; }
    const m = r.data;
    S.activeMessage = m;

    const attachments = (m.attachments || []).map(a =>
        `<a class="attachment-chip" href="/api/attachments/${a.id}/download" target="_blank" rel="noopener" onclick="dlAttachment(event,${a.id})">&#128206; ${escHtml(a.filename)}</a>`
    ).join('');

    const previewHtml = buildPreviewHtml(m);
    const normalizedText = normalizeBodyTextForReply(m.body_text, m.body_html);
    const bodyHtml = previewHtml
        ? `<div class="viewer-body-html"><iframe srcdoc="${escHtml(previewHtml)}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"></iframe></div>`
        : `<div class="viewer-body-text">${escHtml(normalizedText || '')}</div>`;

    viewer.innerHTML = `
        <div class="message-viewer-wrap">
            <div class="viewer-subject">${escHtml(m.subject || '(Sin asunto)')}</div>
            <div class="viewer-meta">
                <div><strong>De:</strong> ${escHtml(m.from_name ? m.from_name + ' <' + m.from_email + '>' : m.from_email)}</div>
                <div><strong>Para:</strong> ${escHtml(getPrimaryTo(m) || '')}</div>
                <div><strong>Fecha:</strong> ${new Date(m.date).toLocaleString('es-ES')}</div>
            </div>
            <div class="viewer-actions">
                <button class="btn-toolbar" onclick="replyTo('reply')">&#8617; Responder</button>
                <button class="btn-toolbar" onclick="replyTo('reply_all')">&#8617; Resp. todos</button>
                <button class="btn-toolbar" onclick="replyTo('forward')">&#8618; Reenviar</button>
                <button class="btn-toolbar danger" onclick="markAsSpam('${m.id}')">Marcar SPAM</button>
                <button class="btn-toolbar" onclick="toggleRead('${m.id}', ${m.is_read})">${m.is_read ? 'No leido' : 'Leido'}</button>
                <button class="btn-toolbar danger" onclick="deleteMsg('${m.id}')">Eliminar</button>
            </div>
            <div class="viewer-body">${bodyHtml}</div>
            ${attachments ? `<div class="viewer-attachments"><h4>Adjuntos</h4>${attachments}</div>` : ''}
        </div>`;

    if (!m.is_read) {
        await api('PUT', `/messages/${m.id}/read`, { is_read: true });
        const idx = S.messages.findIndex(x => x.id === m.id);
        if (idx >= 0) S.messages[idx].is_read = true;
        renderMessages();
    }
}

/* ── Load data ─────────────────────────────────────────────────── */
async function loadMessages(reset = true) {
    if (reset) { S.page = 1; S.messages = []; S.hasMore = true; }
    if (!S.hasMore) return;
    const params = new URLSearchParams({ page: S.page, per_page: 50 });
    if (S.selectedAccount) params.set('account_id', S.selectedAccount);
    if (S.filter === 'all') params.set('folder', 'INBOX');
    else if (S.filter === 'starred') params.set('starred', '1');
    else if (S.filter === 'deleted') params.set('deleted', '1');
    else if (S.filter === 'Sent') params.set('folder', 'Sent');
    else params.set('label', S.filter);
    if (S.dateFrom) params.set('date_from', S.dateFrom);
    if (S.dateTo) params.set('date_to', S.dateTo);
    if (S.readFilter !== '') params.set('is_read', S.readFilter);
    if (S.search) params.set('search', S.search);

    document.getElementById('messages-container').innerHTML = '<div class="loading-state">Cargando...</div>';
    const r = await api('GET', `/messages?${params}`);
    if (!r?.ok) { toast('Error al cargar mensajes', 'error'); return; }
    const msgs = Array.isArray(r.data) ? r.data : (r.data?.data || []);
    S.messages = reset ? msgs : [...S.messages, ...msgs];
    S.hasMore = msgs.length === 50;
    S.page++;
    renderMessages();
    loadUnreadCounts();
}

async function loadAccounts() {
    const r = await api('GET', '/accounts');
    if (!r?.ok) return;
    S.accounts = Array.isArray(r.data) ? r.data : (r.data?.data || []);
    renderAccounts();
    if (!S.selectedAccount && S.accounts.length) { S.selectedAccount = S.accounts[0].id; renderAccounts(); }
    else if (!S.accounts.length) openAccountModal();
}

async function loadCategories() {
    const r = await api('GET', '/categories');
    if (!r?.ok) return;
    S.categories = Array.isArray(r.data) ? r.data : [];
    renderFolders();
    loadUnreadCounts();
}

async function loadContacts() {
    const r = await api('GET', '/contacts');
    if (!r?.ok) return;
    S.contacts = Array.isArray(r.data) ? r.data : [];
}

/* ── Folders ───────────────────────────────────────────────────── */
function getCustomCategoryByKey(key) {
    const builtins = new Set(['Interesantes', 'Servicios', 'EnCopia', 'SPAM']);
    return (S.categories || []).find(c => c?.key === key && !builtins.has(c.key));
}

async function createCustomFolder() {
    const name = (window.prompt('Nombre de la carpeta:', '') || '').trim();
    if (!name) return;

    const parentOptions = (S.categories || []).filter(c => !c.parent_id).map(c => c.name);
    let parentId = null;
    if (parentOptions.length > 0) {
        const parentName = window.prompt('Carpeta padre (dejar vacio para carpeta raiz):\nDisponibles: ' + parentOptions.join(', '), '');
        if (parentName) {
            const parent = S.categories.find(c => c.name.toLowerCase() === parentName.trim().toLowerCase());
            if (parent) parentId = parent.id;
        }
    }

    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || `cat_${Date.now()}`;
    const aiInstruction = (window.prompt('Instruccion para IA (opcional):', `Correos relacionados con ${name}.`) || '').trim();
    const r = await api('POST', '/categories', { key, name, ai_instruction: aiInstruction || '', is_system: false, parent_id: parentId });
    if (!r?.ok) { toast(r?.data?.error || 'No se pudo crear la carpeta', 'error'); return; }
    toast('Carpeta creada', 'success');
    await loadCategories();
}

async function deleteSelectedFolder() {
    const category = getCustomCategoryByKey(S.filter);
    if (!category) { toast('Selecciona una carpeta personalizada para eliminarla', 'info'); return; }
    if (!confirm('Eliminar la carpeta "' + category.name + '"?')) return;
    const r = await api('DELETE', `/categories/${category.id}`);
    if (!r?.ok) { toast(r?.data?.error || 'No se pudo eliminar', 'error'); return; }
    if (S.filter === category.key) S.filter = 'all';
    toast('Carpeta eliminada', 'success');
    await loadCategories();
    await loadMessages(true);
}

function bindFolderEvents() {
    document.querySelectorAll('.folder-item').forEach(el => {
        if (el.dataset.bound === '1') return;
        el.dataset.bound = '1';
        el.addEventListener('click', () => {
            S.filter = el.dataset.filter;
            renderAccounts(); renderFolders(); closeViewer(); loadMessages();
        });
        el.addEventListener('dragover', ev => { ev.preventDefault(); el.classList.add('drop-target'); });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', async ev => {
            ev.preventDefault(); el.classList.remove('drop-target');
            await setMessageFolderByDrop(ev.dataTransfer.getData('text/plain'), el.dataset.filter);
        });
    });
}

/* ── Actions ───────────────────────────────────────────────────── */
window.selectAccount = function(id) {
    S.selectedAccount = id; S.filter = 'all';
    renderAccounts(); renderFolders(); closeViewer(); loadMessages();
};

window.openMessage = function(id) {
    S.activeMessage = S.messages.find(m => m.id === id) || { id };
    renderMessages(); renderViewer(S.activeMessage);
};

window.toggleStar = async function(e, id, current) {
    e.stopPropagation();
    const r = await api('PATCH', `/messages/${id}`, { is_starred: !current });
    if (r?.ok) { const idx = S.messages.findIndex(m => m.id === id); if (idx >= 0) S.messages[idx].is_starred = !current; renderMessages(); }
};

window.toggleRead = async function(id, current) {
    const r = await api('PUT', `/messages/${id}/read`, { is_read: !current });
    if (!r?.ok) { toast('Error', 'error'); return; }
    const idx = S.messages.findIndex(m => m.id === id);
    if (idx >= 0) S.messages[idx].is_read = !current;
    if (S.activeMessage?.id === id) S.activeMessage.is_read = !current;
    renderMessages();
};

async function setMessageFolderByDrop(messageId, targetFilter) {
    if (!messageId || !targetFilter || targetFilter === 'all') return;
    if (targetFilter === 'deleted') return deleteMsg(messageId);
    if (targetFilter === 'starred') { const m = S.messages.find(x => x.id === messageId); return toggleStar({ stopPropagation(){} }, messageId, !!m?.is_starred); }
    const allowed = new Set(['Interesantes', 'Servicios', 'EnCopia', 'SPAM', ...(S.categories || []).map(c => c.key)]);
    if (!allowed.has(targetFilter)) return;
    const r = await api('PUT', `/messages/${messageId}/classify`, { classification_label: targetFilter });
    if (!r?.ok) { toast('No se pudo mover', 'error'); return; }
    await loadMessages(true); loadUnreadCounts();
    toast('Mensaje movido a ' + targetFilter, 'success');
}

window.markAsSpam = async function(id) {
    const msg = S.activeMessage || S.messages.find(m => m.id === id);
    const senderEmail = msg?.from_email;

    await setMessageFolderByDrop(id, 'SPAM');

    // Create sender rule to auto-SPAM future emails from this sender
    if (senderEmail) {
        await api('POST', '/rules', { sender_email: senderEmail, target_folder: 'SPAM', is_active: true });
        toast('Futuros correos de ' + senderEmail + ' iran a SPAM', 'info');
    }
};

window.onMessageDragStart = function(e, id) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); };

window.deleteMsg = async function(id) {
    const r = await api('DELETE', `/messages/${id}`);
    if (r?.ok) { S.messages = S.messages.filter(m => m.id !== id); closeViewer(); renderMessages(); loadUnreadCounts(); toast('Mensaje eliminado', 'success'); }
    else toast('Error al eliminar', 'error');
};

function closeViewer() {
    S.activeMessage = null;
    document.getElementById('detail-pane').style.display = 'none';
    document.getElementById('list-pane').classList.remove('split');
}

window.dlAttachment = async function(e, id) {
    e.preventDefault();
    const r = await fetch(`/api/attachments/${id}/download`, { headers: { 'Authorization': `Bearer ${S.token}` } });
    if (!r.ok) { toast('Error al descargar', 'error'); return; }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const fname = (cd.match(/filename="?([^"]+)"?/) || [])[1] || `adjunto_${id}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url);
};

/* ── Sync ───────────────────────────────────────────────────────── */
async function doSync() {
    if (S.syncing) return;
    S.syncing = true;
    const btn = document.getElementById('btn-sync');
    btn.disabled = true; btn.classList.add('syncing');
    const statusEl = document.getElementById('sync-status');
    statusEl.style.display = ''; statusEl.innerHTML = 'Iniciando...';

    try {
        const body = S.selectedAccount ? { account_id: S.selectedAccount } : {};
        const res = await fetch('/api/sync/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${S.token}` },
            body: JSON.stringify(body)
        });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n'); buf = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                try {
                    const ev = JSON.parse(line.slice(5).trim());
                    updateSyncStatus(ev, statusEl);
                    if (ev.status === 'error') throw new Error(ev.error || 'Error al sincronizar');
                } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
            }
        }
        toast('Sincronizacion completada', 'success');
        loadMessages(true);
    } catch (ex) {
        toast('Error: ' + ex.message, 'error');
    } finally {
        S.syncing = false; btn.disabled = false; btn.classList.remove('syncing');
        setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
    }
}

function updateSyncStatus(ev, el) {
    const cur = ev.current ?? 0, tot = ev.total ?? 0;
    const pct = tot > 0 ? Math.round((cur / tot) * 100) : 0;
    const bar = tot > 0 ? `<div class="sync-bar"><div class="sync-bar-fill" style="width:${pct}%"></div></div>` : '';
    if (ev.status === 'classifying_progress') {
        el.innerHTML = `<div>Analizando con IA ${cur}/${tot}</div>${bar}`;
    } else if (ev.status === 'downloading' && tot > 0 && cur > 0) {
        el.innerHTML = `<div>Descargando ${cur} de ${tot}</div>${bar}`;
    } else {
        el.innerHTML = `<div>${escHtml(ev.message || ev.error || '')}</div>${bar}`;
    }
}

/* ── Contact autocomplete ──────────────────────────────────────── */
function setupContactInput(inputId, suggestionsId, tagsId, emailsKey) {
    const input = document.getElementById(inputId);
    const suggestionsEl = document.getElementById(suggestionsId);
    const tagsEl = document.getElementById(tagsId);
    if (!input || !suggestionsEl || !tagsEl) return;

    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const q = input.value.trim();
            if (q.length < 1) { suggestionsEl.classList.remove('open'); return; }
            const r = await api('GET', `/contacts/search?q=${encodeURIComponent(q)}`);
            const contacts = r?.ok ? (Array.isArray(r.data) ? r.data : []) : [];
            if (!contacts.length) { suggestionsEl.classList.remove('open'); return; }
            suggestionsEl.innerHTML = contacts.map(c => `
                <div class="contact-suggestion" data-email="${escHtml(c.email)}" data-name="${escHtml(c.name || '')}">
                    ${c.name ? `<span class="contact-suggestion-name">${escHtml(c.name)}</span>` : ''}
                    <span class="contact-suggestion-email">${escHtml(c.email)}</span>
                </div>
            `).join('');
            suggestionsEl.classList.add('open');
            suggestionsEl.querySelectorAll('.contact-suggestion').forEach(s => {
                s.addEventListener('click', () => {
                    addEmailTag(tagsId, emailsKey, s.dataset.email);
                    input.value = '';
                    suggestionsEl.classList.remove('open');
                    input.focus();
                });
            });
        }, 200);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
            e.preventDefault();
            const val = input.value.replace(/,/g, '').trim();
            if (val && val.includes('@')) {
                addEmailTag(tagsId, emailsKey, val);
                input.value = '';
                suggestionsEl.classList.remove('open');
            }
        }
        if (e.key === 'Backspace' && !input.value) {
            const emails = S[emailsKey];
            if (emails.length) { emails.pop(); renderEmailTags(tagsId, emailsKey); }
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(() => suggestionsEl.classList.remove('open'), 200);
        const val = input.value.replace(/,/g, '').trim();
        if (val && val.includes('@')) { addEmailTag(tagsId, emailsKey, val); input.value = ''; }
    });

    tagsEl.addEventListener('click', () => input.focus());
}

function addEmailTag(tagsId, emailsKey, email) {
    email = email.trim().toLowerCase();
    if (!email || S[emailsKey].includes(email)) return;
    S[emailsKey].push(email);
    renderEmailTags(tagsId, emailsKey);
}

function renderEmailTags(tagsId, emailsKey) {
    const tagsEl = document.getElementById(tagsId);
    const input = tagsEl.querySelector('.contact-tag-input');
    tagsEl.querySelectorAll('.contact-tag').forEach(t => t.remove());
    S[emailsKey].forEach((email, i) => {
        const tag = document.createElement('span');
        tag.className = 'contact-tag';
        tag.innerHTML = `<span>${escHtml(email)}</span><button class="contact-tag-remove" data-idx="${i}">&times;</button>`;
        tagsEl.insertBefore(tag, input);
    });
    tagsEl.querySelectorAll('.contact-tag-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            S[emailsKey].splice(parseInt(btn.dataset.idx), 1);
            renderEmailTags(tagsId, emailsKey);
        });
    });
}

/* ── Compose ───────────────────────────────────────────────────── */
let _composeContext = null;
let _composeDraft = null;
let _quill = null;

function saveDraft() {
    _composeDraft = {
        to: S.composeToEmails.slice(),
        cc: S.composeCcEmails.slice(),
        subject: document.getElementById('compose-subject')?.value || '',
        body: _quill ? _quill.root.innerHTML : '',
        from: document.getElementById('compose-from')?.value || '',
        ai: document.getElementById('compose-ai-instruction')?.value || '',
    };
}

function closeCompose() { saveDraft(); document.getElementById('modal-compose').style.display = 'none'; }

function openCompose(mode = 'new', originalMsg = null) {
    _composeContext = { mode, originalMsg };
    document.getElementById('compose-title').textContent =
        mode === 'reply' ? 'Responder' : mode === 'reply_all' ? 'Resp. a todos' : mode === 'forward' ? 'Reenviar' : 'Nuevo mensaje';

    const sel = document.getElementById('compose-from');
    sel.innerHTML = S.accounts.map(a => `<option value="${a.id}">${escHtml(a.email_address)}</option>`).join('');
    if (S.selectedAccount) sel.value = S.selectedAccount;

    const subject = document.getElementById('compose-subject');
    const aiInst = document.getElementById('compose-ai-instruction');
    const files = document.getElementById('compose-files');
    if (files) files.value = '';

    const setBody = html => { if (_quill) _quill.root.innerHTML = html || ''; };

    // Reset tags
    S.composeToEmails = [];
    S.composeCcEmails = [];

    if (mode === 'new' && _composeDraft && (_composeDraft.to?.length || _composeDraft.subject || _composeDraft.body)) {
        S.composeToEmails = _composeDraft.to || [];
        S.composeCcEmails = _composeDraft.cc || [];
        subject.value = _composeDraft.subject;
        setBody(_composeDraft.body);
        if (aiInst) aiInst.value = _composeDraft.ai || '';
        if (_composeDraft.from) sel.value = _composeDraft.from;
    } else {
        subject.value = ''; setBody('');
        if (aiInst) aiInst.value = '';
    }

    if (originalMsg && mode !== 'new') {
        if (mode === 'reply') S.composeToEmails = [originalMsg.from_email].filter(Boolean);
        if (mode === 'reply_all') S.composeToEmails = [originalMsg.from_email, ...parseAddressList(originalMsg.to_addresses).map(a => a.email || a)].filter(Boolean);
        if (mode === 'forward') S.composeToEmails = [];
        const clean = normalizeBodyTextForReply(originalMsg.body_text, originalMsg.body_html);
        subject.value = (mode === 'forward' ? 'Fwd: ' : 'Re: ') + (originalMsg.subject || '');
        const quote = mode === 'forward'
            ? `<p><br></p><hr><p><strong>Mensaje reenviado</strong><br>De: ${escHtml(originalMsg.from_email)}<br>Fecha: ${new Date(originalMsg.date).toLocaleString('es-ES')}<br>Asunto: ${escHtml(originalMsg.subject)}</p><p>${escHtml(clean).replace(/\n/g, '<br>')}</p>`
            : `<p><br></p><blockquote>${escHtml(clean).replace(/\n/g, '<br>')}</blockquote>`;
        setBody(quote);
    }

    renderEmailTags('tags-compose-to', 'composeToEmails');
    renderEmailTags('tags-compose-cc', 'composeCcEmails');
    document.getElementById('modal-compose').style.display = 'flex';
    document.getElementById('input-compose-to').focus();
}

window.replyTo = function(mode) {
    document.getElementById('modal-message-large').style.display = 'none';
    openCompose(mode, S.activeMessage);
};

async function generateComposeWithAI() {
    const instruction = document.getElementById('compose-ai-instruction').value.trim();
    if (!instruction) { toast('Escribe una instruccion para IA', 'error'); return; }
    const original = _composeContext?.originalMsg || S.activeMessage || {};
    const acc = S.accounts.find(a => a.id == document.getElementById('compose-from').value) || {};
    const btn = document.getElementById('btn-generate-compose-ai');
    btn.disabled = true; btn.textContent = 'Generando...';
    const r = await api('POST', '/ai/generate_reply', {
        original_from_name: original.from_name || '',
        original_from_email: original.from_email || S.composeToEmails[0] || '',
        original_subject: original.subject || document.getElementById('compose-subject').value.trim(),
        original_body: original.body_text || '',
        user_instruction: instruction,
        owner_profile: acc.owner_profile || 'Responde de forma breve y profesional.',
    });
    btn.disabled = false; btn.textContent = 'Generar con IA';
    if (r?.ok && r.data?.reply_body) {
        if (_quill) _quill.root.innerHTML = (r.data.reply_body || '').replace(/\n/g, '<br>');
        toast('Borrador generado', 'success');
    } else toast(r?.data?.error || 'No se pudo generar', 'error');
}

async function sendEmail() {
    const accountId = parseInt(document.getElementById('compose-from').value);
    const to = S.composeToEmails.join(', ');
    const cc = S.composeCcEmails.join(', ');
    const subject = document.getElementById('compose-subject').value.trim();
    const body = _quill ? _quill.getText().trim() : '';
    const bodyHtml = _quill ? _quill.root.innerHTML : '';
    const files = Array.from(document.getElementById('compose-files').files || []);

    if (!to || !subject) { toast('Destinatario y asunto obligatorios', 'error'); return; }

    const btn = document.getElementById('btn-send');
    btn.disabled = true; btn.textContent = 'Enviando...';

    const payload = { account_id: accountId, to, subject, body_text: body, body_html: bodyHtml };
    payload.compose_mode = _composeContext?.mode || 'new';
    if (cc) payload.cc = cc;
    if (_composeContext?.originalMsg?.id) payload.reply_to_message_id = _composeContext.originalMsg.id;
    if (files.length) {
        payload.attachments = await Promise.all(files.map(async f => ({
            name: f.name, mime_type: f.type || 'application/octet-stream', content_base64: await fileToBase64(f),
        })));
    }

    const r = await api('POST', '/send', payload);
    btn.disabled = false; btn.textContent = 'Enviar';

    if (r?.ok) {
        toast('Mensaje enviado', 'success');
        // Check if recipients are in contacts, offer to add
        const allEmails = [...S.composeToEmails, ...S.composeCcEmails];
        const unknownEmails = allEmails.filter(e => !S.contacts.find(c => c.email === e.toLowerCase()));
        if (unknownEmails.length) {
            const addThem = confirm('Agregar a contactos:\n' + unknownEmails.join('\n') + '?');
            if (addThem) {
                await api('POST', '/contacts/batch', { contacts: unknownEmails.map(e => ({ email: e, name: '' })) });
                await loadContacts();
            }
        }
        _composeDraft = null;
        document.getElementById('modal-compose').style.display = 'none';
        document.getElementById('compose-files').value = '';
        S.composeToEmails = [];
        S.composeCcEmails = [];
        await doSync();
    } else toast(r?.data?.message || 'Error al enviar', 'error');
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => { const res = String(fr.result || ''); resolve(res.includes(',') ? res.split(',')[1] : res); };
        fr.onerror = reject;
        fr.readAsDataURL(file);
    });
}

/* ── Message large ─────────────────────────────────────────────── */
window.openMessageLarge = async function(id) {
    const r = await api('GET', `/messages/${id}`);
    if (!r?.ok) { toast('No se pudo abrir', 'error'); return; }
    const m = r.data; S.activeMessage = m;
    const attachments = (m.attachments || []).map(a =>
        `<a class="attachment-chip" href="/api/attachments/${a.id}/download" target="_blank" rel="noopener" onclick="dlAttachment(event,${a.id})">&#128206; ${escHtml(a.filename)}</a>`
    ).join('');
    const previewHtml = buildPreviewHtml(m);
    const normalizedText = normalizeBodyTextForReply(m.body_text, m.body_html);
    const body = previewHtml
        ? `<div class="viewer-body-html"><iframe srcdoc="${escHtml(previewHtml)}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" style="height:60vh"></iframe></div>`
        : `<div class="viewer-body-text">${escHtml(normalizedText || '')}</div>`;
    document.getElementById('message-large-content').innerHTML = `
        <div class="message-viewer-wrap">
            <div class="viewer-subject">${escHtml(m.subject || '(Sin asunto)')}</div>
            <div class="viewer-meta">
                <div><strong>De:</strong> ${escHtml(m.from_name ? m.from_name + ' <' + m.from_email + '>' : (m.from_email || ''))}</div>
                <div><strong>Para:</strong> ${escHtml(getPrimaryTo(m) || '')}</div>
                <div><strong>Fecha:</strong> ${m.date ? new Date(m.date).toLocaleString('es-ES') : ''}</div>
            </div>
            <div class="viewer-actions">
                <button class="btn-toolbar" onclick="replyTo('reply')">&#8617; Responder</button>
                <button class="btn-toolbar" onclick="replyTo('reply_all')">&#8617; Resp. todos</button>
                <button class="btn-toolbar" onclick="replyTo('forward')">&#8618; Reenviar</button>
                <button class="btn-toolbar danger" onclick="markAsSpam('${m.id}')">Marcar SPAM</button>
                <button class="btn-toolbar" onclick="toggleRead('${m.id}', ${m.is_read})">${m.is_read ? 'No leido' : 'Leido'}</button>
                <button class="btn-toolbar danger" onclick="deleteMsg('${m.id}')">Eliminar</button>
            </div>
            <div class="viewer-body" style="margin-top:1rem">${body}</div>
            ${attachments ? `<div class="viewer-attachments"><h4>Adjuntos</h4>${attachments}</div>` : ''}
        </div>`;
    document.getElementById('modal-message-large').style.display = 'flex';
};

/* ── Account modal ─────────────────────────────────────────────── */
function openAccountModal(acc = null) {
    S.editingAccountId = acc?.id || null;
    document.getElementById('account-modal-title').textContent = acc ? 'Editar cuenta' : 'Anadir cuenta';
    document.getElementById('acc-name').value = acc?.username || '';
    const email = S.user?.username || acc?.email_address || '';
    const emailEl = document.getElementById('acc-email');
    emailEl.value = email; emailEl.readOnly = true;
    const pwd = document.getElementById('acc-password');
    pwd.value = ''; pwd.readOnly = false; pwd.disabled = false;
    document.getElementById('acc-imap-host').value = acc?.imap_host || 'pop.ionos.es';
    document.getElementById('acc-imap-port').value = acc?.imap_port || 995;
    document.getElementById('acc-imap-ssl').value = acc?.imap_ssl ? '1' : '0';
    document.getElementById('acc-smtp-host').value = acc?.smtp_host || 'smtp.ionos.es';
    document.getElementById('acc-smtp-port').value = acc?.smtp_port || 465;
    document.getElementById('acc-smtp-ssl').value = acc?.smtp_ssl ? '1' : '0';
    document.getElementById('acc-auto-classify').checked = acc ? !!acc.auto_classify : true;
    document.getElementById('acc-owner-profile').value = acc?.owner_profile || '';
    document.getElementById('acc-custom-classification-prompt').value = acc?.custom_classification_prompt || '';
    document.getElementById('acc-signature-html').value = acc?.signature_html || '';
    document.getElementById('modal-account').style.display = 'flex';
}

async function saveAccount() {
    const emailStr = (S.user?.username || document.getElementById('acc-email').value || '').trim();
    const imapHost = document.getElementById('acc-imap-host').value.trim();
    const imapPort = parseInt(document.getElementById('acc-imap-port').value);
    const tempPwd = sessionStorage.getItem('platform_password_temp') || '';
    const protocol = (imapHost.toLowerCase().startsWith('pop.') || [110, 965, 995].includes(imapPort)) ? 'pop3' : 'imap';
    const body = {
        name: document.getElementById('acc-name').value.trim(),
        email_address: emailStr, username: emailStr,
        imap_host: imapHost, imap_port: imapPort,
        smtp_host: document.getElementById('acc-smtp-host').value.trim(),
        smtp_port: parseInt(document.getElementById('acc-smtp-port').value),
        ssl_verify: document.getElementById('acc-imap-ssl').value === '1',
        protocol, auto_classify: document.getElementById('acc-auto-classify').checked,
        owner_profile: document.getElementById('acc-owner-profile').value.trim(),
        custom_classification_prompt: document.getElementById('acc-custom-classification-prompt').value.trim(),
        signature_html: document.getElementById('acc-signature-html').value,
    };
    const pwdVal = document.getElementById('acc-password').value;
    if (S.editingAccountId) { if (pwdVal) body.password = pwdVal; }
    else { body.password = pwdVal || tempPwd; if (!body.password) { toast('Introduce la contrasena', 'error'); return; } }
    if (!body.email_address) { toast('El email es obligatorio', 'error'); return; }

    const btn = document.getElementById('btn-save-account');
    btn.disabled = true; btn.textContent = 'Guardando...';
    const r = S.editingAccountId ? await api('PUT', `/accounts/${S.editingAccountId}`, body) : await api('POST', '/accounts', body);
    btn.disabled = false; btn.textContent = 'Guardar';

    if (r?.ok) {
        toast(S.editingAccountId ? 'Cuenta actualizada' : 'Cuenta anadida', 'success');
        document.getElementById('modal-account').style.display = 'none';
        await loadAccounts(); loadMessages(true);
    } else {
        toast(r?.data?.message || Object.values(r?.data?.errors || {})[0]?.[0] || 'Error al guardar', 'error');
    }
}

/* ── Contacts modal ────────────────────────────────────────────── */
function openContactsModal() {
    renderContactsList();
    document.getElementById('modal-contacts').style.display = 'flex';
}

function renderContactsList() {
    const list = document.getElementById('contacts-list');
    if (!S.contacts.length) { list.innerHTML = '<p style="color:var(--text-dim);font-size:.78rem;padding:.5rem 0">Sin contactos</p>'; return; }
    list.innerHTML = S.contacts.map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .5rem;border-bottom:1px solid var(--border-light);font-size:.78rem">
            <div>
                <div style="color:var(--text-bright);font-weight:500">${escHtml(c.name || c.email)}</div>
                ${c.name ? `<div style="color:var(--text-dim);font-size:.7rem">${escHtml(c.email)}</div>` : ''}
            </div>
            <button class="btn-icon" onclick="deleteContact(${c.id})" title="Eliminar" style="font-size:.7rem;color:var(--danger)">&times;</button>
        </div>
    `).join('');
}

window.deleteContact = async function(id) {
    await api('DELETE', `/contacts/${id}`);
    await loadContacts();
    renderContactsList();
};

async function addContact() {
    const name = document.getElementById('contact-new-name').value.trim();
    const email = document.getElementById('contact-new-email').value.trim();
    if (!email) { toast('Email es obligatorio', 'error'); return; }
    const r = await api('POST', '/contacts', { name, email });
    if (r?.ok) {
        document.getElementById('contact-new-name').value = '';
        document.getElementById('contact-new-email').value = '';
        await loadContacts();
        renderContactsList();
        toast('Contacto anadido', 'success');
    } else toast(r?.data?.error || 'Error', 'error');
}

/* ── AI health ─────────────────────────────────────────────────── */
async function refreshAiHealth() {
    const dot = document.getElementById('ai-health-dot');
    if (!dot) return;
    const r = await api('GET', '/ai/status');
    const up = !!(r?.ok && r.data?.available);
    dot.style.background = up ? '#22c55e' : '#ef4444';
    dot.title = up ? 'IA operativa' : ('IA no disponible: ' + (r?.data?.reason || ''));
}

/* ── Mark all read ─────────────────────────────────────────────── */
async function markAllRead() {
    const params = {};
    if (S.selectedAccount) params.account_id = S.selectedAccount;
    const r = await api('PATCH', '/messages/mark-all-read', params);
    if (r?.ok) { S.messages.forEach(m => m.is_read = true); renderMessages(); loadUnreadCounts(); toast('Marcados como leidos', 'success'); }
    else toast('Error', 'error');
}

/* ── Mail password modal ───────────────────────────────────────── */
function promptMailPassword() {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-mail-password');
        const input = document.getElementById('password');
        const errEl = document.getElementById('mail-password-error');
        const btn = document.getElementById('btn-set-mail-password');
        modal.style.display = 'flex';
        setTimeout(() => input.focus(), 100);
        btn.onclick = async () => {
            const pwd = input.value.trim();
            errEl.style.display = 'none';
            if (!pwd) { errEl.textContent = 'Introduce tu contrasena.'; errEl.style.display = ''; return; }
            btn.disabled = true; btn.textContent = 'Guardando...';
            const r = await api('POST', '/users/me/set-mail-password', { mail_password: pwd });
            btn.disabled = false; btn.textContent = 'Guardar y continuar';
            if (r.ok) { S.user.mail_password_required = false; localStorage.setItem('user', JSON.stringify(S.user)); modal.style.display = 'none'; resolve(); }
            else { errEl.textContent = r.data?.message || r.data?.error || 'Error'; errEl.style.display = ''; }
        };
    });
}

/* ── Init ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    const si = document.getElementById('search-input');
    if (si?.value) { si.value = ''; S.search = ''; }
    setTimeout(() => { if (si?.value) { si.value = ''; S.search = ''; } }, 200);

    updateThemeLabel();

    // Quill
    if (typeof Quill !== 'undefined' && document.getElementById('compose-editor')) {
        _quill = new Quill('#compose-editor', {
            theme: 'snow', placeholder: 'Escribe tu mensaje...',
            modules: { toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], [{ align: [] }], ['clean']] },
        });
    }

    // Contact autocomplete
    setupContactInput('input-compose-to', 'suggestions-compose-to', 'tags-compose-to', 'composeToEmails');
    setupContactInput('input-compose-cc', 'suggestions-compose-cc', 'tags-compose-cc', 'composeCcEmails');

    renderUser();

    const me = await api('GET', '/auth/me');
    if (!me?.ok) { doLogout(); return; }
    if (me.data?.user) { S.user = me.data.user; localStorage.setItem('user', JSON.stringify(S.user)); renderUser(); }
    if (S.user?.mail_password_required) await promptMailPassword();

    await loadAccounts();
    await loadCategories();
    await loadContacts();
    await loadMessages();
    await loadUnreadCounts();
    await refreshAiHealth();
    doSync();

    // Sidebar events
    document.getElementById('btn-sync').addEventListener('click', doSync);
    document.getElementById('btn-compose-sidebar').addEventListener('click', () => openCompose('new'));
    document.getElementById('btn-logout').addEventListener('click', doLogout);
    document.getElementById('btn-add-account').addEventListener('click', () => openAccountModal());
    document.getElementById('btn-add-folder').addEventListener('click', createCustomFolder);
    document.getElementById('btn-delete-folder').addEventListener('click', deleteSelectedFolder);
    document.getElementById('btn-mark-read').addEventListener('click', markAllRead);

    // Filters
    document.getElementById('filter-date-from').addEventListener('change', e => { S.dateFrom = e.target.value; loadMessages(); });
    document.getElementById('filter-date-to').addEventListener('change', e => { S.dateTo = e.target.value; loadMessages(); });
    document.getElementById('filter-read').addEventListener('change', e => { S.readFilter = e.target.value; loadMessages(); });
    document.getElementById('btn-clear-filters').addEventListener('click', () => {
        S.dateFrom = ''; S.dateTo = ''; S.readFilter = '';
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        document.getElementById('filter-read').value = '';
        loadMessages();
    });

    // Settings dropdown
    const settingsBtn = document.getElementById('btn-settings');
    const settingsDD = document.getElementById('settings-dropdown');
    settingsBtn.addEventListener('click', e => {
        e.stopPropagation();
        settingsDD.classList.toggle('open');
    });
    document.addEventListener('click', () => settingsDD.classList.remove('open'));
    settingsDD.addEventListener('click', e => e.stopPropagation());

    document.getElementById('btn-edit-account').addEventListener('click', () => {
        settingsDD.classList.remove('open');
        if (S.accounts.length) openAccountModal(S.accounts.find(a => a.id === S.selectedAccount) || S.accounts[0]);
        else openAccountModal();
    });
    document.getElementById('btn-manage-contacts').addEventListener('click', () => {
        settingsDD.classList.remove('open');
        openContactsModal();
    });
    document.getElementById('btn-toggle-theme').addEventListener('click', () => {
        settingsDD.classList.remove('open');
        window.toggleTheme();
        updateThemeLabel();
    });

    // Search
    let searchTimer;
    si.addEventListener('input', e => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { S.search = e.target.value.trim(); loadMessages(); }, 400);
    });

    // Compose modal
    document.getElementById('btn-close-compose').addEventListener('click', closeCompose);
    document.getElementById('btn-cancel-compose').addEventListener('click', closeCompose);
    document.getElementById('btn-send').addEventListener('click', sendEmail);
    document.getElementById('btn-generate-compose-ai').addEventListener('click', generateComposeWithAI);
    document.getElementById('btn-close-message-large').addEventListener('click', () => { document.getElementById('modal-message-large').style.display = 'none'; });

    // Account modal
    document.getElementById('btn-close-account').addEventListener('click', () => { document.getElementById('modal-account').style.display = 'none'; });
    document.getElementById('btn-cancel-account').addEventListener('click', () => { document.getElementById('modal-account').style.display = 'none'; });
    document.getElementById('btn-save-account').addEventListener('click', saveAccount);

    // Contacts modal
    document.getElementById('btn-close-contacts').addEventListener('click', () => { document.getElementById('modal-contacts').style.display = 'none'; });
    document.getElementById('btn-add-contact').addEventListener('click', addContact);

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(o => {
        if (o.id === 'modal-compose') return;
        o.addEventListener('click', e => { if (e.target === o) o.style.display = 'none'; });
    });

    // Empty trash
    document.getElementById('btn-empty-trash').addEventListener('click', async () => {
        if (!confirm('Vaciar papelera? Los mensajes se eliminaran permanentemente.')) return;
        const p = S.selectedAccount ? `?account_id=${S.selectedAccount}` : '';
        const r = await api('DELETE', `/messages/trash${p}`);
        if (r?.ok) { toast('Papelera vaciada', 'success'); loadMessages(true); }
        else toast('Error', 'error');
    });

    // Infinite scroll
    document.getElementById('list-pane').addEventListener('scroll', e => {
        const el = e.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) loadMessages(false);
    });

    // Folder events
    bindFolderEvents();

    // Auto-sync every 5 min
    if (S.autoSyncTimer) clearInterval(S.autoSyncTimer);
    S.autoSyncTimer = setInterval(() => {
        if (document.visibilityState === 'visible') doSync();
    }, 5 * 60 * 1000);
});
