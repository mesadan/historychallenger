#!/usr/bin/env node
// Generates paintings_data/review_manual.html — a self-contained static
// review tool. Open it in a browser, click any painting card to toggle a
// "drop" flag (persists in localStorage), then click "Copy DELETE SQL"
// to grab the SQL for D1.
//
// Usage:  node scripts/build_review_tool.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'paintings_data');

function esc(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function main(){
  const manifest = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'manifest_combined.json'), 'utf8'));
  console.log(`Building review tool for ${manifest.length} artworks...`);

  // Sort by source then by scene for easy scanning
  manifest.sort((a, b) => {
    if (a.source !== b.source) return (a.source||'').localeCompare(b.source||'');
    return (a.scene||'').localeCompare(b.scene||'');
  });

  const cards = manifest.map(it => {
    const scene = esc(it.scene || '');
    const title = esc((it.title || '').slice(0, 100));
    const id = esc(it.id);
    const source = esc(it.source || 'unknown');
    const era = esc(it.depicted_era || '');
    const diff = esc(String(it.difficulty || ''));
    const yr = it.creation_year != null ? (it.creation_year < 0 ? Math.abs(it.creation_year) + ' BC' : it.creation_year + '') : '';
    return `<div class="card" data-id="${id}" data-source="${source}" data-era="${era}" data-diff="${diff}">
      <img src="thumbs/${id}.jpg" loading="lazy" onerror="this.style.background='#400';this.alt='no thumb'">
      <div class="meta">
        <div class="badges">
          <span class="badge src-${source}">${source}</span>
          <span class="badge">${era}</span>
          <span class="badge">d${diff}</span>
          ${yr ? `<span class="badge">${esc(yr)}</span>` : ''}
        </div>
        <div class="scene">${scene}</div>
        <div class="title">${title}</div>
        <div class="id">${id}</div>
      </div>
      <button class="drop-btn">Mark for drop</button>
    </div>`;
  }).join('');

  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Manual painting review (${manifest.length})</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a150e;color:#e8d8b8;margin:0;padding:0}
