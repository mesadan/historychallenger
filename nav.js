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
  color:#9a8060;font-size:14px;text-decoration:none;
  font-family:'Crimson Text',Georgia,serif;
  padding:5px 13px;border-radius:2px;
  letter-spacing:.04em;transition:color .15s;
}
#hc-nav .hc-link:hover{color:#f5edd8;}
#hc-nav .hc-link.active{color:#c49020;}
.hcn-signin{background:#8a6208;color:#f5edd8;border:1px solid #b88a18;border-radius:2px;padding:6px 16px;font-size:14px;font-family:'Playfair Display',Georgia,serif;font-style:italic;cursor:pointer;white-space:nowrap}
.hcn-signin:hover{background:#b88a18}
`;
document.head.appendChild(s);
function injectNav(){
  if(document.getElementById('hc-nav')) return;
  const nav = document.createElement('nav');
  nav.id = 'hc-nav';
  nav.innerHTML = '<a href="/" class="hc-logo">History <span>Challenger</span></a><div class="hc-links"><a href="/dispatch.html" class="hc-link">Dispatch</a><a href="/play.html" class="hc-link">Timeline</a><a href="/overlap.html" class="hc-link">Overlap</a><div id="nav-auth-area"></div></div>';
  document.body.insertBefore(nav, document.body.firstChild);
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',injectNav);}else{injectNav();}
})();
