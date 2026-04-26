#!/usr/bin/env node
// QC v2: Vision-based scan of every artwork in manifest_combined.json.
// Catches two problems the metadata regex missed:
//   1. Visible answer-revealing text in the image (engraving captions etc.)
//   2. Generic religious devotional content (Madonna, anonymous saints, etc.)
//
// For each artwork, sends the LOCAL thumbnail (paintings_data/thumbs/{id}.jpg)
// to Claude Vision once and asks both questions together. Cheap (~$5 for 593
// items) and resumable.
//
// Outputs:
//   paintings_data/qc_v2_report.json    — per-id decision + reason
//   paintings_data/qc_v2_drop.sql       — DELETE statements for D1
//   Also strips drops from manifest_clean.json / historical / wikimedia / combined
//   so re-uploads don't reinsert them.
//
// Usage:
//   $env:ANTHROPIC_API_KEY="sk-ant-..."
//   node scripts/qc_v2_vision.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'paintings_data');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');

const CONFIG = {
  anthropicBase: 'https://api.anthropic.com/v1/messages',
  anthropicModel:'claude-sonnet-4-5',
  rateMs:        1500,
  fetchTimeoutMs:45000,
  saveEvery:     20,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[34m', c:'\x1b[36m', d:'\x1b[2m', reset:'\x1b[0m' };
function log(msg, col=''){ console.log((C[col]||'') + msg + C.reset); }

let lastCall = 0;
async function rateLimit(){
  const now = Date.now();
  const wait = Math.max(0, lastCall + CONFIG.rateMs - now);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
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
      const msg = (e.name === 'AbortError') ? 'timeout' : e.message;
      if (attempt === maxRetries - 1) throw new Error(msg);
      await sleep(1500 * Math.pow(2, attempt));
    }
  }
}

async function classifyOnce(item, apiKey){
  await rateLimit();
  const thumbPath = path.join(THUMBS_DIR, `${item.id}.jpg`);
  let imgBuf;
  try { imgBuf = await fs.readFile(thumbPath); }
  catch(e) { return { decision: 'skip-no-thumb', reason: 'thumb file missing' }; }

  const imgB64 = imgBuf.toString('base64');

  const prompt = `You are reviewing an artwork that will appear in a quiz. The player will be shown the image and asked "what does this depict?" with multiple choice options.

Decide DROP=true if EITHER of these is true:

1. ANSWER LEAK: The image contains visible printed text, caption, signature line, or engraved title that names or describes the scene depicted (giving away the answer). This is common in 17th-19th century engravings and prints which often have titles printed at the bottom margin. Subtle artist signatures alone don't count, but any visible scene-naming text does.

2. RELIGIOUS DEVOTIONAL: The image is a generic religious devotional scene with no specific historical hook. Examples to DROP: Madonna and Child, anonymous saints, generic Crucifixion, generic Annunciation, generic Adoration, Holy Family scenes, cherubs, allegorical religious imagery, illuminated manuscript pages of pure scripture without a recognizable narrative event.

KEEP (drop=false) anything that is:
- Battle, siege, military combat
- Named historical figure shown DOING something (not just a portrait)
- Coronation, treaty, surrender, execution, royal court scene
- Famous biblical NARRATIVE event (Last Supper, David and Goliath, Salome with John the Baptist's head, Judith and Holofernes, Crossing of the Red Sea)
- Documented historical event with specific actors
- Ancient relief/mural depicting a real event (Egyptian pharaoh in battle, Assyrian campaign, Roman triumph)
- Mythological scene with named characters and a recognizable story (Death of Socrates, Oath of the Horatii)

Title hint (do not use this to decide; only the visible image matters): "${(item.title||'').slice(0, 200)}"
Scene hint: "${(item.scene||'').slice(0, 100)}"

Return ONLY valid JSON:
{"drop": true|false, "reason": "<short phrase if dropping, e.g. 'caption text visible at bottom' or 'generic Madonna and Child'>"}`;

  const body = {
    model: CONFIG.anthropicModel,
    max_tokens: 200,
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
  }, item.id);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error('unparseable: ' + text.slice(0, 200));
  }
  return { decision: parsed.drop ? 'drop' : 'keep', reason: parsed.reason || null };
}

async function main(){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey){ log('ANTHROPIC_API_KEY env var required', 'r'); process.exit(1); }

  const manifest = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'manifest_combined.json'), 'utf8'));
  log(`Loaded ${manifest.length} artworks from manifest_combined.json`, 'c');

  // Resume support: load existing report if present
  const reportPath = path.join(DATA_DIR, 'qc_v2_report.json');
  let report = {};
  try {
    const existing = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    for (const r of existing) report[r.id] = r;
    log(`Resuming: ${Object.keys(report).length} items already classified`, 'd');
  } catch(e) {}

  const startTime = Date.now();
  let processed = 0, dropped = 0, kept = 0, errored = 0;

  for (const item of manifest){
    if (report[item.id]){
      if (report[item.id].decision === 'drop') dropped++;
      else if (report[item.id].decision === 'keep') kept++;
      continue;
    }
    processed++;
    const short = (item.title || item.scene || item.id).slice(0, 60);
    process.stdout.write(`\r[${processed}] ${short.padEnd(60).slice(0,60)} ...classifying`);
    try {
      const result = await classifyOnce(item, apiKey);
      report[item.id] = { id: item.id, title: item.title, scene: item.scene, ...result };
      if (result.decision === 'drop'){
        dropped++;
        process.stdout.write(`  DROP: ${result.reason || ''}\n`);
      } else if (result.decision === 'skip-no-thumb'){
        process.stdout.write(`  no-thumb (skipped)\n`);
      } else {
        kept++;
        process.stdout.write(`  keep\n`);
      }
    } catch(e){
      errored++;
      report[item.id] = { id: item.id, title: item.title, scene: item.scene, decision: 'error', reason: e.message.slice(0, 200) };
      process.stdout.write(`  ERR: ${e.message.slice(0, 80)}\n`);
    }

    if (processed % CONFIG.saveEvery === 0){
      await fs.writeFile(reportPath, JSON.stringify(Object.values(report), null, 2));
      const elapsedMin = Math.round((Date.now() - startTime) / 60000);
      log(`----- saved | ${processed} processed | drop:${dropped} keep:${kept} err:${errored} | ${elapsedMin}min`, 'g');
    }
  }

  await fs.writeFile(reportPath, JSON.stringify(Object.values(report), null, 2));

  // Build SQL drop statements
  const dropIds = Object.values(report).filter(r => r.decision === 'drop').map(r => r.id);
  const sql = dropIds.length
    ? `-- QC v2 vision drops (${new Date().toISOString().slice(0,10)})\n` +
      `-- Generated by scripts/qc_v2_vision.mjs\n` +
      `-- Catches: visible answer-text in image, generic religious devotional content\n\n` +
      `DELETE FROM artworks WHERE id IN (\n  ` +
      dropIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',\n  ') +
      `\n);\n`
    : '-- No drops\n';
  await fs.writeFile(path.join(DATA_DIR, 'qc_v2_drop.sql'), sql);

  // Strip drops from local manifests
  const dropSet = new Set(dropIds);
  for (const fname of ['manifest_clean.json', 'manifest_historical.json', 'manifest_wikimedia.json', 'manifest_combined.json']){
    try {
      const m = JSON.parse(await fs.readFile(path.join(DATA_DIR, fname), 'utf8'));
      const filtered = m.filter(it => !dropSet.has(it.id));
      const removed = m.length - filtered.length;
      if (removed > 0){
        await fs.writeFile(path.join(DATA_DIR, fname), JSON.stringify(filtered, null, 2));
        log(`  ${fname}: removed ${removed}, kept ${filtered.length}`, 'd');
      }
    } catch(e) {}
  }

  log('\n════════════ QC v2 DONE ════════════', 'g');
  log(`Total in manifest:   ${manifest.length}`);
  log(`Drop (visible text or devotional): ${dropped}`, 'r');
  log(`Keep:                ${kept}`, 'g');
  log(`Errored:             ${errored}`, 'd');
  log(`\nNext: paste paintings_data/qc_v2_drop.sql into D1 console.`);

  // Show a sample of drops by reason
  const reasonCounts = {};
  for (const r of Object.values(report)){
    if (r.decision === 'drop'){
      const key = (r.reason || 'unspecified').toLowerCase().slice(0, 50);
      reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    }
  }
  log(`\nDrop reasons (top patterns):`);
  for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)){
    log(`  ${String(v).padStart(3)}  ${k}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
