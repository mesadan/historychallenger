#!/usr/bin/env node
// Painting curation pipeline for History Challenger
// Pulls artworks from Met Museum Open Access, downloads + resizes images,
// classifies each with Claude Vision (depicted era, scene, distractors),
// writes manifest.json + review.html for spot-checking.
//
// Usage:
//   npm install            (first time)
//   ANTHROPIC_API_KEY=xxx node curate_paintings.mjs
//
// Requires Node 18+ (native fetch).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  quotas:        { ancient: 200, medieval: 120, modern: 180 },
  outputDir:     path.join(PROJECT_ROOT, 'paintings_data'),
  metBase:       'https://collectionapi.metmuseum.org/public/collection/v1',
  anthropicBase: 'https://api.anthropic.com/v1/messages',
  anthropicModel:'claude-sonnet-4-5',

  // Met department IDs to sweep
  departments: [
    { id: 10, name: 'Egyptian Art' },
    { id: 13, name: 'Greek and Roman Art' },
    { id: 17, name: 'Medieval Art' },
    { id: 14, name: 'Islamic Art' },
    { id:  6, name: 'Asian Art' },
    { id: 11, name: 'European Paintings' },
    { id: 21, name: 'Modern and Contemporary Art' },
    { id:  9, name: 'Drawings and Prints' },
  ],
  candidatesPerDept: 350,      // randomly sample this many IDs per dept

  // Rate limits (polite)
  metRateMs:     220,          // ~4.5 req/s
  claudeRateMs:  1500,         // ~0.7 req/s
  imageMaxWidth: 1200,
  thumbMaxWidth: 400,
  imageQuality:  82,
  thumbQuality:  75,

  progressEvery: 1,           // log every item for now so we can see hangs
  saveEvery:     25,
  fetchTimeoutMs: 30000,      // 30s timeout per HTTP call
};

// ── UTILITIES ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[34m', c:'\x1b[36m', d:'\x1b[2m', reset:'\x1b[0m' };
function log(msg, col=''){ console.log((C[col]||'') + msg + C.reset); }

async function ensureDir(p){ await fs.mkdir(p, { recursive: true }); }

const lastCall = {};
async function rateLimit(key, minMs){
  const now = Date.now();
  const wait = Math.max(0, (lastCall[key]||0) + minMs - now);
  if (wait > 0) await sleep(wait);
  lastCall[key] = Date.now();
}

async function fetchRetry(url, opts={}, label='', maxRetries=3){
  for (let attempt = 0; attempt < maxRetries; attempt++){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
      return res;
    } catch(e) {
      clearTimeout(timer);
      const msg = (e.name === 'AbortError') ? `timeout after ${CONFIG.fetchTimeoutMs}ms` : e.message;
      if (attempt === maxRetries - 1) throw new Error(msg);
      const backoff = 1200 * Math.pow(2, attempt);
      log(`  [${label}] retry ${attempt+1} after ${backoff}ms: ${msg.slice(0,120)}`, 'y');
      await sleep(backoff);
    }
  }
}

function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── MET API ───────────────────────────────────────────────────────────────
async function metDepartmentIds(deptId){
  await rateLimit('met', CONFIG.metRateMs);
  const res = await fetchRetry(`${CONFIG.metBase}/objects?departmentIds=${deptId}`, {}, `dept ${deptId}`);
  const data = await res.json();
  return data.objectIDs || [];
}

async function metObject(id){
  await rateLimit('met', CONFIG.metRateMs);
  const res = await fetchRetry(`${CONFIG.metBase}/objects/${id}`, {}, `obj ${id}`);
  return await res.json();
}

function metPassesFilter(obj){
  if (!obj) return false;
  if (!obj.isPublicDomain) return false;
  if (!obj.primaryImage) return false;
  const title = (obj.title || '').trim();
  if (title.length < 4) return false;
  if (/^(object|fragment|sherd|ostracon|seal|amulet|scarab|coin|beads?)$/i.test(title)) return false;
  if (obj.objectBeginDate == null) return false;
  // skip obvious non-quizzable types
  if (obj.classification){
    if (/coin|medal|fragment|textile fragment|sherd|mount|bead|amulet|scarab|inscription/i.test(obj.classification)) return false;
  }
  return true;
}

