/**
 * History Challenger — Shared Auth Nav
 * Injects sign-in / user menu into any page.
 * If a #nav-auth-area div exists, injects just the auth widget there.
 * If a #site-nav div exists, injects a full nav bar there.
 * Otherwise prepends a full nav to <body>.
 */
(function() {

const WORKER = 'https://histroychallenger-api.maletethan.workers.dev';
const GOOGLE_CLIENT_ID = '413171729958-s5kimtsskjsfsu45ao1ah0gob8f4ghn9.apps.googleusercontent.com';

// ── CSS ───────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
/* Full nav — only shown on pages without their own nav */
#hc-nav{position:sticky;top:0;z-index:200;background:rgba(0,0,0,0.92);backdrop-filter:blur(12px);border-bottom:1px solid #1a1a1a;padding:0 1.5rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
#hc-nav .hcn-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:56px;gap:12px}
#hc-nav .hcn-logo{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0}
#hc-nav .hcn-logo-text{font-family:Georgia,serif;font-size:17px;font-weight:700;color:#fff}
#hc-nav .hcn-logo-text span{color:#c8903a}
#hc-nav .hcn-links{display:flex;align-items:center;gap:6px}
#hc-nav .hcn-link{color:#777;font-size:13px;text-decoration:none;padding:5px 10px;border-radius:6px;white-space:nowrap;transition:color .15s}
#hc-nav .hcn-link:hover{color:#fff}
#hc-nav .hcn-play{background:#c8903a;color:#000!important;border-radius:7px;padding:6px 14px;font-weight:700;font-size:13px}
#hc-nav .hcn-play:hover{background:#e0a84a}
@media(max-width:640px){#hc-nav .hcn-link:not(.hcn-play){display:none}}

/* Auth widget — used everywhere */
.hcn-signin{background:#c8903a;color:#000;border:none;border-radius:7px;padding:6px 13px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:-apple-system,sans-serif}
.hcn-signin:hover{background:#e0a84a}
.hcn-user-wrap{position:relative}
.hcn-user-btn{display:flex;align-items:center;gap:7px;background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;color:#aaa;font-family:-apple-system,sans-serif}
.hcn-user-btn:hover{border-color:#555;color:#fff}
.hcn-avatar{width:22px;height:22px;border-radius:50%;object-fit:cover}
.hcn-uname{max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hcn-menu{position:fixed;top:56px;right:12px;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:10px;padding:8px;min-width:190px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.9);display:none}
.hcn-menu.open{display:block}
.hcn-menu-stats{display:flex;gap:12px;padding:8px 12px;border-bottom:1px solid #1a1a1a;margin-bottom:4px}
.hcn-stat-val{font-size:16px;font-weight:700;color:#c8903a;font-family:Georgia,serif;display:block}
.hcn-stat-lbl{font-size:10px;color:#555;font-family:-apple-system,sans-serif;display:block}
.hcn-menu-item{display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;border-radius:6px;color:#aaa;font-family:-apple-system,sans-serif;font-size:13px;cursor:pointer;text-decoration:none}
.hcn-menu-item:hover{background:#1a1a1a;color:#fff}
.hcn-menu-item.danger{color:#e06040}
.hcn-divider{border:none;border-top:1px solid #2a2a2a;margin:4px 0}
@media(max-width:640px){.hcn-uname{display:none}}
`;
document.head.appendChild(style);

// ── AUTH WIDGET HTML ──────────────────────────────────────────────
function authWidget(user) {
  if (!user) {
    return `<button class="hcn-signin" onclick="window._hcSignIn()">Sign in</button>`;
  }
  return `
    <div class="hcn-user-wrap">
      <button class="hcn-user-btn" id="hcn-user-btn" onclick="window._hcToggleMenu()">
        ${user.avatar ? `<img class="hcn-avatar" src="${user.avatar}" alt="">` : '<span style="font-size:15px">👤</span>'}
        <span class="hcn-uname">${user.name || user.email.split('@')[0]}</span>
        <span style="color:#555;font-size:10px">▾</span>
      </button>
      <div class="hcn-menu" id="hcn-menu">
        <div class="hcn-menu-stats">
          <div><span class="hcn-stat-val">${user.total_games || 0}</span><span class="hcn-stat-lbl">Games</span></div>
          <div><span class="hcn-stat-val">${user.avg_score ? Math.round(user.avg_score) + '%' : '—'}</span><span class="hcn-stat-lbl">Avg</span></div>
          <div><span class="hcn-stat-val">${user.current_streak || 0}</span><span class="hcn-stat-lbl">Streak</span></div>
        </div>
        <hr class="hcn-divider">
        <a href="/profile.html" class="hcn-menu-item">📊 My profile</a>
        <a href="/play.html" class="hcn-menu-item">🧭 History Challenger</a>
        <a href="/overlap.html" class="hcn-menu-item">⏳ Did They Overlap?</a>
        <hr class="hcn-divider">
        <button class="hcn-menu-item danger" onclick="window._hcSignOut()">Sign out</button>
      </div>
    </div>`;
}

// ── FULL NAV HTML ─────────────────────────────────────────────────
function fullNav(user) {
  const path = window.location.pathname;
  const active = href => path.includes(href) ? 'style="color:#c8903a"' : '';
  return `
    <nav id="hc-nav">
      <div class="hcn-inner">
        <a href="/" class="hcn-logo">
          <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#c8903a" stroke-width="1.2"/>
            <circle cx="18" cy="18" r="14" stroke="#c8903a" stroke-width="0.4" stroke-dasharray="2 2"/>
            <text x="18" y="23" text-anchor="middle" font-family="Georgia,serif" font-size="12" font-weight="700" fill="#c8903a" letter-spacing="-0.5">HC</text>
          </svg>
          <div class="hcn-logo-text">History <span>Challenger</span></div>
        </a>
        <div class="hcn-links">
          <a href="/games.html" class="hcn-link hcn-play">Play →</a>
          <a href="/blog.html" class="hcn-link" ${active('blog')}>Blog</a>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${authWidget(user)}
        </div>
      </div>
    </nav>`;
}

// ── RENDER ────────────────────────────────────────────────────────
function renderAuth(user) {
  // Option 1: page has a #nav-auth-area — inject just the widget
  const authArea = document.getElementById('nav-auth-area');
  if (authArea) {
    authArea.innerHTML = authWidget(user);
    return;
  }

  // Option 2: page has a #site-nav placeholder — inject full nav
  let navEl = document.getElementById('site-nav');
  if (!navEl) {
    // Option 3: no placeholder — prepend full nav to body
    navEl = document.createElement('div');
    navEl.id = 'site-nav';
    document.body.insertBefore(navEl, document.body.firstChild);
  }
  navEl.innerHTML = fullNav(user);
}

// ── ACTIONS ───────────────────────────────────────────────────────
window._hcSignIn = function() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: 'https://historychallenger.com/auth-callback.html',
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state: window.location.pathname
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
};

window._hcSignOut = function() {
  localStorage.removeItem('hc_token');
  window.location.reload();
};

window._hcToggleMenu = function() {
  const menu = document.getElementById('hcn-menu');
  const btn = document.getElementById('hcn-user-btn');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  if (!isOpen && btn) {
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.position = 'fixed';
  }
  menu.classList.toggle('open');
};

document.addEventListener('click', function(e) {
  const menu = document.getElementById('hcn-menu');
  const btn = document.getElementById('hcn-user-btn');
  if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// ── INIT ──────────────────────────────────────────────────────────
async function initNavAuth() {
  // Skip on pages with their own full auth (play, overlap, profile)
  const skipMeta = document.querySelector('meta[name="hc-nav"][content="skip"]');
  if (skipMeta) return;

  const token = localStorage.getItem('hc_token');
  if (!token) { renderAuth(null); return; }
  try {
    const res = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify_token', token })
    });
    const data = await res.json();
    if (data.user) { renderAuth(data.user); return; }
  } catch(e) {}
  renderAuth(null);
}

initNavAuth();

})();
