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
})();
