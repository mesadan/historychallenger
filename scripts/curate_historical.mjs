#!/usr/bin/env node
// Focused curation pass: pulls historical scenes from Met using targeted
// keyword searches (battles, treaties, named figures) instead of department
// dumps. Stricter Claude prompt rejects objects + generic devotional.
//
// Usage:
//   ANTHROPIC_API_KEY=xxx node scripts/curate_historical.mjs
//
// Output: paintings_data/manifest_historical.json (merged with existing
// manifest_clean.json into manifest_combined.json at the end).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  outputDir:     path.join(PROJECT_ROOT, 'paintings_data'),
  metBase:       'https://collectionapi.metmuseum.org/public/collection/v1',
  anthropicBase: 'https://api.anthropic.com/v1/messages',
  anthropicModel:'claude-sonnet-4-5',

  // Targeted historical search queries (Met search API)
  // Each query is run with hasImages=true and isPublicDomain filtered after.
  queries: [
    // Battles + military
    'battle of', 'siege of', 'fall of', 'sack of', 'defense of',
    'cavalry charge', 'naval battle', 'crusade', 'conquest',

    // Famous figures by name
    'Napoleon', 'Caesar', 'Alexander the Great', 'Hannibal', 'Cleopatra',
    'Charlemagne', 'Washington', 'Hercules', 'Augustus', 'Constantine',
    'Hadrian', 'Trajan', 'Justinian', 'Saladin', 'Genghis Khan',
    'Akbar', 'Suleiman', 'Cyrus', 'Xerxes', 'Darius',

    // Historical events
    'coronation', 'triumph of', 'death of', 'oath of', 'crossing of',
    'signing of treaty', 'surrender of', 'execution of', 'assassination of',
    'meeting of', 'congress of',

    // Civilization-specific scenes
    'Roman senate', 'Roman triumph', 'Greek hero', 'Egyptian pharaoh court',
    'Persian king', 'Mughal court', 'Ottoman sultan', 'Byzantine emperor',
    'Gallic warrior', 'Viking', 'samurai battle', 'Aztec',

    // Famous events / classical narrative scenes
    'Trojan war', 'Odysseus', 'Achilles', 'Trojan horse',
    'fall of Rome', 'fall of Constantinople', 'rape of Sabines',
    'oath of Horatii', 'crossing the Delaware', 'death of Socrates',
  ],
  resultsPerQuery: 60,
  totalTarget: 300,

  metRateMs:     220,
  claudeRateMs:  1500,
  imageMaxWidth: 1200,
  thumbMaxWidth: 400,
  imageQuality:  82,
  thumbQuality:  75,
  fetchTimeoutMs:30000,
  saveEvery:     20,
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
      const msg = (e.name === 'AbortError') ? `timeout` : e.message;
      if (attempt === maxRetries - 1) throw new Error(msg);
      await sleep(1200 * Math.pow(2, attempt));
    }
  }
}

// ── MET API ───────────────────────────────────────────────────────────────
async function metSearch(query){
  await rateLimit('met', CONFIG.metRateMs);
  const url = `${CONFIG.metBase}/search?q=${encodeURIComponent(query)}&hasImages=true&isPublicDomain=true`;
  const res = await fetchRetry(url, {}, `search "${query}"`);
  const data = await res.json();
  return data.objectIDs || [];
}

async function metObject(id){
  await rateLimit('met', CONFIG.metRateMs);
  const res = await fetchRetry(`${CONFIG.metBase}/objects/${id}`, {}, `obj ${id}`);
  return await res.json();
}

function metPassesFilter(obj){
  if (!obj || !obj.isPublicDomain || !obj.primaryImage) return false;
  const title = (obj.title || '').trim();
  if (title.length < 4) return false;
  // bias against pure objects in this pass
  if (obj.classification){
    if (/coin|medal|fragment|sherd|amulet|scarab|seal|bracelet|brooch|earring|pendant|cone|tile|inscription|textile fragment|architectural|mount|figurine/i.test(obj.classification)) return false;
  }
  if (/\bfragment\b|\bsherd\b|funerary cone|alabastron|loom weight|spindle whorl/i.test(title)) return false;
  return true;
}

