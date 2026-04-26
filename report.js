// History Challenger, Report widget.
// Auto-injects a floating "Report" button + modal on any page that loads it.
// A game page sets the current context with window.hcSetReportContext({...})
// and clears it with window.hcClearReportContext(). The button only appears
// while a context is set.
(function(){
const WORKER = 'https://histroychallenger-api.maletethan.workers.dev';
const COMMENT_LIMIT = 280;

let _ctx = null;

const css = `
#hc-report-btn{
  position:fixed;right:18px;bottom:18px;z-index:9000;
  background:#1a150e;color:#f5edd8;border:1px solid #c49020;
  border-radius:24px;padding:9px 16px 9px 12px;
  font-family:'Crimson Text',Georgia,serif;font-size:13px;
  cursor:pointer;display:none;align-items:center;gap:6px;
  box-shadow:0 4px 14px rgba(0,0,0,.35);
  transition:transform .12s, background .12s;
  -webkit-tap-highlight-color:transparent;
}
#hc-report-btn:hover{background:#241a0e;transform:translateY(-1px)}
#hc-report-btn.show{display:inline-flex}
#hc-report-btn .hc-flag{font-size:14px;line-height:1}
#hc-report-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.65);
  z-index:9100;display:none;align-items:center;justify-content:center;
  padding:1rem;
}
#hc-report-overlay.open{display:flex}
#hc-report-modal{
  background:#1a150e;color:#e8d8b8;
  border:1px solid #3a2a14;border-radius:8px;
  width:100%;max-width:460px;padding:1.25rem 1.4rem;
  font-family:'Crimson Text',Georgia,serif;
  box-shadow:0 16px 40px rgba(0,0,0,.6);
}
#hc-report-modal h3{
  font-family:'Playfair Display',Georgia,serif;
  font-style:italic;font-size:1.2rem;font-weight:400;
  color:#c49020;margin:0 0 .35rem;
}
#hc-report-modal .hc-rsub{
  font-size:12px;color:#7a6040;margin-bottom:.9rem;font-style:italic
}
#hc-report-modal .hc-rctx{
  background:#0d0a05;border:1px solid #2a2a14;border-radius:4px;
  padding:.55rem .7rem;font-size:12px;color:#a08868;
  margin-bottom:.8rem;line-height:1.45;word-break:break-word;
}
#hc-report-modal label{
  display:block;font-size:11px;color:#7a6040;text-transform:uppercase;
  letter-spacing:.1em;margin-bottom:.35rem;
}
#hc-report-modal textarea{
  width:100%;background:#0d0a05;color:#e8d8b8;
  border:1px solid #3a2a14;border-radius:4px;
  padding:.65rem .8rem;font-family:'Crimson Text',Georgia,serif;
  font-size:14px;line-height:1.5;resize:vertical;min-height:90px;
  box-sizing:border-box;
}
#hc-report-modal textarea:focus{outline:none;border-color:#c49020}
#hc-report-modal .hc-count{
  font-size:11px;color:#5a4020;text-align:right;margin-top:.25rem;
  font-family:-apple-system,sans-serif;
}
#hc-report-modal .hc-count.over{color:#cc4444}
#hc-report-modal .hc-actions{
  display:flex;justify-content:flex-end;gap:.6rem;margin-top:1rem;
}
#hc-report-modal button{
  font-family:'Playfair Display',Georgia,serif;font-style:italic;
  border-radius:3px;padding:7px 16px;cursor:pointer;font-size:13px;
}
#hc-report-modal .hc-cancel{
  background:transparent;color:#7a6040;
  border:1px solid #3a2a14;
}
#hc-report-modal .hc-cancel:hover{color:#e8d8b8;border-color:#c49020}
#hc-report-modal .hc-submit{
  background:#8a6208;color:#f5edd8;border:1px solid #c8a028;
}
#hc-report-modal .hc-submit:hover{background:#b88a18}
#hc-report-modal .hc-submit:disabled{opacity:.5;cursor:not-allowed}
#hc-report-modal .hc-status{
  font-size:12px;color:#7a6040;margin-top:.5rem;font-style:italic;min-height:18px;
}
#hc-report-modal .hc-status.err{color:#cc4444}
#hc-report-modal .hc-status.ok{color:#5acc8a}
`;

function injectStyles(){
  if (document.getElementById('hc-report-styles')) return;
  const s = document.createElement('style');
  s.id = 'hc-report-styles';
  s.textContent = css;
  document.head.appendChild(s);
}

function injectDom(){
  if (document.getElementById('hc-report-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'hc-report-btn';
  btn.title = 'Report a problem with this content';
  btn.innerHTML = `<span class="hc-flag">⚑</span><span>Report</span>`;
  btn.onclick = openModal;
  document.body.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.id = 'hc-report-overlay';
  overlay.innerHTML = `
    <div id="hc-report-modal" role="dialog" aria-modal="true">
      <h3>Report a problem</h3>
      <div class="hc-rsub">Tell us what's wrong with this content. Wrong fact, bad image, weird answer, anything.</div>
      <div class="hc-rctx" id="hc-rctx"></div>
      <label for="hc-rcomment">Your note (max ${COMMENT_LIMIT} characters)</label>
      <textarea id="hc-rcomment" maxlength="${COMMENT_LIMIT + 50}" placeholder="What's wrong?"></textarea>
      <div class="hc-count" id="hc-rcount">0 / ${COMMENT_LIMIT}</div>
      <div class="hc-status" id="hc-rstatus"></div>
      <div class="hc-actions">
        <button class="hc-cancel" id="hc-rcancel">Cancel</button>
        <button class="hc-submit" id="hc-rsubmit">Send report</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);

  document.getElementById('hc-rcomment').addEventListener('input', updateCount);
  document.getElementById('hc-rcancel').onclick = closeModal;
  document.getElementById('hc-rsubmit').onclick = submitReport;
}

function updateCount(){
  const ta = document.getElementById('hc-rcomment');
  const c  = document.getElementById('hc-rcount');
  const len = ta.value.length;
  c.textContent = `${len} / ${COMMENT_LIMIT}`;
  c.classList.toggle('over', len > COMMENT_LIMIT);
  document.getElementById('hc-rsubmit').disabled = (len === 0 || len > COMMENT_LIMIT);
}

function openModal(){
  if (!_ctx) return;
  const ctxEl = document.getElementById('hc-rctx');
  ctxEl.textContent = `${_ctx.game_type} · ${_ctx.snapshot_text || _ctx.item_id || '(no context)'}`;
  document.getElementById('hc-rcomment').value = '';
  document.getElementById('hc-rstatus').textContent = '';
  document.getElementById('hc-rstatus').className = 'hc-status';
  updateCount();
  document.getElementById('hc-report-overlay').classList.add('open');
  setTimeout(() => document.getElementById('hc-rcomment').focus(), 50);
}

function closeModal(){
  document.getElementById('hc-report-overlay').classList.remove('open');
}

async function submitReport(){
  const comment = document.getElementById('hc-rcomment').value.trim();
  if (!comment || comment.length > COMMENT_LIMIT) return;
  if (!_ctx) return;

  const btn = document.getElementById('hc-rsubmit');
  const status = document.getElementById('hc-rstatus');
  btn.disabled = true;
  status.className = 'hc-status';
  status.textContent = 'Sending...';

  try {
    const res = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit_report',
        token: localStorage.getItem('hc_token') || null,
        game_type: _ctx.game_type,
        item_type: _ctx.item_type || 'unknown',
        item_id:   _ctx.item_id || null,
        snapshot:  _ctx.snapshot || null,
        snapshot_text: _ctx.snapshot_text || null,
        comment:   comment.slice(0, COMMENT_LIMIT),
        page_url:  window.location.href,
      }),
    });
    const d = await res.json();
    if (d.error){
      status.className = 'hc-status err';
      status.textContent = d.error;
      btn.disabled = false;
      return;
    }
    status.className = 'hc-status ok';
    status.textContent = 'Thanks, your report has been sent.';
    setTimeout(closeModal, 1100);
  } catch(e) {
    status.className = 'hc-status err';
    status.textContent = 'Network error. Try again.';
    btn.disabled = false;
  }
}

function showButton(){ document.getElementById('hc-report-btn')?.classList.add('show'); }
function hideButton(){ document.getElementById('hc-report-btn')?.classList.remove('show'); }

window.hcSetReportContext = function(ctx){
  _ctx = ctx || null;
  if (_ctx && _ctx.game_type) showButton();
  else hideButton();
};
window.hcClearReportContext = function(){
  _ctx = null;
  hideButton();
};

function init(){
  injectStyles();
  injectDom();
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();
