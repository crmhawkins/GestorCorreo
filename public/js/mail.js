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
    selectedIds: new Set(),
    lastClickedId: null,
    undoTimer: null,
    conversationView: localStorage.getItem('conversation_view') === '1',
    expandedThreads: new Set(),
    zenMode: false,
    lastUnreadCount: 0,
    notificationsEnabled: false,
    hoverTimer: null,
};

/* ── Font size ──────────────────────────────────────────────────────────────────────────────── */
function applyFontSize(size) {
    document.documentElement.style.setProperty('--font-size-base', size + 'px');
    const lbl = document.getElementById('font-size-label');
    if (lbl) lbl.textContent = size;
}
function getFontSize() { return parseInt(localStorage.getItem('font_size') || '14'); }
function setFontSize(size) {
    size = Math.max(11, Math.min(22, size));
    localStorage.setItem('font_size', size);
    applyFontSize(size);
}
applyFontSize(getFontSize());

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
    // Ensure all links open in new tab + inject readable base styles
    const baseInject = '<base target="_blank" rel="noopener noreferrer"><style>html,body{background:#fff!important;color:#1a1a1a}img{max-width:100%;height:auto}a{color:#2563eb}</style>';
    if (/<html/i.test(html)) {
        if (/<head(\s[^>]*)?>/i.test(html)) {
            html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + baseInject);
        } else {
            html = html.replace(/<html(\s[^>]*)?>/i, (m) => m + `<head>${baseInject}</head>`);
        }
    } else {
        html = `<!DOCTYPE html><html><head><base target="_blank" rel="noopener noreferrer"><meta charset="utf-8"><style>html,body{background:#fff;color:#1a1a1a;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;word-break:break-word;max-width:100%;padding:12px;margin:0}img{max-width:100%;height:auto}a{color:#2563eb}pre,code{background:#f4f4f4;padding:2px 4px;border-radius:3px;font-size:13px}</style></head><body>${html}</body></html>`;
    }
    return html;
}

async function resolveInlineImages(html, attachments) {
    if (!html) return html;
    // Find all /api/attachments/{id}/download URLs in src attributes
    const matches = [...html.matchAll(/src="(\/api\/attachments\/\d+\/download)"/g)];
    if (!matches.length) return html;
    const unique = [...new Set(matches.map(m => m[1]))];
    const cache = {};
    await Promise.all(unique.map(async url => {
        try {
            const r = await fetch(url, { headers: { 'Authorization': `Bearer ${S.token}` } });
            if (!r.ok) return;
            const blob = await r.blob();
            cache[url] = await new Promise(res => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.readAsDataURL(blob);
            });
        } catch {}
    }));
    return html.replace(/src="(\/api\/attachments\/\d+\/download)"/g, (full, url) =>
        cache[url] ? `src="${cache[url]}"` : full
    );
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
    // F: notify on new mail
    const total = Number(c.all || 0);
    if (S.lastUnreadCount > 0 && total > S.lastUnreadCount) {
        notifyNewMessages(total, S.lastUnreadCount);
    }
    S.lastUnreadCount = total;
}

