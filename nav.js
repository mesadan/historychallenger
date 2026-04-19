/**
 * History Challenger — Shared Auth + Parchment Nav
 */
(function(){
const WORKER='https://histroychallenger-api.maletethan.workers.dev';
const CLIENT_ID='413171729958-s5kimtsskjsfsu45ao1ah0gob8f4ghn9.apps.googleusercontent.com';

const s=document.createElement('style');
s.textContent=`
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');

/* ── PARCHMENT NAV ── */
#hc-nav{
  background:#1a150e;
  border-bottom:1px solid #3a2a14;
  padding:0 24px;
  position:sticky;top:0;z-index:500;
  display:flex;align-items:center;justify-content:space-between;
  height:54px;
}
#hc-nav .hc-logo{
  font-family:'Playfair Display',Georgia,serif;
  font-size:17px;font-weight:400;font-style:italic;
  color:#f5edd8;text-decoration:none;letter-spacing:.02em;
}
#hc-nav .hc-logo span{color:#c49020;}
#hc-nav .hc-links{display:flex;align-items:center;gap:6px;}
#hc-nav .hc-link{
  color:#9a8060;font-size:13px;text-decoration:none;
  font-family:'Crimson Text',Georgia,serif;
  padding:5px 11px;border-radius:2px;
  letter-spacing:.04em;transition:color .15s;
}
#hc-nav .hc-link:hover{color:#f5edd8;}
#hc-nav .hc-link.active{color:#c49020;}
#hc-nav .hc-play{
  background:#9a7010;color:#f5edd8;
  border:1px solid #c49020;border-radius:2px;
  padding:5px 14px;font-family:'Playfair Display',Georgia,serif;
  font-size:13px;font-style:italic;
  transition:background .15s;
}
#hc-nav .hc-play:hover{background:#c49020;}

/* auth widget */
.hcn-signin{background:#9a7010;color:#f5edd8;border:1px solid #c49020;border-radius:2px;padding:5px 14px;font-size:13px;font-family:'Playfair Display',Georgia,serif;font-style:italic;cursor:pointer;white-space:nowrap}
.hcn-signin:hover{background:#c49020}
.hcn-user-wrap{position:relative}
.hcn-user-btn{display:flex;align-items:center;gap:7px;background:#241a0e;border:1px solid #3a2a14;border-radius:2px;padding:5px 10px;cursor:pointer;font-size:12px;color:#9a8060;font-family:'Crimson Text',Georgia,serif;-webkit-tap-highlight-color:transparent}
.hcn-user-btn:hover{border-color:#c49020;color:#f5edd8}
.hcn-avatar{width:22px;height:22px;border-radius:50%;object-fit:cover}
.hcn-uname{max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hcn-menu{position:fixed;background:#1a150e;border:1px solid #3a2a14;border-radius:3px;padding:8px;min-width:200px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.95);display:none}
.hcn-menu.open{display:block}
.hcn-menu-stats{display:flex;gap:16px;padding:8px 12px 10px;border-bottom:1px solid #3a2a14;margin-bottom:4px}
.hcn-sv{font-size:18px;font-weight:700;color:#c49020;font-family:'Playfair Display',Georgia,serif;display:block}
.hcn-sl{font-size:10px;color:#7a6040;font-family:'Crimson Text',Georgia,serif;display:block;text-transform:uppercase;letter-spacing:.08em}
.hcn-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 12px;background:none;border:none;border-radius:2px;color:#9a8060;font-family:'Crimson Text',Georgia,serif;font-size:14px;cursor:pointer;text-decoration:none}
.hcn-item:hover{background:#241a0e;color:#f5edd8}
.hcn-item.red{color:#c05040}
.hcn-hr{border:none;border-top:1px solid #3a2a14;margin:4px 0}
@media(max-width:600px){.hcn-uname{display:none}.hc-link:not(.hc-play){display:none}}
`;
document.head.appendChild(s);

// Inject nav
function injectNav(){
  if(document.getElementById('hc-nav')) return;
  const path = window.location.pathname;
  const nav = document.createElement('nav');
  nav.id = 'hc-nav';
  const links = [
    {href:'/dispatch.html', label:'Dispatch', key:'dispatch'},
    {href:'/play.html',     label:'Timeline', key:'play'},
    {href:'/overlap.html',  label:'Overlap',  key:'overlap'},
  ];
  const linksHtml = links.map(l=>{
    const active = path.includes(l.key) ? ' active' : '';
    return `<a href="${l.href}" class="hc-link${active}">${l.label}</a>`;
  }).join('');
  nav.innerHTML = `
    <a href="/" class="hc-logo">History <span>Challenger</span></a>
    <div class="hc-links">
      ${linksHtml}
      <div id="nav-auth-area"></div>
    </div>`;
  document.body.insertBefore(nav, document.body.firstChild);
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', injectNav);
} else {
  injectNav();
}

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
window._hcSignIn=signIn;

function signOut(){
  localStorage.removeItem('hc_token');
  window._hcUser=null;
  render(null);
  window.location.reload();
}

function toggleMenu(){
  const m=document.getElementById('hcn-menu');
  if(!m)return;
  if(m.classList.contains('open')){m.classList.remove('open');return;}
  const btn=document.getElementById('hcn-user-btn');
  if(btn){
    const r=btn.getBoundingClientRect();
    m.style.top=(r.bottom+6)+'px';
    m.style.right=(window.innerWidth-r.right)+'px';
  }
  m.classList.add('open');
}
window._hcToggleMenu=toggleMenu;

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
        <span style="color:#7a6040;font-size:10px">▾</span>
      </button>
      <div class="hcn-menu" id="hcn-menu">
        <div class="hcn-menu-stats">
          <div><span class="hcn-sv">${user.total_games||0}</span><span class="hcn-sl">Games</span></div>
          <div><span class="hcn-sv">${user.avg_score?Math.round(user.avg_score)+'%':'—'}</span><span class="hcn-sl">Avg</span></div>
          <div><span class="hcn-sv">${user.current_streak||0}</span><span class="hcn-sl">Streak</span></div>
        </div>
        <hr class="hcn-hr">
        <a href="/profile.html" class="hcn-item">📊 My profile</a>
        <a href="/dispatch.html" class="hcn-item">⚔ Dispatch</a>
        <a href="/play.html" class="hcn-item">🧭 History Challenger</a>
        <a href="/overlap.html" class="hcn-item">⏳ Did They Overlap?</a>
        <hr class="hcn-hr">
        <button class="hcn-item red" onclick="window._hcSignOut()">Sign out</button>
      </div>
    </div>`;
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
    if(d.valid&&d.user)render(d.user);
    else{localStorage.removeItem('hc_token');render(null);}
  }catch{render(null);}
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}
})();