// ── IMAGE ─────────────────────────────────────────────────────────────────
async function downloadAndResize(imageUrl, baseName, outDir){
  await rateLimit('metimg', 120);
  const res = await fetchRetry(imageUrl, {}, `img ${baseName}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if ((meta.width || 0) < 600 && (meta.height || 0) < 600){
    throw new Error(`too small: ${meta.width}x${meta.height}`);
  }
  const imagePath = path.join(outDir, 'images', `${baseName}.jpg`);
  const thumbPath = path.join(outDir, 'thumbs', `${baseName}.jpg`);
  await sharp(buf).resize(CONFIG.imageMaxWidth, CONFIG.imageMaxWidth, { fit:'inside', withoutEnlargement:true })
    .jpeg({ quality: CONFIG.imageQuality, progressive: true }).toFile(imagePath);
  await sharp(buf).resize(CONFIG.thumbMaxWidth, CONFIG.thumbMaxWidth, { fit:'inside', withoutEnlargement:true })
    .jpeg({ quality: CONFIG.thumbQuality, progressive: true }).toFile(thumbPath);
  return { imagePath, thumbPath };
}

async function cleanImageFiles(baseName, outDir){
  await fs.unlink(path.join(outDir, 'images', `${baseName}.jpg`)).catch(()=>{});
  await fs.unlink(path.join(outDir, 'thumbs', `${baseName}.jpg`)).catch(()=>{});
}

// ── CLAUDE VISION (stricter) ─────────────────────────────────────────────
async function classifyWithClaude(imagePath, obj, apiKey){
  await rateLimit('anthropic', CONFIG.claudeRateMs);
  const imgB64 = (await fs.readFile(imagePath)).toString('base64');

  const prompt = `You are classifying an artwork for a HISTORY quiz. The player will be shown the image and asked "what does this depict?" with 4 options. We want SCENES of historical events, battles, named figures in action — NOT decorative objects, NOT generic devotional images, NOT obscure portraits.

REJECT (set usable=false) if any of these apply:
- Decorative object with no scene (vase, bracelet, mirror, coin, fragment, mask, statuette, pottery)
- Generic religious devotional with no specific narrative event (random Madonna and Child, anonymous saint, generic crucifixion without distinguishing detail)
- Anonymous portrait (someone you can't name from the image alone)
- Pure landscape, still life, or decorative pattern with no historical hook
- Unclear, damaged, abstract, or illegible image
- Architectural detail or fragment

KEEP (set usable=true) if:
- Battle, siege, military scene with identifiable subject
- Named historical figure shown in identifiable context (Caesar crossing the Rubicon, not just a bust)
- Coronation, treaty, surrender, execution, royal court scene
- Famous biblical narrative scene (Last Supper, David and Goliath — recognizable plot)
- Named mythological scene (Judgment of Paris, Death of Socrates — story-based)
- Historical event with named participants

Then provide:
- depicted_era: ancient (before 500 AD), medieval (500-1500), or modern (after 1500). Use the era of what is depicted, not when the artwork was made.
- scene: 2 to 8 words, specific. "Battle of Issus" not "a battle". "Coronation of Napoleon" not "a king".
- scene_long: one sentence describing what is happening.
- distractors: 3 plausible WRONG scene labels in the same category. Each 2 to 8 words.
- difficulty: 1 = universally famous (Crucifixion, Coronation of Napoleon). 2 = well-known historical event. 3 = recognized by history fans. 4 = specialist. 5 = very obscure.
- theme: one of [battle, historical_event, historical_figure, religious_narrative, mythological, other]
- STYLE: American English. No em dashes.

METADATA:
Title: ${obj.title || '(none)'}
Artist: ${obj.artistDisplayName || 'Unknown'}
Culture: ${obj.culture || obj.period || obj.dynasty || 'N/A'}
Classification: ${obj.classification || 'N/A'}
Object date: ${obj.objectDate || 'N/A'}

Return ONLY valid JSON:
{"usable":true|false,"depicted_era":"...","scene":"...","scene_long":"...","distractors":["...","...","..."],"difficulty":1,"theme":"..."}`;

  const body = {
    model: CONFIG.anthropicModel,
    max_tokens: 800,
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

// ── MAIN ─────────────────────────────────────────────────────────────────
async function main(){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey){ log('ANTHROPIC_API_KEY env var required', 'r'); process.exit(1); }

  const outDir = CONFIG.outputDir;
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, 'images'));
  await ensureDir(path.join(outDir, 'thumbs'));

  // Resume support
  const manifestPath = path.join(outDir, 'manifest_historical.json');
  let resumed = [];
  try {
    const existing = await fs.readFile(manifestPath, 'utf8');
    resumed = JSON.parse(existing);
    if (Array.isArray(resumed) && resumed.length > 0){
      log(`\nResuming: ${resumed.length} historical items already saved`, 'c');
    }
  } catch(e) { /* fresh start */ }

  // Also exclude IDs that are already in the existing manifest.json (avoid duplicates)
  let existingIds = new Set();
  try {
    const ex = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
    for (const it of ex) existingIds.add(it.source_id);
  } catch(e) {}
  for (const it of resumed) existingIds.add(it.source_id);
  log(`Will skip ${existingIds.size} IDs already in manifests`, 'd');

  // Gather candidates from queries
  log('\nGathering candidate IDs from Met search queries...', 'c');
  const candidateIds = new Set();
  for (const q of CONFIG.queries){
    try {
      const ids = await metSearch(q);
      const sliced = (ids || []).slice(0, CONFIG.resultsPerQuery);
      sliced.forEach(id => { if (!existingIds.has(id)) candidateIds.add(id); });
      log(`  "${q}": ${ids?.length||0} hits, ${sliced.length} sampled`, 'b');
    } catch(e){
      log(`  "${q}": FAILED ${e.message.slice(0,100)}`, 'r');
    }
  }
  const candidates = Array.from(candidateIds);
  // Shuffle so we don't bias toward early queries
  for (let i = candidates.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i+1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  log(`Total unique new candidates: ${candidates.length}`, 'c');

  const manifest = resumed.slice();
  let processed = 0, rejectedMet = 0, rejectedClaude = 0, errored = 0;

  for (const id of candidates){
    if (manifest.length >= CONFIG.totalTarget + resumed.length){
      log(`\nTarget ${CONFIG.totalTarget} reached. Stopping.`, 'g');
      break;
    }
    processed++;
    const baseName = `met-${id}`;
    process.stdout.write(`\r[${processed}] ${baseName} ...fetching`);
    try {
      const obj = await metObject(id);
      if (!metPassesFilter(obj)){ rejectedMet++; process.stdout.write(` metRej\n`); continue; }

      process.stdout.write(`\r[${processed}] ${baseName} ...downloading`);
      await downloadAndResize(obj.primaryImage, baseName, outDir);

      process.stdout.write(`\r[${processed}] ${baseName} ...classifying`);
      const cls = await classifyWithClaude(path.join(outDir, 'images', `${baseName}.jpg`), obj, apiKey);

      if (!cls.usable){
        rejectedClaude++;
        await cleanImageFiles(baseName, outDir);
        process.stdout.write(` claudeRej\n`);
        continue;
      }
      if (!['ancient','medieval','modern'].includes(cls.depicted_era)){
        errored++;
        await cleanImageFiles(baseName, outDir);
        log(`  bad era from claude on ${id}: ${cls.depicted_era}`, 'r');
        continue;
      }

      process.stdout.write(`\r[${processed}] ${baseName} ${cls.theme} ${cls.depicted_era} d${cls.difficulty}: ${(cls.scene||'').slice(0,60)}\n`);
      manifest.push({
        id:            baseName,
        source:        'met',
        source_id:     id,
        image_key:     `images/${baseName}.jpg`,
        thumb_key:     `thumbs/${baseName}.jpg`,
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
        theme:         cls.theme || 'other',
        source_url:    obj.objectURL || null,
      });

      if (manifest.length % CONFIG.saveEvery === 0){
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        log(`----- saved ${manifest.length} historical pieces  | metRej:${rejectedMet} claudeRej:${rejectedClaude} err:${errored}`, 'g');
      }
    } catch(e){
      errored++;
      await cleanImageFiles(baseName, outDir);
      process.stdout.write(` ERR: ${e.message.slice(0, 100)}\n`);
    }
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  log('\n════════════ DONE ════════════', 'g');
  log(`Historical pieces accepted: ${manifest.length}`, 'c');
  log(`Rejected by Met filter:    ${rejectedMet}`, 'd');
  log(`Rejected by Claude:         ${rejectedClaude}`, 'd');
  log(`Errored:                    ${errored}`, 'd');
  log(`\nOutput: ${manifestPath}`, 'c');
}

main().catch(e => { console.error(e); process.exit(1); });
