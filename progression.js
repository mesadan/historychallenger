// History Challenger — shared progression helpers.
// Loaded by every game page (play, overlap, dialogue, paintings) and the
// profile page. Exposes:
//
//   window.hcProgression
//     last loaded progression payload (null until first fetch)
//
//   window.hcLoadProgression(force?)
//     returns a Promise<progression>. caches in memory + sessionStorage for
//     60 s so a page that reloads the intro a few times doesn't hammer the
//     worker. force=true bypasses the cache.
//
//   window.hcIsLocked(game, diff)
//     synchronous check against the cached payload. returns true/false.
//
//   window.hcLockedReason(game, diff)
//     a short human-readable string for tooltip/modal copy.
//
// All four mastery games (timeline / overlap / paintings / dialogue) share
// the same gating logic: master needs 500 disciple mastery; keeper needs
// 500 master mastery. HQ has no entry here (its skill metric is hq_score).
(function(){
const WORKER = 'https://histroychallenger-api.maletethan.workers.dev';
const CACHE_KEY = 'hc_progression_cache_v1';
const CACHE_TTL_MS = 60 * 1000;

window.hcProgression = null;

function getToken(){ return localStorage.getItem('hc_token'); }

function loadFromSession(){
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.ts) return null;
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return obj.data;
  } catch(e) { return null; }
}

function saveToSession(data){
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch(e) { /* quota or private mode, ignore */ }
}

window.hcLoadProgression = async function(force){
  if (!force) {
    const cached = loadFromSession();
    if (cached) { window.hcProgression = cached; return cached; }
  }
  try {
    const res = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_progression', token: getToken() }),
    });
    const d = await res.json();
    if (d && !d.error) {
      window.hcProgression = d;
      saveToSession(d);
      // Notify any listeners that data is ready
      try { window.dispatchEvent(new CustomEvent('hc-progression-loaded', { detail: d })); } catch(e) {}
      return d;
    }
  } catch(e) { /* network error: leave window.hcProgression null and degrade gracefully */ }
  return null;
};

window.hcIsLocked = function(game, diff){
  const p = window.hcProgression;
  if (!p || !p.mastery || !p.mastery[game] || !p.mastery[game][diff]) return false;
  return !p.mastery[game][diff].unlocked;
};

window.hcLockedReason = function(game, diff){
  const p = window.hcProgression;
  if (!p || !p.mastery || !p.mastery[game]) return '';
  const grid = p.mastery[game];
  const gateMaster = (p.gates && p.gates.master_threshold) || 500;
  const gateKeeper = (p.gates && p.gates.keeper_threshold) || 500;
  if (diff === 'master') {
    const have = grid.disciple ? grid.disciple.points : 0;
    return have + ' / ' + gateMaster + ' Disciple mastery';
  }
  if (diff === 'keeper') {
    const have = grid.master ? grid.master.points : 0;
    return have + ' / ' + gateKeeper + ' Master mastery';
  }
  return '';
};

// Auto-load on page load so by the time the intro renders, hcProgression is set.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.hcLoadProgression());
} else {
  window.hcLoadProgression();
}

