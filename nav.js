/**
 * History Challenger — Shared Navigation & Auth
 * Include this on every page with:
 *   <div id="site-nav"></div>
 *   <script src="/nav.js"></script>
 */

(function() {

const WORKER = 'https://histroychallenger-api.maletethan.workers.dev';
const GOOGLE_CLIENT_ID = '413171729958-s5kimtsskjsfsu45ao1ah0gob8f4ghn9.apps.googleusercontent.com';

// ── INJECT CSS ────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
#hc-nav{position:sticky;top:0;z-index:200;background:rgba(0,0,0,0.92);backdrop-filter:blur(12px);border-bottom:1px solid #1a1a1a;padding:0 1.5rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
#hc-nav .hcn-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:56px;gap:12px}
#hc-nav .hcn-logo{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0}
#hc-nav .hcn-logo-text{font-family:Georgia,serif;font-size:17px;font-weight:700;color:#fff}
#hc-nav .hcn-logo-text span{color:#c8903a}
#hc-nav .hcn-links{display:flex;align-items:center;gap:6px;flex-wrap:nowrap}
#hc-nav .hcn-link{color:#777;font-size:13px;text-decoration:none;padding:5px 10px;border-radius:6px;white-space:nowrap;transition:color .15s}
#hc-nav .hcn-link:hover{color:#fff}
#hc-nav .hcn-link.active{color:#c8903a}
#hc-nav .hcn-play{background:#c8903a;color:#000!important;border-radius:7px;padding:6px 14px;font-weight:700;font-size:13px}
#hc-nav .hcn-play:hover{background:#e0a84a}
#hc-nav .hcn-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
#hc-nav .hcn-signin{background:#c8903a;color:#000;border:none;border-radius:7px;padding:6px 13px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
#hc-nav .hcn-signin:hover{background:#e0a84a}
#hc-nav .hcn-user-btn{display:flex;align-items:center;gap:7px;background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;color:#aaa}
#hc-nav .hcn-user-btn:hover{border-color:#555;color:#fff}
#hc-nav .hcn-avatar{width:22px;height:22px;border-radius:50%;object-fit:cover}
#hc-nav .hcn-uname{max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#hc-nav .hcn-menu{position:fixed;top:56px;right:12px;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:10px;padding:8px;min-width:190px;z-index:300;box-shadow:0 8px 32px rgba(0,0,0,.8);display:none}
#hc-nav .hcn-menu.open{display:block}
#hc-nav .hcn-menu-stats{display:flex;gap:12px;padding:8px 12px 8px;border-bottom:1px solid #1a1a1a;margin-bottom:4px}
#hc-nav .hcn-stat-val{font-size:16px;font-weight:700;color:#c8903a;font-family:Georgia,serif}
#hc-nav .hcn-stat-lbl{font-size:10px;color:#555}
#hc-nav .hcn-menu-item{display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;border-radius:6px;color:#aaa;font-family:-apple-system,sans-serif;font-size:13px;cursor:pointer;text-decoration:none}
#hc-nav .hcn-menu-item:hover{background:#1a1a1a;color:#fff}
#hc-nav .hcn-menu-item.danger{color:#e06040}
#hc-nav .hcn-divider{border:none;border-top:1px solid #2a2a2a;margin:4px 0}
@media(max-width:640px){
  #hc-nav .hcn-link:not(.hcn-play){display:none}
  #hc-nav .hcn-uname{display:none}
}
`;
document.head.appendChild(style);

// ── DETECT CURRENT PAGE ───────────────────────────────────────────
const path = window.location.pathname;
function isActive(href) {
  if (href === '/') return path === '/' || path === '/index.html';
  return path.includes(href.replace('/', ''));
}

// ── INJECT HTML ───────────────────────────────────────────────────
function renderNav(user) {
  const navEl = document.getElementById('site-nav');
  if (!navEl) return;

  navEl.innerHTML = `
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
          <a href="/games.html" class="hcn-link hcn-play ${isActive('/games')||isActive('/play')||isActive('/overlap')?'':''}">Play →</a>
          <a href="/blog.html" class="hcn-link ${isActive('/blog')?'active':''}">Blog</a>
        </div>
        <div class="hcn-right" id="hcn-right">
          ${user ? `
            <button class="hcn-user-btn" id="hcn-user-btn" onclick="window._hcNavToggleMenu()">
              ${user.avatar ? `<img class="hcn-avatar" src="${user.avatar}" alt="">` : '<span style="font-size:16px">👤</span>'}
              <span class="hcn-uname">${user.name || user.email.split('@')[0]}</span>
              <span style="color:#555;font-size:10px">▾</span>
            </button>
            <div class="hcn-menu" id="hcn-menu">
              <div class="hcn-menu-stats">
                <div><div class="hcn-stat-val">${user.total_games || 0}</div><div class="hcn-stat-lbl">Games</div></div>
                <div><div class="hcn-stat-val">${user.avg_score ? Math.round(user.avg_score) + '%' : '—'}</div><div class="hcn-stat-lbl">Avg</div></div>
                <div><div class="hcn-stat-val">${user.current_streak || 0}</div><div class="hcn-stat-lbl">Streak</div></div>
              </div>
              <hr class="hcn-divider">
              <a href="/profile.html" class="hcn-menu-item">📊 My profile</a>
              <a href="/play.html" class="hcn-menu-item">🧭 History Challenger</a>
              <a href="/overlap.html" class="hcn-menu-item">🏛 Did They Overlap?</a>
              <hr class="hcn-divider">
              <button class="hcn-menu-item danger" onclick="window._hcNavSignOut()">Sign out</button>
            </div>
          ` : `
            <button class="hcn-signin" onclick="window._hcNavSignIn()">Sign in</button>
          `}
        </div>
      </div>
    </nav>`;
}

// ── AUTH ──────────────────────────────────────────────────────────
window._hcNavSignIn = function() {
  const redirect = 'https://historychallenger.com/auth-callback.html?from=' + encodeURIComponent(window.location.pathname);
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

window._hcNavSignOut = function() {
  localStorage.removeItem('hc_token');
  window.location.reload();
};

window._hcNavToggleMenu = function() {
  const menu = document.getElementById('hcn-menu');
  if (menu) menu.classList.toggle('open');
};

// Close menu on outside click
document.addEventListener('click', function(e) {
  const menu = document.getElementById('hcn-menu');
  const btn = document.getElementById('hcn-user-btn');
  if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// ── INIT ──────────────────────────────────────────────────────────
async function initNav() {
  const token = localStorage.getItem('hc_token');
  if (!token) { renderNav(null); return; }
  try {
    const res = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify_token', token })
    });
    const data = await res.json();
    if (data.user) { renderNav(data.user); return; }
  } catch(e) {}
  renderNav(null);
}

initNav();

})();
