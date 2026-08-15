// ============================================================
// 00-auth.js — Login, registro y panel de admin
// Corre antes que todos los otros módulos.
// Bloquea el acceso hasta que haya un JWT válido en localStorage.
// ============================================================

(function () {

  const TOKEN_KEY = 'master_auth_token';
  const USER_KEY  = 'master_auth_user';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getToken() { return localStorage.getItem(TOKEN_KEY); }

  // API URL — lee el input #apiUrl si ya existe en el DOM, sino usa origin
  function _apiUrl() {
    const el = document.getElementById('apiUrl');
    return el ? el.value.replace(/\/$/, '') : window.location.origin;
  }
  function getUser()  {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }

  // Exponer globalmente para que los otros módulos agreguen el header
  window.authGetToken = getToken;
  window.authGetUser  = getUser;

  // Monkey-patch fetch para agregar Authorization automáticamente
  const _origFetch = window.fetch;
  window.fetch = function (url, opts = {}) {
    const token = getToken();
    if (token && typeof url === 'string' && !url.startsWith('http')) {
      opts.headers = { ...(opts.headers || {}), 'Authorization': `Bearer ${token}` };
    } else if (token && typeof url === 'string') {
      opts.headers = { ...(opts.headers || {}), 'Authorization': `Bearer ${token}` };
    }
    return _origFetch(url, opts);
  };

  // ── UI ────────────────────────────────────────────────────────────────────

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #auth-overlay {
        position:fixed;inset:0;z-index:9999;
        background:var(--bg,#0a0a12);
        display:flex;align-items:center;justify-content:center;
        font-family:var(--font-sans,'Segoe UI',system-ui,sans-serif);
      }
      #auth-overlay.hidden { display:none; }
      .auth-box {
        background:var(--surface,#111);
        border:1px solid var(--border,#222);
        border-radius:12px;
        padding:2rem;
        width:100%;max-width:380px;
        box-shadow:0 8px 40px rgba(0,0,0,.6);
      }
      .auth-logo {
        text-align:center;
        font-size:1.4rem;font-weight:800;
        color:var(--accent,#7c3aed);
        margin-bottom:1.5rem;
        letter-spacing:.04em;
      }
      .auth-tabs {
        display:flex;border-bottom:1px solid var(--border,#222);
        margin-bottom:1.2rem;
      }
      .auth-tab {
        flex:1;padding:.5rem;text-align:center;cursor:pointer;
        font-size:.82rem;font-weight:600;
        color:var(--muted,#666);border-bottom:2px solid transparent;
        background:none;border-top:none;border-left:none;border-right:none;
        transition:color .15s,border-color .15s;
      }
      .auth-tab.active {
        color:var(--accent,#7c3aed);
        border-bottom-color:var(--accent,#7c3aed);
      }
      .auth-form { display:flex;flex-direction:column;gap:.75rem; }
      .auth-form input {
        background:var(--surface2,#1a1a2e);
        border:1px solid var(--border,#222);
        border-radius:6px;padding:.6rem .8rem;
        color:var(--text,#eee);font-size:.85rem;
        outline:none;transition:border-color .15s;
      }
      .auth-form input:focus { border-color:var(--accent,#7c3aed); }
      .auth-submit {
        background:var(--accent,#7c3aed);color:#fff;
        border:none;border-radius:6px;padding:.65rem;
        font-size:.85rem;font-weight:700;cursor:pointer;
        transition:opacity .15s;
      }
      .auth-submit:hover { opacity:.85; }
      .auth-submit:disabled { opacity:.5;cursor:not-allowed; }
      .auth-msg {
        font-size:.78rem;padding:.5rem .7rem;border-radius:5px;
        text-align:center;margin-top:.25rem;
      }
      .auth-msg.error  { background:#2a0a0a;color:#f87171; }
      .auth-msg.success { background:#0a2a0a;color:#4ade80; }
      .auth-msg.info   { background:#0a1a2a;color:#60a5fa; }

      /* Admin panel */
      /* Antes esto flotaba fixed en el mismo rincón que el FAB de Laia
         (.ai-fab: right:1.5rem;bottom:1.5rem;z-index:1000) y se pisaban
         visualmente. Lo subo por encima del FAB (54px + margen) y lo dejo
         más angosto, en la misma columna. */
      #admin-panel-btn {
        position:fixed;bottom:5.6rem;right:1.5rem;z-index:999;
        background:var(--accent,#7c3aed);color:#fff;
        border:none;border-radius:8px;padding:.4rem .8rem;
        font-size:.72rem;font-weight:700;cursor:pointer;opacity:.7;
      }
      #admin-panel-btn:hover { opacity:1; }
      #admin-overlay {
        position:fixed;inset:0;z-index:9998;
        background:rgba(0,0,0,.7);
        display:flex;align-items:center;justify-content:center;
      }
      #admin-overlay.hidden { display:none; }
      .admin-box {
        background:var(--surface,#111);
        border:1px solid var(--border,#222);
        border-radius:12px;padding:1.5rem;
        width:100%;max-width:560px;max-height:80vh;
        overflow-y:auto;
      }
      .admin-title {
        font-size:1rem;font-weight:700;color:var(--accent,#7c3aed);
        margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;
      }
      .admin-close { background:none;border:none;cursor:pointer;color:var(--muted);font-size:1.2rem; }
      .user-row {
        display:flex;align-items:center;gap:.5rem;
        padding:.5rem;border-bottom:1px solid var(--border,#1a1a2e);
        font-size:.78rem;flex-wrap:wrap;
      }
      .user-info { flex:1;min-width:150px; }
      .user-email { font-weight:600;color:var(--text,#eee); }
      .user-name  { color:var(--muted);font-size:.72rem; }
      .badge {
        font-size:.65rem;padding:.15rem .4rem;border-radius:3px;font-weight:700;
      }
      .badge-pending  { background:#2a1a00;color:#fbbf24; }
      .badge-approved { background:#0a2a0a;color:#4ade80; }
      .badge-rejected { background:#2a0a0a;color:#f87171; }
      .badge-admin    { background:#1a0a2a;color:#a78bfa; }
      .admin-actions { display:flex;gap:.3rem;flex-wrap:wrap; }
      .admin-btn {
        font-size:.68rem;padding:.2rem .5rem;border-radius:4px;cursor:pointer;
        border:none;font-weight:600;
      }
      .btn-approve { background:#14532d;color:#4ade80; }
      .btn-reject  { background:#7f1d1d;color:#fca5a5; }
      .btn-delete  { background:#1a1a1a;color:#6b7280; }
      .btn-approve:hover { background:#166534; }
      .btn-reject:hover  { background:#991b1b; }
      .btn-delete:hover  { background:#374151; }

      /* Usuario logueado en el header */
      #auth-user-bar {
        display:flex;align-items:center;gap:.5rem;margin-left:auto;
        display:flex;align-items:center;gap:.5rem;font-size:.72rem;
      }
      .auth-user-name { color:var(--muted);font-weight:600; }
      .auth-logout-btn {
        background:none;border:1px solid var(--border,#333);
        color:var(--muted);border-radius:4px;padding:.15rem .4rem;
        cursor:pointer;font-size:.68rem;
      }
      .auth-logout-btn:hover { color:var(--text,#eee); }
    `;
    document.head.appendChild(s);
  }

  function renderAuthOverlay() {
    const div = document.createElement('div');
    div.id = 'auth-overlay';
    div.innerHTML = `
      <div class="auth-box">
        <div class="auth-logo">🎚 MASTER Studio</div>
        <div class="auth-tabs">
          <button class="auth-tab active" id="tab-login">Iniciar sesión</button>
          <button class="auth-tab" id="tab-register">Registrarse</button>
        </div>

        <!-- Login -->
        <div id="form-login" class="auth-form">
          <input type="email" id="login-email" placeholder="Email" autocomplete="email">
          <input type="password" id="login-pwd" placeholder="Contraseña" autocomplete="current-password">
          <button class="auth-submit" id="login-btn">Ingresar</button>
          <div id="login-msg" class="auth-msg" style="display:none"></div>
        </div>

        <!-- Registro -->
        <div id="form-register" class="auth-form" style="display:none">
          <input type="text" id="reg-name" placeholder="Nombre completo">
          <input type="email" id="reg-email" placeholder="Email" autocomplete="email">
          <input type="password" id="reg-pwd" placeholder="Contraseña (mín. 8 caracteres)" autocomplete="new-password">
          <button class="auth-submit" id="register-btn">Crear cuenta</button>
          <div id="reg-msg" class="auth-msg" style="display:none"></div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    bindAuthEvents();
  }

  function renderUserBar(user) {
    const bar = document.createElement('div');
    bar.id = 'auth-user-bar';
    bar.innerHTML = `
      <span class="auth-user-name">👤 ${user.name || user.email}</span>
      <button class="auth-logout-btn" id="logout-btn">Cerrar sesión</button>
    `;
    // Se inserta DENTRO del <header> (junto al botón DEV) en vez de flotar
    // fixed sobre toda la página — antes pisaba visualmente al botón DEV
    // porque ambos ocupaban la esquina superior derecha al mismo tiempo.
    const headerEl = document.querySelector('header');
    (headerEl || document.body).appendChild(bar);
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      clearSession();
      location.reload();
    });
  }

  function renderAdminButton() {
    const btn = document.createElement('button');
    btn.id = 'admin-panel-btn';
    btn.textContent = '⚙ Admin';
    document.body.appendChild(btn);
    btn.addEventListener('click', openAdminPanel);
  }

  async function openAdminPanel() {
    let overlay = document.getElementById('admin-overlay');
    if (overlay) { overlay.classList.remove('hidden'); loadAdminUsers(); return; }

    overlay = document.createElement('div');
    overlay.id = 'admin-overlay';
    overlay.innerHTML = `
      <div class="admin-box">
        <div class="admin-title">
          <span>⚙ Panel de administración</span>
          <button class="admin-close" id="admin-close-btn">✕</button>
        </div>
        <div id="admin-users-list">Cargando…</div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
    document.getElementById('admin-close-btn')?.addEventListener('click', () => overlay.classList.add('hidden'));
    loadAdminUsers();
  }

  async function loadAdminUsers() {
    const list = document.getElementById('admin-users-list');
    if (!list) return;
    list.textContent = 'Cargando…';
    try {
      const res = await fetch(`${_apiUrl()}/auth/admin/users`);
      if (!res.ok) throw new Error(await res.text());
      const users = await res.json();
      if (!users.length) { list.innerHTML = '<div style="color:var(--muted);padding:.5rem">Sin usuarios registrados</div>'; return; }

      list.innerHTML = users.map(u => `
        <div class="user-row" data-id="${u.id}">
          <div class="user-info">
            <div class="user-email">${u.email}</div>
            <div class="user-name">${u.name}</div>
          </div>
          <span class="badge badge-${u.status}">${u.status}</span>
          ${u.role === 'admin' ? '<span class="badge badge-admin">admin</span>' : ''}
          <div class="admin-actions">
            ${u.status !== 'approved' ? `<button class="admin-btn btn-approve" data-action="approve" data-id="${u.id}">✓ Aprobar</button>` : ''}
            ${u.status !== 'rejected' && u.role !== 'admin' ? `<button class="admin-btn btn-reject" data-action="reject" data-id="${u.id}">✗ Rechazar</button>` : ''}
            ${u.role !== 'admin' ? `<button class="admin-btn btn-delete" data-action="delete" data-id="${u.id}">🗑</button>` : ''}
          </div>
        </div>
      `).join('');

      list.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        btn.disabled = true;
        try {
          let res;
          if (action === 'approve') res = await fetch(`${_apiUrl()}/auth/admin/approve/${id}`, { method: 'POST' });
          else if (action === 'reject') res = await fetch(`${_apiUrl()}/auth/admin/reject/${id}`, { method: 'POST' });
          else if (action === 'delete') {
            if (!confirm('¿Eliminar este usuario?')) { btn.disabled = false; return; }
            res = await fetch(`${_apiUrl()}/auth/admin/users/${id}`, { method: 'DELETE' });
          }
          if (!res?.ok) throw new Error(await res?.text());
          loadAdminUsers();
        } catch (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
        }
      });
    } catch (err) {
      list.innerHTML = `<div style="color:#f87171;padding:.5rem">Error: ${err.message}</div>`;
    }
  }

  function showMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `auth-msg ${type}`;
    el.style.display = 'block';
  }

  function bindAuthEvents() {
    // Tabs
    document.getElementById('tab-login')?.addEventListener('click', () => {
      document.getElementById('form-login').style.display = 'flex';
      document.getElementById('form-register').style.display = 'none';
      document.getElementById('tab-login').classList.add('active');
      document.getElementById('tab-register').classList.remove('active');
    });
    document.getElementById('tab-register')?.addEventListener('click', () => {
      document.getElementById('form-login').style.display = 'none';
      document.getElementById('form-register').style.display = 'flex';
      document.getElementById('tab-login').classList.remove('active');
      document.getElementById('tab-register').classList.add('active');
    });

    // Login
    const loginBtn = document.getElementById('login-btn');
    async function doLogin() {
      const email = document.getElementById('login-email')?.value?.trim();
      const pwd   = document.getElementById('login-pwd')?.value;
      if (!email || !pwd) { showMsg('login-msg', 'Completá todos los campos', 'error'); return; }
      loginBtn.disabled = true;
      try {
        const res = await _origFetch(`${_apiUrl()}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pwd }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Error de login');
        saveSession(data.access_token, data.user);
        document.getElementById('auth-overlay').classList.add('hidden');
        onAuthenticated(data.user);
      } catch (err) {
        showMsg('login-msg', err.message, 'error');
      } finally { loginBtn.disabled = false; }
    }
    loginBtn?.addEventListener('click', doLogin);
    document.getElementById('login-pwd')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    // Registro
    const regBtn = document.getElementById('register-btn');
    regBtn?.addEventListener('click', async () => {
      const name  = document.getElementById('reg-name')?.value?.trim();
      const email = document.getElementById('reg-email')?.value?.trim();
      const pwd   = document.getElementById('reg-pwd')?.value;
      if (!email || !pwd) { showMsg('reg-msg', 'Completá todos los campos', 'error'); return; }
      regBtn.disabled = true;
      try {
        const res = await _origFetch(`${_apiUrl()}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pwd, name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Error de registro');
        showMsg('reg-msg', '✓ Cuenta creada. Esperá la aprobación del administrador.', 'success');
        document.getElementById('reg-name').value = '';
        document.getElementById('reg-email').value = '';
        document.getElementById('reg-pwd').value = '';
      } catch (err) {
        showMsg('reg-msg', err.message, 'error');
      } finally { regBtn.disabled = false; }
    });
  }

  function onAuthenticated(user) {
    renderUserBar(user);
    if (user.role === 'admin') renderAdminButton();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    injectStyles();

    const token = getToken();
    const user  = getUser();

    if (token && user) {
      // Validar token con el servidor
      _origFetch(`${_apiUrl()}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      }).then(async res => {
        if (res.ok) {
          onAuthenticated(user);
        } else {
          clearSession();
          renderAuthOverlay();
        }
      }).catch(() => {
        // Si no hay servidor todavía, mostrar login igual
        renderAuthOverlay();
      });
    } else {
      renderAuthOverlay();
    }
  }

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