// ── AUTH NUDGE ─────────────────────────────────────────────────────
// Inline banner shown to guests (no JWT in localStorage) after they
// finish a session. Single shared helper across all games so the copy
// and behaviour stay consistent. Dismiss is per-session (sessionStorage)
// so a guest who declines on Timeline doesn't get re-prompted on Overlap
// in the same browsing session, but a fresh tab still nudges.
//
// USAGE:
//   window.hcShowAuthNudge({ xp: 120, mastery: 80 })
//   window.hcShowAuthNudge()  // generic message
//
// Skips automatically if a hc_token is already in localStorage.
const NUDGE_DISMISS_KEY = 'hc_nudge_dismissed_v1';
const NUDGE_CSS = `
/* Hidden by default. Critically: display:none means the element does not
   participate in layout and cannot capture clicks, so the page footer
   (which sits in the same bottom area) stays clickable. */
#hc-auth-nudge{position:fixed;left:50%;bottom:18px;transform:translate(-50%, 30px);
  z-index:8500;display:none;opacity:0;transition:opacity .25s, transform .25s;
  background:#1a150e;color:#f5edd8;border:1px solid #c49020;border-radius:6px;
  box-shadow:0 12px 28px rgba(0,0,0,.55);
  padding:14px 18px;font-family:'Crimson Text',Georgia,serif;font-size:14px;line-height:1.45;
  max-width:520px;width:calc(100% - 36px);
  align-items:center;gap:14px;flex-wrap:wrap}
#hc-auth-nudge.show{display:flex;opacity:1;transform:translate(-50%, 0)}
#hc-auth-nudge .hc-nudge-text{flex:1;min-width:200px}
#hc-auth-nudge .hc-nudge-title{font-family:'Playfair Display',serif;font-style:italic;font-size:16px;color:#f5edd8;margin-bottom:2px}
#hc-auth-nudge .hc-nudge-sub{font-size:13px;color:#a08868;font-style:italic}
#hc-auth-nudge .hc-nudge-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}
#hc-auth-nudge .hc-nudge-signin{
  background:#c49020;color:#1a150e;border:1px solid #c8a028;border-radius:3px;
  padding:8px 14px;font-family:'Playfair Display',serif;font-style:italic;font-size:14px;
  cursor:pointer;font-weight:400}
#hc-auth-nudge .hc-nudge-signin:hover{background:#e0a84a}
#hc-auth-nudge .hc-nudge-dismiss{
  background:transparent;color:#a08868;border:none;font-family:'Crimson Text',serif;
  font-size:12px;cursor:pointer;padding:4px 8px;font-style:italic}
#hc-auth-nudge .hc-nudge-dismiss:hover{color:#f5edd8}
#hc-auth-nudge .hc-nudge-email{
  background:transparent;color:#c49020;border:1px solid #3a2a14;border-radius:3px;
  padding:7px 12px;font-family:'Crimson Text',serif;font-size:13px;cursor:pointer;font-style:italic}
#hc-auth-nudge .hc-nudge-email:hover{background:#241a0e;border-color:#c49020;color:#f5edd8}
#hc-auth-nudge.hc-nudge-form{flex-direction:column;align-items:stretch}
#hc-auth-nudge .hc-nudge-emailrow{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
#hc-auth-nudge .hc-nudge-input{
  flex:1;min-width:160px;background:#0d0a05;color:#f5edd8;border:1px solid #3a2a14;
  border-radius:3px;padding:8px 10px;font-family:'Crimson Text',serif;font-size:14px}
#hc-auth-nudge .hc-nudge-input:focus{outline:none;border-color:#c49020}
#hc-auth-nudge .hc-nudge-status{font-size:12px;color:#a08868;font-style:italic;margin-top:8px;min-height:16px}
#hc-auth-nudge .hc-nudge-status.err{color:#cc6644}
#hc-auth-nudge .hc-nudge-status.ok{color:#5acc8a}
@media(max-width:520px){
  #hc-auth-nudge{padding:12px 14px;left:12px;right:12px;width:auto;transform:translateY(30px)}
  #hc-auth-nudge.show{transform:translateY(0)}
  #hc-auth-nudge .hc-nudge-actions{flex-wrap:wrap}
}`;

function injectNudgeStyles(){
  if (document.getElementById('hc-auth-nudge-styles')) return;
  const s = document.createElement('style');
  s.id = 'hc-auth-nudge-styles';
  s.textContent = NUDGE_CSS;
  document.head.appendChild(s);
}

// Internal state used by the nudge to remember pending email + form mode.
let nudgeEarnedTitle = '';

function nudgeEnsureEl(){
  injectNudgeStyles();
  let el = document.getElementById('hc-auth-nudge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hc-auth-nudge';
    document.body.appendChild(el);
  }
  return el;
}

function nudgeRenderChoice(el){
  el.classList.remove('hc-nudge-form');
  el.innerHTML = `
    <div class="hc-nudge-text">
      <div class="hc-nudge-title">${nudgeEarnedTitle || 'Save your progress.'}</div>
      <div class="hc-nudge-sub">Sign in to track XP, mastery, streaks, and your full history across all games.</div>
    </div>
    <div class="hc-nudge-actions">
      <button class="hc-nudge-signin" onclick="window.hcNudgeSignIn()">Sign in with Google</button>
      <button class="hc-nudge-email" onclick="window.hcNudgeShowEmailForm()">Use email instead</button>
      <button class="hc-nudge-dismiss" onclick="window.hcNudgeDismiss()">Maybe later</button>
    </div>`;
}

function nudgeRenderEmailForm(el){
  el.classList.add('hc-nudge-form');
  el.innerHTML = `
    <div class="hc-nudge-text" style="width:100%">
      <div class="hc-nudge-title">Sign in by email</div>
      <div class="hc-nudge-sub">We'll email you a one-time link. The link expires in 15 minutes.</div>
      <form class="hc-nudge-emailrow" onsubmit="window.hcNudgeSubmitEmail(event)">
        <input id="hc-nudge-email-input" type="email" required autocomplete="email"
               placeholder="you@example.com" class="hc-nudge-input">
        <button type="submit" class="hc-nudge-signin">Send link</button>
        <button type="button" class="hc-nudge-dismiss" onclick="window.hcNudgeBackToChoice()">Back</button>
      </form>
      <div id="hc-nudge-status" class="hc-nudge-status"></div>
    </div>`;
  setTimeout(() => { const inp = document.getElementById('hc-nudge-email-input'); if (inp) inp.focus(); }, 50);
}