/* ── Render: messages ──────────────────────────────────────────── */
function renderMessages() {
    const container = document.getElementById('messages-container');
    if (!S.messages.length) {
        container.innerHTML = '<div class="empty-state"><p>Sin mensajes</p><p class="hint">Pulsa Sincronizar para descargar</p></div>';
        renderBulkBar();
        return;
    }

    const renderRow = (m, opts = {}) => {
        const isHead = opts.isHead;
        const isChild = opts.isChild;
        const count = opts.count || 1;
        const threadKey = opts.key || '';
        const classes = [
            'message-item',
            m.is_read ? 'read' : 'unread',
            S.activeMessage?.id === m.id ? 'active' : '',
            S.selectedIds.has(m.id) ? 'selected' : '',
            isHead ? 'thread-head' : '',
            isHead && S.expandedThreads.has(threadKey) ? 'expanded' : '',
            isChild ? 'thread-child' : '',
        ].filter(Boolean).join(' ');
        return `
        <div class="${classes}" data-id="${m.id}" ${isHead ? `data-thread="${escHtml(threadKey)}"` : ''} draggable="true"
             ondragstart="onMessageDragStart(event,'${m.id}')">
            <input type="checkbox" class="msg-checkbox" data-id="${m.id}" ${S.selectedIds.has(m.id) ? 'checked' : ''}>
            <div class="message-from">
                ${m.is_read ? '' : '<span style="color:var(--accent);font-size:.5rem">&#9679;</span>'}
                ${escHtml(isSentLikeMessage(m) ? ('Para: ' + (getPrimaryTo(m) || '')) : (m.from_name || m.from_email || ''))}
                ${badge(m.classification_label)}
                ${count > 1 ? `<span class="thread-count">${count}</span>` : ''}
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
        </div>`;
    };

    if (S.conversationView) {
        const grouped = groupConversations(S.messages);
        container.innerHTML = grouped.map(g => renderRow(g.msg, { isHead: g.isHead, isChild: g.isChild, count: g.count, key: g.key })).join('');
    } else {
        container.innerHTML = S.messages.map(m => renderRow(m)).join('');
    }

    // Bind checkbox clicks (with shift-range support)
    container.querySelectorAll('.msg-checkbox').forEach(cb => {
        cb.addEventListener('click', e => {
            e.stopPropagation();
            handleCheckboxClick(cb.dataset.id, e.shiftKey);
        });
    });

    // Bind row click to open message (but not when clicking checkbox/star)
    container.querySelectorAll('.message-item').forEach(row => {
        row.addEventListener('click', e => {
            if (e.target.closest('.msg-checkbox') || e.target.closest('.btn-star')) return;
            // Thread head → toggle expand instead of opening
            if (S.conversationView && row.classList.contains('thread-head') && row.dataset.thread) {
                toggleThread(row.dataset.thread);
                return;
            }
            openMessage(row.dataset.id);
        });
        row.addEventListener('dblclick', e => {
            if (e.target.closest('.msg-checkbox')) return;
            openMessageLarge(row.dataset.id);
        });
    });

    renderBulkBar();
}

/* ── Multi-select ──────────────────────────────────────────────── */
function handleCheckboxClick(id, shiftKey) {
    if (shiftKey && S.lastClickedId) {
        // Range select
        const ids = S.messages.map(m => m.id);
        const a = ids.indexOf(S.lastClickedId);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
            const [start, end] = a < b ? [a, b] : [b, a];
            const shouldSelect = !S.selectedIds.has(id);
            for (let i = start; i <= end; i++) {
                if (shouldSelect) S.selectedIds.add(ids[i]);
                else S.selectedIds.delete(ids[i]);
            }
        }
    } else {
        if (S.selectedIds.has(id)) S.selectedIds.delete(id);
        else S.selectedIds.add(id);
    }
    S.lastClickedId = id;
    renderMessages();
    updateSelectAllState();
}

function clearSelection() {
    S.selectedIds.clear();
    S.lastClickedId = null;
    renderMessages();
    updateSelectAllState();
}

function selectAllVisible() {
    S.messages.forEach(m => S.selectedIds.add(m.id));
    renderMessages();
    updateSelectAllState();
}

function updateSelectAllState() {
    const cb = document.getElementById('select-all-checkbox');
    const label = document.getElementById('select-all-label');
    if (!cb) return;
    const total = S.messages.length;
    const selected = S.messages.filter(m => S.selectedIds.has(m.id)).length;
    if (selected === 0) { cb.checked = false; cb.indeterminate = false; }
    else if (selected === total) { cb.checked = true; cb.indeterminate = false; }
    else { cb.checked = false; cb.indeterminate = true; }
    if (label) label.textContent = selected > 0 ? `${selected} seleccionados` : 'Seleccionar todo';
}

function renderBulkBar() {
    const bar = document.getElementById('bulk-bar');
    if (!bar) return;
    const count = S.selectedIds.size;
    bar.classList.toggle('visible', count > 0);
    document.getElementById('bulk-bar-count').textContent = String(count);

    // Populate move-to dropdown with categories + builtins
    const moveSelect = document.getElementById('bulk-move-select');
    if (moveSelect && count > 0) {
        const builtins = [
            { key: 'Interesantes', name: 'Interesantes' },
            { key: 'Servicios', name: 'Servicios' },
            { key: 'EnCopia', name: 'En copia' },
        ];
        const customs = (S.categories || []).filter(c => !['Interesantes','Servicios','EnCopia','SPAM'].includes(c.key));
        const all = [...builtins, ...customs];
        moveSelect.innerHTML = '<option value="">Mover a...</option>' +
            all.map(c => `<option value="${escHtml(c.key)}">${escHtml(c.name || c.key)}</option>`).join('');
    }
}