// ── IMAGE DOWNLOAD + RESIZE ───────────────────────────────────────────────
async function downloadAndResize(imageUrl, baseName, outDir){
  await rateLimit('metimg', 120);                  // lighter rate limit for CDN
  const res = await fetchRetry(imageUrl, {}, `img ${baseName}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // sanity check: must be at least 600px on the long edge
  const meta = await sharp(buf).metadata();
  if ((meta.width || 0) < 600 && (meta.height || 0) < 600){
    throw new Error(`too small: ${meta.width}x${meta.height}`);
  }

  const imagePath = path.join(outDir, 'images', `${baseName}.jpg`);
  const thumbPath = path.join(outDir, 'thumbs', `${baseName}.jpg`);
  await sharp(buf)
    .resize(CONFIG.imageMaxWidth, CONFIG.imageMaxWidth, { fit:'inside', withoutEnlargement:true })
    .jpeg({ quality: CONFIG.imageQuality, progressive: true })
    .toFile(imagePath);
  await sharp(buf)
    .resize(CONFIG.thumbMaxWidth, CONFIG.thumbMaxWidth, { fit:'inside', withoutEnlargement:true })
    .jpeg({ quality: CONFIG.thumbQuality, progressive: true })
    .toFile(thumbPath);

  return { imagePath, thumbPath };
}

async function cleanImageFiles(baseName, outDir){
  await fs.unlink(path.join(outDir, 'images', `${baseName}.jpg`)).catch(()=>{});
  await fs.unlink(path.join(outDir, 'thumbs', `${baseName}.jpg`)).catch(()=>{});
}

// ── CLAUDE VISION CLASSIFICATION ──────────────────────────────────────────
async function classifyWithClaude(imagePath, obj, apiKey){
  await rateLimit('anthropic', CONFIG.claudeRateMs);
  const imgB64 = (await fs.readFile(imagePath)).toString('base64');

  const prompt = `You are classifying an artwork for a history quiz. Determine what the artwork DEPICTS (the scene shown in it), not when the object was made.

A 19th-century oil painting of the Crucifixion depicts an ANCIENT scene.
A Roman bust of a senator depicts an ANCIENT scene.
A Mughal miniature showing a court audience under Akbar depicts a MODERN scene (post 1500).

Rules:
- usable=false for: decorative objects with no clear subject, damaged or unclear images, abstract pieces, blank backgrounds, fragments, nudes without narrative context, anything not quizzable.
- depicted_era: ancient = before 500 AD. medieval = 500 to 1500. modern = after 1500.
- For artefacts without a narrative (vases, busts, sarcophagi), use the era of the culture that produced them.
- scene: specific and quizzable, 2 to 8 words. Not "a battle" but "Battle of Issus" or "Mongol cavalry charge". Not "a king" but "Coronation of Napoleon".
- distractors: 3 plausible WRONG scene labels a knowledgeable player might confuse this with. Same subject category (battle, religious, portrait, etc). Mix eras freely. Each 2 to 8 words.
- difficulty: 1 = universally famous (Crucifixion, Mona Lisa, Napoleon's coronation). 3 = well-known. 5 = specialist-level.
- STYLE: American English. No em dashes.

METADATA:
Title: ${obj.title || '(none)'}
Artist: ${obj.artistDisplayName || 'Unknown'}
Culture: ${obj.culture || obj.period || obj.dynasty || 'N/A'}
Classification: ${obj.classification || 'N/A'}
Object date: ${obj.objectDate || 'N/A'}

Return ONLY valid JSON:
{"usable":true,"depicted_era":"ancient|medieval|modern","scene":"...","scene_long":"one sentence","distractors":["...","...","..."],"difficulty":1}`;

  const body = {
    model: CONFIG.anthropicModel,
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB64 } },
        { type: 'text', text: prompt },
      ],
    }],
  };

  const res = await fetchRetry(CONFIG.anthropicBase, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key':    apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  }, 'claude');
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Claude output unparseable: ' + text.slice(0, 200));
  }
}

// ── REVIEW HTML ───────────────────────────────────────────────────────────
function reviewHtml(manifest){
  const cards = manifest.map(m => `
  <div class="card" data-era="${m.depicted_era}" data-diff="${m.difficulty}">
    <img src="thumbs/${m.id}.jpg" loading="lazy">
    <div class="meta">
      <div class="tag">${m.depicted_era} &middot; diff ${m.difficulty}</div>
      <div class="scene">${(m.scene||'').replace(/</g,'&lt;')}</div>
      <div class="long">${(m.scene_long||'').replace(/</g,'&lt;')}</div>
      <div class="distractors">${(m.distractors||[]).map(d=>d.replace(/</g,'&lt;')).join(' &middot; ')}</div>
      <div class="src">${(m.title||'').replace(/</g,'&lt;')} &middot; ${(m.artist||'Unknown').replace(/</g,'&lt;')}</div>
      <div class="src">${m.culture||''} &middot; ${m.creation_year||'?'} &middot; ${m.id}</div>
    </div>
  </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Painting Manifest Review (${manifest.length})</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a150e;color:#e8d8b8;margin:0;padding:1rem}
h1{color:#c49020;margin:0 0 .75rem;font-size:1.25rem}
.filters{position:sticky;top:0;background:#1a150e;padding:.5rem 0 .75rem;border-bottom:1px solid #3a2a14;margin-bottom:1rem;display:flex;gap:.5rem;flex-wrap:wrap;z-index:10}
.filters button{background:#241a0e;border:1px solid #3a2a14;color:#e8d8b8;padding:.4rem .9rem;border-radius:4px;cursor:pointer;font-family:inherit;font-size:13px}
.filters button.active{background:#c49020;color:#000;border-color:#c49020;font-weight:700}
.count{margin-left:auto;color:#7a5c30;font-size:12px;align-self:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem}
.card{background:#0d0a05;border:1px solid #3a2a14;border-radius:6px;overflow:hidden}
.card img{width:100%;display:block;background:#000;aspect-ratio:4/3;object-fit:cover}
.meta{padding:.75rem}
.tag{font-size:11px;color:#c49020;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.3rem}
.scene{font-size:15px;font-weight:700;margin-bottom:.3rem;line-height:1.3}
.long{font-size:12px;color:#a08868;margin-bottom:.5rem;line-height:1.45}
.distractors{font-size:11px;color:#7a5c30;font-style:italic;margin-bottom:.4rem;line-height:1.4}
.src{font-size:11px;color:#5a4020;line-height:1.5}
.card.hidden{display:none}
</style></head><body>
<h1>Painting Manifest Review</h1>
<div class="filters">
  <button data-f="all" class="active">All</button>
  <button data-f="ancient">Ancient</button>
  <button data-f="medieval">Medieval</button>
  <button data-f="modern">Modern</button>
  <span class="count" id="count">${manifest.length} shown</span>
</div>
<div class="grid">${cards}</div>
<script>
const total = ${manifest.length};
document.querySelectorAll('.filters button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b === btn));
    const f = btn.dataset.f;
    let shown = 0;
    document.querySelectorAll('.card').forEach(c => {
      const match = f === 'all' || c.dataset.era === f;
      c.classList.toggle('hidden', !match);
      if (match) shown++;
    });
    document.getElementById('count').textContent = shown + ' shown';
  };
});
</script>
</body></html>`;
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main(){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey){
    log('ANTHROPIC_API_KEY env var required', 'r');
    process.exit(1);
  }

  const outDir = CONFIG.outputDir;
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, 'images'));
  await ensureDir(path.join(outDir, 'thumbs'));

  // Gather candidate IDs
  log('\nGathering candidate IDs from Met departments...', 'c');
  const candidateIds = new Set();
  for (const dept of CONFIG.departments){
    try {
      const ids = await metDepartmentIds(dept.id);
      const sampled = shuffle(ids).slice(0, CONFIG.candidatesPerDept);
      sampled.forEach(id => candidateIds.add(id));
      log(`  ${dept.name}: ${ids.length} total, sampled ${sampled.length}`, 'b');
    } catch(e){
      log(`  ${dept.name}: FAILED ${e.message.slice(0,120)}`, 'r');
    }
  }
  const candidates = shuffle(Array.from(candidateIds));
  log(`Total unique candidates: ${candidates.length}`, 'c');

  const manifest = [];
  const counters = { ancient: 0, medieval: 0, modern: 0 };
  let processed = 0, rejectedMet = 0, rejectedClaude = 0, rejectedBucket = 0, errored = 0;

  for (const id of candidates){
    // Stop if all quotas met
    if (counters.ancient  >= CONFIG.quotas.ancient  &&
        counters.medieval >= CONFIG.quotas.medieval &&
        counters.modern   >= CONFIG.quotas.modern){
      log('\nAll quotas met. Stopping early.', 'g');
      break;
    }

    processed++;
    const baseName = `met-${id}`;
    process.stdout.write(`\r[${processed}] ${baseName} ...fetching`);
    try {
      const obj = await metObject(id);
      if (!metPassesFilter(obj)){ rejectedMet++; process.stdout.write(` metRej\n`); continue; }

      process.stdout.write(`\r[${processed}] ${baseName} ...downloading image`);
      await downloadAndResize(obj.primaryImage, baseName, outDir);

      process.stdout.write(`\r[${processed}] ${baseName} ...classifying`);
      const cls = await classifyWithClaude(path.join(outDir, 'images', `${baseName}.jpg`), obj, apiKey);

      if (!cls.usable){
        rejectedClaude++;
        await cleanImageFiles(baseName, outDir);
        process.stdout.write(` claudeRej\n`);
        continue;
      }

      const era = cls.depicted_era;
      if (!counters.hasOwnProperty(era)){
        errored++;
        await cleanImageFiles(baseName, outDir);
        log(`  bad era from claude on ${id}: ${era}`, 'r');
        continue;
      }

      if (counters[era] >= CONFIG.quotas[era]){
        rejectedBucket++;
        await cleanImageFiles(baseName, outDir);
        process.stdout.write(` bucketFull\n`);
        continue;
      }

      counters[era]++;
      process.stdout.write(`\r[${processed}] ${baseName} ${era} diff${cls.difficulty}: ${(cls.scene||'').slice(0,60)}\n`);
      manifest.push({
        id:            baseName,
        source:        'met',
        source_id:     id,
        image_key:     `paintings/images/${baseName}.jpg`,
        thumb_key:     `paintings/thumbs/${baseName}.jpg`,
        title:         obj.title || '',
        artist:        obj.artistDisplayName || null,
        creation_year: (obj.objectBeginDate != null) ? obj.objectBeginDate : null,
        depicted_era:  cls.depicted_era,
        scene:         cls.scene,
        scene_long:    cls.scene_long,
        distractors:   Array.isArray(cls.distractors) ? cls.distractors.slice(0,3) : [],
        medium:        obj.medium || null,
        museum:        'The Metropolitan Museum of Art',
        culture:       obj.culture || obj.period || obj.dynasty || null,
        classification:obj.classification || null,
        difficulty:    Number(cls.difficulty) || 3,
        source_url:    obj.objectURL || null,
      });

      if (processed % 20 === 0){
        log(`----- totals: A:${counters.ancient}/${CONFIG.quotas.ancient}  M:${counters.medieval}/${CONFIG.quotas.medieval}  Mo:${counters.modern}/${CONFIG.quotas.modern}  | metRej:${rejectedMet} claudeRej:${rejectedClaude} bucketRej:${rejectedBucket} err:${errored}`, 'g');
      }

      if (manifest.length % CONFIG.saveEvery === 0){
        await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
    } catch(e){
      errored++;
      await cleanImageFiles(baseName, outDir);
      process.stdout.write(` ERR: ${e.message.slice(0, 100)}\n`);
    }
  }

  // Final save
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(outDir, 'review.html'), reviewHtml(manifest));

  log('\n════════════ DONE ════════════', 'g');
  log(`Accepted: ${manifest.length}`, 'c');
  log(`  Ancient:  ${counters.ancient} / ${CONFIG.quotas.ancient}`, 'c');
  log(`  Medieval: ${counters.medieval} / ${CONFIG.quotas.medieval}`, 'c');
  log(`  Modern:   ${counters.modern} / ${CONFIG.quotas.modern}`, 'c');
  log(`Rejected by Met filter:    ${rejectedMet}`, 'd');
  log(`Rejected by Claude:         ${rejectedClaude}`, 'd');
  log(`Rejected (bucket full):     ${rejectedBucket}`, 'd');
  log(`Errored:                    ${errored}`, 'd');
  log(`\nOutput: ${outDir}`, 'c');
  log(`Open ${path.join(outDir, 'review.html')} in a browser to spot-check.`, 'c');
}

main().catch(e => { console.error(e); process.exit(1); });