function nudgeRenderSent(el, email){
  el.classList.add('hc-nudge-form');
  el.innerHTML = `
    <div class="hc-nudge-text" style="width:100%">
      <div class="hc-nudge-title">Check your inbox</div>
      <div class="hc-nudge-sub">We sent a sign-in link to <strong style="color:#f5edd8">${email.replace(/[<>&]/g,'')}</strong>. Click it within 15 minutes to finish signing in. (Check your spam folder if you don't see it.)</div>
      <div class="hc-nudge-actions" style="margin-top:10px">
        <button class="hc-nudge-dismiss" onclick="window.hcNudgeDismiss()">Close</button>
      </div>
    </div>`;
}

window.hcShowAuthNudge = function(opts){
  // Skip if already signed in
  if (localStorage.getItem('hc_token')) return;

  const force = !!(opts && opts.force);
  // Skip if dismissed this browsing session, unless force=true (user
  // explicitly clicked the Sign in button)
  if (!force) {
    try { if (sessionStorage.getItem(NUDGE_DISMISS_KEY)) return; } catch(e) {}
  } else {
    // Clear dismiss so the close button works the next time too
    try { sessionStorage.removeItem(NUDGE_DISMISS_KEY); } catch(e) {}
  }

  const xp = opts && typeof opts.xp === 'number' ? opts.xp : null;
  const mastery = opts && typeof opts.mastery === 'number' ? opts.mastery : null;
  let earned = '';
  if (xp != null && xp > 0 && mastery != null && mastery > 0) earned = `${xp} XP and ${mastery} Mastery`;
  else if (xp != null && xp > 0) earned = `${xp} XP`;
  else if (mastery != null && mastery > 0) earned = `${mastery} Mastery`;
  if (earned) {
    nudgeEarnedTitle = `You earned ${earned} this session.`;
  } else if (force) {
    nudgeEarnedTitle = 'Sign in or create your account';
  } else {
    nudgeEarnedTitle = '';
  }

  const el = nudgeEnsureEl();
  nudgeRenderChoice(el);
  requestAnimationFrame(() => el.classList.add('show'));
};

window.hcNudgeSignIn = function(){
  // Use the global sign-in if a page exposed it; otherwise route to profile
  // (which handles the OAuth flow on every page).
  if (typeof window._hcSignIn === 'function') {
    try { window._hcSignIn(); return; } catch(e) {}
  }
  window.location.href = '/profile';
};

window.hcNudgeShowEmailForm = function(){
  const el = document.getElementById('hc-auth-nudge');
  if (el) nudgeRenderEmailForm(el);
};

window.hcNudgeBackToChoice = function(){
  const el = document.getElementById('hc-auth-nudge');
  if (el) nudgeRenderChoice(el);
};

window.hcNudgeSubmitEmail = async function(ev){
  if (ev) ev.preventDefault();
  const inp = document.getElementById('hc-nudge-email-input');
  const status = document.getElementById('hc-nudge-status');
  if (!inp) return;
  const email = inp.value.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    if (status) { status.textContent = 'Please enter a valid email address.'; status.className = 'hc-nudge-status err'; }
    return;
  }
  if (status) { status.textContent = 'Sending...'; status.className = 'hc-nudge-status'; }
  // Disable inputs during request
  inp.disabled = true;
  const btn = inp.parentElement.querySelector('.hc-nudge-signin');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('https://histroychallenger-api.maletethan.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request_magic_link', email }),
    });
    const d = await res.json();
    if (d.error) {
      if (status) { status.textContent = d.error; status.className = 'hc-nudge-status err'; }
      inp.disabled = false;
      if (btn) btn.disabled = false;
      return;
    }
    const el = document.getElementById('hc-auth-nudge');
    if (el) nudgeRenderSent(el, email);
  } catch(e) {
    if (status) { status.textContent = 'Network error. Try again.'; status.className = 'hc-nudge-status err'; }
    inp.disabled = false;
    if (btn) btn.disabled = false;
  }
};

window.hcNudgeDismiss = function(){
  try { sessionStorage.setItem(NUDGE_DISMISS_KEY, '1'); } catch(e) {}
  const el = document.getElementById('hc-auth-nudge');
  if (el) el.classList.remove('show');
};
})();