/* ── Bulk actions ──────────────────────────────────────────────── */
async function bulkDelete() {
    const ids = Array.from(S.selectedIds);
    if (!ids.length) return;
    if (!confirm(`Eliminar ${ids.length} mensaje(s)?`)) return;
    const r = await api('POST', '/messages/bulk/delete', { ids });
    if (r?.ok) {
        S.messages = S.messages.filter(m => !S.selectedIds.has(m.id));
        S.selectedIds.clear();
        renderMessages();
        loadUnreadCounts();
        showUndoBar(`${r.data.deleted} eliminado(s)`, null);
    } else toast('Error al eliminar', 'error');
}

async function bulkMarkSpam() {
    const ids = Array.from(S.selectedIds);
    if (!ids.length) return;
    // Collect unique sender emails to create rules
    const senders = [...new Set(S.messages.filter(m => S.selectedIds.has(m.id)).map(m => m.from_email).filter(Boolean))];
    const r = await api('POST', '/messages/bulk/classify', { ids, classification_label: 'SPAM' });
    if (r?.ok) {
        // Auto-create sender rules
        for (const email of senders) {
            await api('POST', '/rules', { sender_email: email, target_folder: 'SPAM', is_active: true });
        }
        toast(`${r.data.updated} marcados como SPAM. Reglas creadas para ${senders.length} remitente(s).`, 'success');
        S.selectedIds.clear();
        await loadMessages(true);
    } else toast('Error', 'error');
}

async function bulkMove(label) {
    const ids = Array.from(S.selectedIds);
    if (!ids.length || !label) return;
    const r = await api('POST', '/messages/bulk/classify', { ids, classification_label: label });
    if (r?.ok) {
        toast(`${r.data.updated} movido(s) a ${label}`, 'success');
        S.selectedIds.clear();
        await loadMessages(true);
    } else toast('Error', 'error');
}

async function bulkMarkRead() {
    const ids = Array.from(S.selectedIds);
    if (!ids.length) return;
    const r = await api('POST', '/messages/bulk/flags', { ids, is_read: true });
    if (r?.ok) {
        S.messages.forEach(m => { if (S.selectedIds.has(m.id)) m.is_read = true; });
        S.selectedIds.clear();
        renderMessages();
        loadUnreadCounts();
        toast(`${r.data.updated} marcado(s) como leidos`, 'success');
    } else toast('Error', 'error');
}

async function bulkMarkUnread() {
    const ids = Array.from(S.selectedIds);
    if (!ids.length) return;
    const r = await api('POST', '/messages/bulk/flags', { ids, is_read: false });
    if (r?.ok) {
        S.messages.forEach(m => { if (S.selectedIds.has(m.id)) m.is_read = false; });
        S.selectedIds.clear();
        renderMessages();
        loadUnreadCounts();
        toast(`${r.data.updated} marcado(s) como no leídos`, 'success');
    } else toast('Error', 'error');
}