header{position:sticky;top:0;background:#0d0a05;border-bottom:1px solid #3a2a14;padding:12px 20px;z-index:100;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:16px;color:#c49020;margin:0;flex:0 0 auto}
.spacer{flex:1}
.stats{font-size:13px;color:#aaa}
.stats strong{color:#c49020}
.controls{display:flex;gap:6px;flex-wrap:wrap}
.controls button,.controls select,.controls input{background:#241a0e;border:1px solid #3a2a14;color:#e8d8b8;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;font-family:inherit}
.controls button:hover{background:#3a2a14;border-color:#c49020}
.controls button.primary{background:#c49020;color:#000;font-weight:700;border-color:#c49020}
.controls button.primary:hover{background:#e0a84a}
.controls .danger{background:#5a1414;border-color:#5a1414;color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;padding:1rem}
.card{background:#0d0a05;border:1px solid #3a2a14;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;transition:opacity .12s,border-color .12s}
.card.dropped{opacity:.45;border-color:#5a1414}
.card.dropped::after{content:'DROPPED';position:absolute}
.card{position:relative}
.card img{width:100%;display:block;background:#000;aspect-ratio:4/3;object-fit:cover}
.meta{padding:.7rem;flex:1}
.badges{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:.4rem}
.badge{font-size:10px;padding:2px 6px;border-radius:3px;background:#241a0e;color:#a08868;text-transform:lowercase;letter-spacing:.04em}
.badge.src-met{color:#5a8acc}
.badge.src-wikimedia{color:#5acc8a}
.scene{font-size:14px;font-weight:700;color:#fff;margin-bottom:.3rem;line-height:1.3}
.title{font-size:11px;color:#7a5c30;margin-bottom:.3rem;line-height:1.4}
.id{font-size:10px;color:#5a4020;font-family:monospace}
.drop-btn{margin:0 .7rem .7rem;padding:6px;background:#1a0a0a;border:1px solid #5a2a2a;color:#cc6644;border-radius:3px;cursor:pointer;font-size:12px;font-family:inherit}
.drop-btn:hover{background:#2a0d0d;border-color:#cc4444}
.card.dropped .drop-btn{background:#cc4444;color:#fff;border-color:#cc4444}
.card.dropped .drop-btn::after{content:' (click to undo)';opacity:.7}
.card.hidden{display:none}
.card img.lightbox{cursor:zoom-in}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.95);display:none;align-items:center;justify-content:center;z-index:200;cursor:zoom-out;padding:20px}
#lb.open{display:flex}
#lb img{max-width:100%;max-height:100%;object-fit:contain}
.copy-status{font-size:12px;color:#5acc8a;display:none}
.copy-status.show{display:inline}
</style>
</head>
<body>
<header>
  <h1>Manual painting review</h1>
  <div class="stats"><strong id="count-total">${manifest.length}</strong> total · <strong id="count-shown" style="color:#aaa">${manifest.length}</strong> shown · <strong id="count-dropped" style="color:#cc6644">0</strong> marked for drop</div>
  <div class="spacer"></div>
  <div class="controls">
    <select id="filter-source">
      <option value="">all sources</option>
      <option value="met">Met only</option>
      <option value="wikimedia">Wikimedia only</option>
    </select>
    <select id="filter-era">
      <option value="">all eras</option>
      <option value="ancient">ancient</option>
      <option value="medieval">medieval</option>
      <option value="modern">modern</option>
    </select>
    <select id="filter-marked">
      <option value="">all items</option>
      <option value="dropped">marked only</option>
      <option value="kept">unmarked only</option>
    </select>
    <input type="search" id="filter-text" placeholder="search scene/title/id" style="min-width:180px">
    <button id="btn-clear" class="danger">Clear all marks</button>
    <button id="btn-copy" class="primary">Copy DELETE SQL <span class="copy-status" id="copy-status">copied!</span></button>
    <button id="btn-download">Download SQL file</button>
  </div>
</header>
<div class="grid" id="grid">${cards}</div>
<div id="lb"><img id="lb-img" alt=""></div>
<script>
const STORAGE_KEY = 'hc-paintings-drop-list';
const dropped = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));

function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify([...dropped])); updateCounts(); }
function updateCounts(){
  document.getElementById('count-dropped').textContent = dropped.size;
  let shown = 0;
  document.querySelectorAll('.card').forEach(c => { if (!c.classList.contains('hidden')) shown++; });
  document.getElementById('count-shown').textContent = shown;
}

// Apply persisted state
document.querySelectorAll('.card').forEach(card => {
  if (dropped.has(card.dataset.id)) card.classList.add('dropped');
});

// Card click toggles drop
document.querySelectorAll('.card').forEach(card => {
  const id = card.dataset.id;
  const dropBtn = card.querySelector('.drop-btn');
  const img = card.querySelector('img');
  function toggle(){
    if (dropped.has(id)) { dropped.delete(id); card.classList.remove('dropped'); }
    else { dropped.add(id); card.classList.add('dropped'); }
    save();
  }
  dropBtn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  img.addEventListener('click', e => {
    document.getElementById('lb-img').src = img.src;
    document.getElementById('lb').classList.add('open');
  });
});

document.getElementById('lb').addEventListener('click', () => {
  document.getElementById('lb').classList.remove('open');
});

// Filters
function applyFilters(){
  const src = document.getElementById('filter-source').value;
  const era = document.getElementById('filter-era').value;
  const marked = document.getElementById('filter-marked').value;
  const text = document.getElementById('filter-text').value.toLowerCase().trim();
  document.querySelectorAll('.card').forEach(card => {
    let show = true;
    if (src && card.dataset.source !== src) show = false;
    if (era && card.dataset.era !== era) show = false;
    if (marked === 'dropped' && !dropped.has(card.dataset.id)) show = false;
    if (marked === 'kept' && dropped.has(card.dataset.id)) show = false;
    if (text){
      const haystack = (card.querySelector('.scene').textContent + ' ' + card.querySelector('.title').textContent + ' ' + card.dataset.id).toLowerCase();
      if (!haystack.includes(text)) show = false;
    }
    card.classList.toggle('hidden', !show);
  });
  updateCounts();
}
['filter-source','filter-era','filter-marked','filter-text'].forEach(id => {
  document.getElementById(id).addEventListener('input', applyFilters);
});

// Clear marks
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!dropped.size) return;
  if (!confirm(\`Clear all \${dropped.size} marks?\`)) return;
  dropped.clear();
  document.querySelectorAll('.card.dropped').forEach(c => c.classList.remove('dropped'));
  save();
});

function buildSql(){
  if (!dropped.size) return '-- No items marked for drop\\n';
  const ids = [...dropped];
  return \`-- Manual review drops (\${new Date().toISOString().slice(0,10)})\\n\` +
         \`-- \${ids.length} items marked from review_manual.html\\n\\n\` +
         'DELETE FROM artworks WHERE id IN (\\n  ' +
         ids.map(id => "'" + id.replace(/'/g, "''") + "'").join(',\\n  ') +
         '\\n);\\n';
}

document.getElementById('btn-copy').addEventListener('click', async () => {
  const sql = buildSql();
  await navigator.clipboard.writeText(sql);
  const s = document.getElementById('copy-status');
  s.classList.add('show');
  setTimeout(() => s.classList.remove('show'), 1800);
});

document.getElementById('btn-download').addEventListener('click', () => {
  const sql = buildSql();
  const blob = new Blob([sql], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'qc_manual_drop.sql';
  a.click();
});

updateCounts();
</script>
</body></html>`;

  await fs.writeFile(path.join(DATA_DIR, 'review_manual.html'), html);
  console.log(`\nWrote paintings_data/review_manual.html`);
  console.log(`Open it in your browser to review.`);
}

main().catch(e => { console.error(e); process.exit(1); });
