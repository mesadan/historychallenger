/**
 * History Challenger — Single Auth Layer
 * Renders sign-in / profile widget in #nav-auth-area on every page.
 * This is the ONLY place auth UI is rendered.
 */
(function(){
const WORKER='https://histroychallenger-api.maletethan.workers.dev';
const CLIENT_ID='413171729958-s5kimtsskjsfsu45ao1ah0gob8f4ghn9.apps.googleusercontent.com';

// Inject styles
const s=document.createElement('style');
s.textContent=`
.hcn-signin{background:#c8903a;color:#000;border:none;border-radius:7px;padding:6px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:-apple-system,sans-serif;white-space:nowrap}
.hcn-signin:hover{background:#e0a84a}
.hcn-user-wrap{position:relative}
.hcn-user-btn{display:flex;align-items:center;gap:7px;background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;color:#aaa;font-family:-apple-system,sans-serif;-webkit-tap-highlight-color:transparent}
.hcn-user-btn:hover{border-color:#555;color:#fff}
.hcn-avatar{width:24px;height:24px;border-radius:50%;object-fit:cover}
.hcn-uname{max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hcn-chevron{color:#555;font-size:10px}
.hcn-menu{position:fixed;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:10px;padding:8px;min-width:200px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.9);display:none}
.hcn-menu.open{display:block}
.hcn-menu-stats{display:flex;gap:16px;padding:8px 12px 10px;border-bottom:1px solid #1a1a1a;margin-bottom:4px}
.hcn-sv{font-size:18px;font-weight:700;color:#c8903a;font-family:Georgia,serif;display:block}
.hcn-sl{font-size:10px;color:#555;font-family:-apple-system,sans-serif;display:block}
.hcn-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 12px;background:none;border:none;border-radius:6px;color:#aaa;font-family:-apple-system,sans-serif;font-size:13px;cursor:pointer;text-decoration:none}
.hcn-item:hover{background:#1a1a1a;color:#fff}
.hcn-item.red{color:#e06040}
.hcn-hr{border:none;border-top:1px solid #1a1a1a;margin:4px 0}
@media(max-width:600px){.hcn-uname{display:none}}
`;
document.head.appendChild(s);

function signIn(){
  const p=new URLSearchParams({
    client_id:CLIENT_ID,
    redirect_uri:'https://historychallenger.com/auth-callback.html',
    response_type:'code',scope:'openid email profile',
    access_type:'offline',prompt:'select_account',
    state:window.location.pathname
  });
  window.location.href='https://accounts.google.com/o/oauth2/v2/auth?'+p;
}
// Expose globally so inline onclick on landing page works too
window._hcSignIn=signIn;

function signOut(){
  localStorage.removeItem('hc_token');
  // Notify any game pages listening
  window._hcUser=null;
  render(null);
  // Reload so game pages reset their state
  window.location.reload();
}

function toggleMenu(){
  const m=document.getElementById('hcn-menu');
  if(!m)return;
  if(m.classList.contains('open')){
    m.classList.remove('open');
    return;
  }
  // Position menu under the button
  const btn=document.getElementById('hcn-user-btn');
  if(btn){
    const r=btn.getBoundingClientRect();
    m.style.top=(r.bottom+6)+'px';
    m.style.right=(window.innerWidth-r.right)+'px';
  }
  m.classList.add('open');
}
window._hcToggleMenu=toggleMenu;

// Close on outside click
document.addEventListener('click',function(e){
  const m=document.getElementById('hcn-menu');
  const b=document.getElementById('hcn-user-btn');
  if(m&&b&&!b.contains(e.target)&&!m.contains(e.target))m.classList.remove('open');
});

function render(user){
  const area=document.getElementById('nav-auth-area');
  if(!area)return;
  if(!user){
    area.innerHTML=`<button class="hcn-signin" onclick="window._hcSignIn()">Sign in</button>`;
    return;
  }
  area.innerHTML=`
    <div class="hcn-user-wrap">
      <button class="hcn-user-btn" id="hcn-user-btn" onclick="window._hcToggleMenu()">
        ${user.avatar?`<img class="hcn-avatar" src="${user.avatar}" alt="">`:'<span style="font-size:18px;line-height:1">👤</span>'}
        <span class="hcn-uname">${user.name||user.email.split('@')[0]}</span>
        <span class="hcn-chevron">▾</span>
      </button>
      <div class="hcn-menu" id="hcn-menu">
        <div class="hcn-menu-stats">
          <div><span class="hcn-sv">${user.total_games||0}</span><span class="hcn-sl">Games</span></div>
          <div><span class="hcn-sv">${user.avg_score?Math.round(user.avg_score)+'%':'—'}</span><span class="hcn-sl">Avg</span></div>
          <div><span class="hcn-sv">${user.current_streak||0}</span><span class="hcn-sl">Streak</span></div>
        </div>
        <hr class="hcn-hr">
        <a href="/profile.html" class="hcn-item">📊 My profile</a>
        <a href="/play.html" class="hcn-item">🧭 History Challenger</a>
        <a href="/overlap.html" class="hcn-item">⏳ Did They Overlap?</a>
        <a href="/games.html" class="hcn-item">🎮 All games</a>
        <hr class="hcn-hr">
        <button class="hcn-item red" onclick="window._hcSignOut()">Sign out</button>
      </div>
    </div>`;
  // Expose user globally so game pages can read it
  window._hcUser=user;
}
window._hcSignOut=signOut;

async function init(){
  const token=localStorage.getItem('hc_token');
  if(!token){render(null);return;}
  try{
    const res=await fetch(WORKER,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'verify_token',token})});
    const d=await res.json();
    if(d.user){render(d.user);return;}
  }catch(e){}
  render(null);
}

init();
})();