/* ── Undo bar ──────────────────────────────────────────────────── */
function showUndoBar(text, undoFn) {
    const old = document.getElementById('undo-bar');
    if (old) old.remove();
    if (S.undoTimer) clearTimeout(S.undoTimer);

    const bar = document.createElement('div');
    bar.id = 'undo-bar';
    bar.className = 'undo-bar';
    bar.innerHTML = `<span>${escHtml(text)}</span>${undoFn ? '<button id="undo-btn">Deshacer</button>' : ''}`;
    document.body.appendChild(bar);

    if (undoFn) {
        document.getElementById('undo-btn').addEventListener('click', () => {
            undoFn();
            bar.remove();
            if (S.undoTimer) clearTimeout(S.undoTimer);
        });
    }
    S.undoTimer = setTimeout(() => bar.remove(), 5000);
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

    const previewHtml = await resolveInlineImages(buildPreviewHtml(m), m.attachments || []);
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
                <button class="btn-toolbar" data-toggleread="${m.id}" onclick="toggleRead('${m.id}', ${m.is_read})">${m.is_read ? 'No leído' : 'Leído'}</button>
                <button class="btn-toolbar" onclick="toggleZenMode()" title="Modo zen">&#127769; Zen</button>
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
    if (reset) { S.page = 1; S.messages = []; S.hasMore = true; S.selectedIds.clear(); S.lastClickedId = null; }
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
    const newRead = !current;
    const idx = S.messages.findIndex(m => m.id === id);
    if (idx >= 0) S.messages[idx].is_read = newRead;
    if (S.activeMessage?.id === id) S.activeMessage.is_read = newRead;
    renderMessages();
    // Update button in viewer immediately without re-rendering entire viewer
    document.querySelectorAll('.btn-toolbar[data-toggleread]').forEach(btn => {
        if (btn.dataset.toggleread === String(id)) {
            btn.textContent = newRead ? 'No leído' : 'Leído';
            btn.setAttribute('onclick', `toggleRead('${id}', ${newRead})`);
        }
    });
    loadUnreadCounts();
};

async function setMessageFolderByDrop(payload, targetFilter) {
    if (!payload || !targetFilter || targetFilter === 'all') return;

    // payload may be a single id string or comma-separated ids
    const ids = String(payload).split(',').filter(Boolean);
    if (!ids.length) return;

    if (targetFilter === 'deleted') {
        if (ids.length === 1) return deleteMsg(ids[0]);
        // Bulk delete
        S.selectedIds = new Set(ids);
        return bulkDelete();
    }
    if (targetFilter === 'starred') {
        for (const id of ids) {
            const m = S.messages.find(x => x.id === id);
            await toggleStar({ stopPropagation(){} }, id, !!m?.is_starred);
        }
        return;
    }

    const allowed = new Set(['Interesantes', 'Servicios', 'EnCopia', 'SPAM', ...(S.categories || []).map(c => c.key)]);
    if (!allowed.has(targetFilter)) return;

    if (ids.length === 1) {
        const r = await api('PUT', `/messages/${ids[0]}/classify`, { classification_label: targetFilter });
        if (!r?.ok) { toast('No se pudo mover', 'error'); return; }
        toast('Mensaje movido a ' + targetFilter, 'success');
    } else {
        const r = await api('POST', '/messages/bulk/classify', { ids, classification_label: targetFilter });
        if (!r?.ok) { toast('No se pudieron mover', 'error'); return; }
        S.selectedIds.clear();
        toast(`${r.data.updated} mensajes movidos a ${targetFilter}`, 'success');
    }
    await loadMessages(true); loadUnreadCounts();
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

window.onMessageDragStart = function(e, id) {
    e.dataTransfer.effectAllowed = 'move';
    // If the dragged item is part of the current selection, drag all selected
    let payload = id;
    if (S.selectedIds.has(id) && S.selectedIds.size > 1) {
        payload = Array.from(S.selectedIds).join(',');
        // Show count badge in drag image
        try {
            const drag = document.createElement('div');
            drag.textContent = `${S.selectedIds.size} mensajes`;
            drag.style.cssText = 'position:absolute;top:-1000px;padding:.4rem .8rem;background:var(--accent);color:#fff;border-radius:6px;font:600 .8rem Inter,sans-serif';
            document.body.appendChild(drag);
            e.dataTransfer.setDragImage(drag, 0, 0);
            setTimeout(() => drag.remove(), 0);
        } catch {}
    }
    e.dataTransfer.setData('text/plain', payload);
};

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
    const previewHtml = await resolveInlineImages(buildPreviewHtml(m), m.attachments || []);
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
                <button class="btn-toolbar" data-toggleread="${m.id}" onclick="toggleRead('${m.id}', ${m.is_read})">${m.is_read ? 'No leído' : 'Leído'}</button>
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
async function openContactsModal() {
    await loadContacts();
    renderContactsList();
    document.getElementById('modal-contacts').style.display = 'flex';
}

function renderContactsList(filter = '') {
    const list = document.getElementById('contacts-list');
    const contacts = filter
        ? S.contacts.filter(c => (c.name || '').toLowerCase().includes(filter.toLowerCase()) || c.email.toLowerCase().includes(filter.toLowerCase()))
        : S.contacts;
    if (!contacts.length) { list.innerHTML = `<p style="color:var(--text-dim);font-size:.78rem;padding:.5rem 0">${filter ? 'Sin resultados' : 'Sin contactos'}</p>`; return; }
    list.innerHTML = contacts.map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .5rem;border-bottom:1px solid var(--border-light);font-size:.78rem">
            <div style="flex:1;overflow:hidden">
                <div style="color:var(--text-bright);font-weight:500;cursor:pointer" onclick="useContact('${escHtml(c.email)}')" title="Usar en redactar">${escHtml(c.name || c.email)}</div>
                ${c.name ? `<div style="color:var(--text-dim);font-size:.7rem">${escHtml(c.email)}</div>` : ''}
            </div>
            <button class="btn-icon" onclick="deleteContact(${c.id})" title="Eliminar" style="font-size:.7rem;color:var(--danger)">&times;</button>
        </div>
    `).join('');
}

window.useContact = function(email) {
    document.getElementById('modal-contacts').style.display = 'none';
    openCompose('new');
    setTimeout(() => {
        addEmailTag('tags-compose-to', 'composeToEmails', email);
    }, 100);
};

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

/* ── C: Hover preview ──────────────────────────────────────────── */
function setupHoverPreview() {
    const preview = document.getElementById('hover-preview');
    if (!preview) return;
    const container = document.getElementById('messages-container');

    container.addEventListener('mouseover', e => {
        const item = e.target.closest('.message-item');
        if (!item) return;
        const id = item.dataset.id;
        if (!id) return;
        const msg = S.messages.find(m => m.id === id);
        if (!msg) return;

        clearTimeout(S.hoverTimer);
        S.hoverTimer = setTimeout(() => {
            preview.style.display = 'block';
            preview.innerHTML = `
                <div class="hp-subject">${escHtml(msg.subject || '(Sin asunto)')}</div>
                <div class="hp-from">${escHtml(msg.from_name || msg.from_email || '')}</div>
                <div class="hp-snippet">${escHtml((msg.snippet || '').slice(0, 280))}</div>`;
            const rect = item.getBoundingClientRect();
            const px = Math.min(rect.right + 12, window.innerWidth - 440);
            const py = Math.min(rect.top, window.innerHeight - 200);
            preview.style.left = px + 'px';
            preview.style.top  = py + 'px';
            requestAnimationFrame(() => preview.classList.add('visible'));
        }, 600);
    });
    container.addEventListener('mouseout', e => {
        if (!e.target.closest('.message-item')) return;
        clearTimeout(S.hoverTimer);
        preview.classList.remove('visible');
        setTimeout(() => { if (!preview.classList.contains('visible')) preview.style.display = 'none'; }, 150);
    });
}

/* ── D: Saved searches ─────────────────────────────────────────── */
function getSavedSearches() {
    try { return JSON.parse(localStorage.getItem('saved_searches') || '[]'); }
    catch { return []; }
}
function setSavedSearches(arr) { localStorage.setItem('saved_searches', JSON.stringify(arr)); }

function saveCurrentSearch() {
    const name = (window.prompt('Nombre de la busqueda guardada:', '') || '').trim();
    if (!name) return;
    const list = getSavedSearches();
    list.push({
        name,
        search: S.search,
        filter: S.filter,
        dateFrom: S.dateFrom,
        dateTo: S.dateTo,
        readFilter: S.readFilter,
    });
    setSavedSearches(list);
    toast('Busqueda guardada', 'success');
}

function renderSavedSearchesPopover() {
    const pop = document.getElementById('saved-searches-popover');
    const list = getSavedSearches();
    if (!list.length) {
        pop.innerHTML = '<div class="saved-searches-empty">Sin busquedas guardadas</div>';
        return;
    }
    pop.innerHTML = list.map((s, i) => `
        <div class="saved-search-item" data-idx="${i}">
            <span>${escHtml(s.name)}</span>
            <button class="ss-delete" data-del="${i}">&times;</button>
        </div>
    `).join('');
    pop.querySelectorAll('.saved-search-item').forEach(item => {
        item.addEventListener('click', e => {
            if (e.target.classList.contains('ss-delete')) return;
            const s = getSavedSearches()[parseInt(item.dataset.idx)];
            applySavedSearch(s);
            pop.classList.remove('open');
        });
    });
    pop.querySelectorAll('.ss-delete').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const i = parseInt(btn.dataset.del);
            const list = getSavedSearches();
            list.splice(i, 1);
            setSavedSearches(list);
            renderSavedSearchesPopover();
        });
    });
}

function applySavedSearch(s) {
    if (!s) return;
    S.search = s.search || '';
    S.filter = s.filter || 'all';
    S.dateFrom = s.dateFrom || '';
    S.dateTo = s.dateTo || '';
    S.readFilter = s.readFilter || '';
    document.getElementById('search-input').value = S.search;
    document.getElementById('filter-date-from').value = S.dateFrom;
    document.getElementById('filter-date-to').value = S.dateTo;
    document.getElementById('filter-read').value = S.readFilter;
    renderFolders();
    loadMessages(true);
}

/* ── E: Conversation grouping ──────────────────────────────────── */
function normalizeSubjectForThread(s) {
    return String(s || '')
        .replace(/^(\s*(re|fwd?|fw|rv)\s*:\s*)+/i, '')
        .trim()
        .toLowerCase();
}

function groupConversations(messages) {
    const groups = new Map();
    for (const m of messages) {
        const key = normalizeSubjectForThread(m.subject) + '|' + (m.from_email || '');
        // Group by subject only (ignore from) so reply chains stay together
        const k = normalizeSubjectForThread(m.subject);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(m);
    }
    // Convert to ordered list with thread heads
    const result = [];
    const seen = new Set();
    for (const m of messages) {
        const k = normalizeSubjectForThread(m.subject);
        if (seen.has(k)) continue;
        seen.add(k);
        const all = groups.get(k);
        if (all.length === 1) {
            result.push({ msg: all[0], isHead: false, count: 1, all });
        } else {
            result.push({ msg: all[0], isHead: true, count: all.length, all, key: k });
            if (S.expandedThreads.has(k)) {
                for (let i = 1; i < all.length; i++) result.push({ msg: all[i], isChild: true, count: 1, all: [all[i]] });
            }
        }
    }
    return result;
}

function toggleThread(key) {
    if (S.expandedThreads.has(key)) S.expandedThreads.delete(key);
    else S.expandedThreads.add(key);
    renderMessages();
}
window.toggleThread = toggleThread;

function toggleConversationView() {
    S.conversationView = !S.conversationView;
    localStorage.setItem('conversation_view', S.conversationView ? '1' : '0');
    document.getElementById('btn-toggle-conversations').classList.toggle('primary', S.conversationView);
    renderMessages();
}

/* ── F: Browser notifications ─────────────────────────────────── */
async function setupNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { S.notificationsEnabled = true; return; }
    if (Notification.permission === 'default') {
        try {
            const p = await Notification.requestPermission();
            S.notificationsEnabled = (p === 'granted');
        } catch {}
    }
}

function notifyNewMessages(newCount, prevCount) {
    if (!S.notificationsEnabled || newCount <= prevCount) return;
    const delta = newCount - prevCount;
    try {
        const n = new Notification('Hawkins Mail', {
            body: `${delta} mensaje(s) nuevo(s)`,
            tag: 'hawkins-mail-new',
        });
        n.onclick = () => { window.focus(); S.filter = 'all'; loadMessages(true); n.close(); };
    } catch {}
}

/* ── G: Zen mode ───────────────────────────────────────────────── */
window.toggleZenMode = function() {
    S.zenMode = !S.zenMode;
    document.getElementById('app').classList.toggle('zen-mode', S.zenMode);
    let exitBtn = document.getElementById('btn-zen-exit');
    if (S.zenMode) {
        if (!exitBtn) {
            exitBtn = document.createElement('button');
            exitBtn.id = 'btn-zen-exit';
            exitBtn.className = 'btn-zen-exit';
            exitBtn.textContent = 'Salir del modo zen (Esc)';
            exitBtn.addEventListener('click', window.toggleZenMode);
            document.body.appendChild(exitBtn);
        }
    } else if (exitBtn) {
        exitBtn.remove();
    }
};

/* ── H: Bulk export ────────────────────────────────────────────── */
async function bulkExport() {
    const ids = Array.from(S.selectedIds);
    if (!ids.length) return;
    if (ids.length > 100) { toast('Maximo 100 mensajes por exportacion', 'error'); return; }

    const btn = document.getElementById('bulk-export');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Exportando...';

    try {
        const res = await fetch('/api/messages/bulk/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${S.token}` },
            body: JSON.stringify({ ids }),
        });
        if (!res.ok) { toast('Error al exportar', 'error'); return; }
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const fname = (cd.match(/filename="?([^"]+)"?/) || [])[1] || (ids.length === 1 ? 'mensaje.eml' : 'correos.zip');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
        URL.revokeObjectURL(url);
        toast(`${ids.length} exportado(s)`, 'success');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

/* ── I: Reply templates ────────────────────────────────────────── */
function getTemplates() {
    try { return JSON.parse(localStorage.getItem('reply_templates') || '[]'); }
    catch { return []; }
}
function setTemplates(arr) { localStorage.setItem('reply_templates', JSON.stringify(arr)); }

function renderTemplateDropdown() {
    const dd = document.getElementById('template-dropdown');
    const list = getTemplates();
    if (!list.length) {
        dd.innerHTML = '<div class="template-empty">Sin plantillas. Crea una desde Ajustes &rarr; Plantillas</div>';
        return;
    }
    dd.innerHTML = list.map((t, i) => `
        <div class="template-item" data-idx="${i}">
            <span>${escHtml(t.name)}</span>
        </div>
    `).join('');
    dd.querySelectorAll('.template-item').forEach(el => {
        el.addEventListener('click', () => {
            const t = getTemplates()[parseInt(el.dataset.idx)];
            applyTemplate(t);
            dd.classList.remove('open');
        });
    });
}

function applyTemplate(t) {
    if (!t) return;
    if (t.subject) {
        const cur = document.getElementById('compose-subject').value;
        document.getElementById('compose-subject').value = t.subject.replace('{asunto}', cur || '');
    }
    if (t.body && _quill) {
        const current = _quill.root.innerHTML;
        _quill.root.innerHTML = t.body + (current && current !== '<p><br></p>' ? '<br>' + current : '');
    }
}

function openTemplatesModal() {
    renderTemplatesList();
    document.getElementById('modal-templates').style.display = 'flex';
}

function renderTemplatesList() {
    const list = getTemplates();
    const cont = document.getElementById('templates-list-manager');
    if (!list.length) {
        cont.innerHTML = '<p style="color:var(--text-dim);font-size:.78rem;text-align:center;padding:.75rem 0">Sin plantillas creadas</p>';
        return;
    }
    cont.innerHTML = list.map((t, i) => `
        <div class="template-edit-row">
            <div class="te-name">${escHtml(t.name)}</div>
            <div class="te-body">${escHtml((t.body || '').replace(/<[^>]+>/g, ' ').slice(0, 100))}</div>
            <div class="te-actions">
                <button class="btn-toolbar danger" data-del="${i}">Eliminar</button>
            </div>
        </div>
    `).join('');
    cont.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.del);
            const list = getTemplates();
            list.splice(i, 1);
            setTemplates(list);
            renderTemplatesList();
            toast('Plantilla eliminada', 'success');
        });
    });
}

function addTemplate() {
    const name = document.getElementById('tpl-new-name').value.trim();
    const subject = document.getElementById('tpl-new-subject').value.trim();
    const body = document.getElementById('tpl-new-body').value.trim();
    if (!name || !body) { toast('Nombre y cuerpo son obligatorios', 'error'); return; }
    const list = getTemplates();
    list.push({ name, subject, body });
    setTemplates(list);
    document.getElementById('tpl-new-name').value = '';
    document.getElementById('tpl-new-subject').value = '';
    document.getElementById('tpl-new-body').value = '';
    renderTemplatesList();
    toast('Plantilla guardada', 'success');
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
        const qlEditor = document.querySelector('#compose-editor .ql-editor');
        if (qlEditor) { qlEditor.setAttribute('spellcheck', 'true'); qlEditor.setAttribute('autocorrect', 'on'); }
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
    document.getElementById('btn-font-decrease').addEventListener('click', e => {
        e.stopPropagation();
        setFontSize(getFontSize() - 1);
    });
    document.getElementById('btn-font-increase').addEventListener('click', e => {
        e.stopPropagation();
        setFontSize(getFontSize() + 1);
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
    const contactsSearch = document.getElementById('contacts-search');
    if (contactsSearch) {
        contactsSearch.addEventListener('input', e => renderContactsList(e.target.value));
    }
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

    // Bulk actions
    document.getElementById('bulk-delete').addEventListener('click', bulkDelete);
    document.getElementById('bulk-spam').addEventListener('click', bulkMarkSpam);
    document.getElementById('bulk-mark-read').addEventListener('click', bulkMarkRead);
    document.getElementById('bulk-mark-unread').addEventListener('click', bulkMarkUnread);
    document.getElementById('bulk-export').addEventListener('click', bulkExport);
    document.getElementById('bulk-clear').addEventListener('click', clearSelection);
    document.getElementById('bulk-move-select').addEventListener('change', e => {
        if (e.target.value) { bulkMove(e.target.value); e.target.value = ''; }
    });

    // D: Saved searches
    document.getElementById('btn-save-search').addEventListener('click', saveCurrentSearch);
    const ssBtn = document.getElementById('btn-saved-searches');
    const ssPop = document.getElementById('saved-searches-popover');
    ssBtn.addEventListener('click', e => {
        e.stopPropagation();
        renderSavedSearchesPopover();
        ssPop.classList.toggle('open');
    });
    document.addEventListener('click', () => ssPop.classList.remove('open'));
    ssPop.addEventListener('click', e => e.stopPropagation());

    // E: Conversation view toggle
    document.getElementById('btn-toggle-conversations').addEventListener('click', toggleConversationView);
    if (S.conversationView) document.getElementById('btn-toggle-conversations').classList.add('primary');

    // I: Templates
    document.getElementById('btn-manage-templates').addEventListener('click', () => {
        document.getElementById('settings-dropdown').classList.remove('open');
        openTemplatesModal();
    });
    document.getElementById('btn-close-templates').addEventListener('click', () => { document.getElementById('modal-templates').style.display = 'none'; });
    document.getElementById('btn-add-template').addEventListener('click', addTemplate);

    const tplBtn = document.getElementById('btn-templates');
    const tplDD = document.getElementById('template-dropdown');
    tplBtn.addEventListener('click', e => {
        e.stopPropagation();
        renderTemplateDropdown();
        tplDD.classList.toggle('open');
    });
    document.addEventListener('click', () => tplDD.classList.remove('open'));
    tplDD.addEventListener('click', e => e.stopPropagation());

    // C: Hover preview
    setupHoverPreview();

    // F: Notifications
    setupNotifications();

    // Select-all checkbox
    document.getElementById('select-all-checkbox').addEventListener('click', e => {
        if (e.target.checked) selectAllVisible();
        else clearSelection();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        // Skip if typing in an input/textarea/editor
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.target.isContentEditable) return;

        // Esc clears selection / closes viewer / exits zen mode
        if (e.key === 'Escape') {
            if (S.zenMode) { window.toggleZenMode(); return; }
            if (S.selectedIds.size > 0) clearSelection();
            else if (S.activeMessage) closeViewer();
            return;
        }
        // Ctrl/Cmd + A → select all visible
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault(); selectAllVisible(); return;
        }
        // Delete/Backspace → bulk delete (if selection)
        if ((e.key === 'Delete' || e.key === 'Backspace') && S.selectedIds.size > 0) {
            e.preventDefault(); bulkDelete(); return;
        }
    });

    // Folder events
    bindFolderEvents();

    // Auto-sync every 5 min
    if (S.autoSyncTimer) clearInterval(S.autoSyncTimer);
    S.autoSyncTimer = setInterval(() => {
        if (document.visibilityState === 'visible') doSync();
    }, 5 * 60 * 1000);
});
