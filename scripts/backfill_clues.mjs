#!/usr/bin/env node
// Backfill the 3 new clue fields (time_clue / culture_clue / depicted_region)
// for every artwork in paintings_data/manifest_combined.json by asking
// Claude (text-only) to read the existing title/scene/scene_long/culture/
// creation_year and produce vague-but-useful hints that don't give away
// the correct answer.
//
// USAGE:
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."         # PowerShell
//   node scripts/backfill_clues.mjs
//
// OPTIONAL — restrict to IDs currently in your D1 (skip rows you've
// manually deleted from the live DB):
//   1. In the D1 console run:
//        SELECT json_group_array(id) FROM artworks;
//   2. Copy the resulting JSON array (a single string like ["id1","id2",...])
//      into paintings_data/live_ids.json
//   3. Re-run this script. It will filter the manifest down to live IDs only.
//
// OUTPUT:
//   paintings_data/clues_backfill.json   incremental cache (resume-friendly)
//   scripts/clues_update.sql             UPDATE statements for D1
//
// COST/TIME estimate for ~1900 artworks at batchSize 50: ~$1, ~5-10 min.
//
// SAFE TO RE-RUN: it skips IDs already in clues_backfill.json. Delete that
// file to force a fresh pass.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR    = path.join(PROJECT_ROOT, 'paintings_data');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');
const MANIFEST    = path.join(DATA_DIR, 'manifest_combined.json');
const LIVE_IDS    = path.join(DATA_DIR, 'live_ids.json');
const CACHE_FILE  = path.join(DATA_DIR, 'clues_backfill.json');
const OUT_SQL     = path.join(SCRIPTS_DIR, 'clues_update.sql');

const API_KEY    = process.env.ANTHROPIC_API_KEY;
const MODEL      = 'claude-sonnet-4-5';
const BATCH_SIZE = 50;

if (!API_KEY) {
  console.error('Set ANTHROPIC_API_KEY first.');
  process.exit(1);
}

const SYSTEM = `You are a museum curator writing CLUE CARDS for a "guess the scene" painting game. For each artwork the player must guess the correct scene from 4 multiple-choice options. You provide three OPTIONAL hint cards the player can buy at a cost. The cards must HELP without GIVING THE ANSWER AWAY.

For each artwork, return three short strings:

1. time_clue — the time period the depicted scene is set in. Pick the smartest framing per painting:
   - tight century or range when the scene is dateable: "5th century BC", "1340 to 1380 AD", "Late Bronze Age (1500 to 1200 BC)"
   - broader bucket when the scene is timeless / mythological / religious: "Classical antiquity", "Late medieval", "Early modern Europe"
   - use BC for negative-era, AD optional for positive
   NEVER name the specific event, war, ruler, or person depicted. "5th century BC" is fine; "during the Persian Wars" is too narrow.

2. culture_clue — vague cultural pointer. May list several cultures or use a broad descriptor:
   - "Mediterranean classical world (Greek and Roman)"
   - "Western European, 14th to 17th century"
   - "Islamic world, medieval"
   - "Han or post-Han Chinese tradition"
   - "Northern European Protestant tradition"
   NEVER name the specific dynasty, kingdom, or city tied to the answer. "Italian Renaissance" gives away the Sistine Chapel; "Western European, 15th-16th century" is fine.

3. depicted_region — broad geographic region the scene takes place in. Pick ONE from:
   - "Mediterranean"
   - "Western Europe"
   - "Northern Europe"
   - "Eastern Europe"
   - "Middle East"
   - "North Africa"
   - "Sub-Saharan Africa"
   - "South Asia"
   - "East Asia"
   - "Southeast Asia"
   - "Central Asia"
   - "Americas"
   - "Oceania"
   - "Mythological / unspecified" (use ONLY for purely allegorical scenes with no real-world setting)

GENERAL RULES:
- Never include a proper noun (place, person, ruler, war, event) that appears in the scene answer or distractors. The cards must remain vague.
- Use American English spelling (color, organize, center, defense). Do NOT use em dashes, use commas or periods.
- Each clue is one short string, no extra punctuation, no markdown.

OUTPUT FORMAT (STRICT, JSON ONLY, NO MARKDOWN):
{"clues":[{"id":"<artwork id>","time_clue":"...","culture_clue":"...","depicted_region":"..."}]}`;

async function loadCache(){
  try {
    const buf = await fs.readFile(CACHE_FILE, 'utf8');
    const arr = JSON.parse(buf);
    const map = new Map();
    for (const r of arr) map.set(r.id, r);
    return map;
  } catch(e) {
    return new Map();
  }
}

async function saveCache(map){
  const arr = [...map.values()];
  await fs.writeFile(CACHE_FILE, JSON.stringify(arr, null, 2));
}

async function callClaudeJson(prompt){
  const body = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error || !data.content) {
    throw new Error('Anthropic[' + res.status + ']: ' + (data.error?.message || JSON.stringify(data).slice(0, 300)));
  }
  const raw = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in response: ' + raw.slice(0, 300));
    parsed = JSON.parse(m[0]);
  }
  if (!Array.isArray(parsed.clues)) throw new Error('No clues array in response');
  return parsed.clues;
}

function compactItem(it){
  return {
    id: it.id,
    title: (it.title || '').slice(0, 120),
    scene: (it.scene || '').slice(0, 120),
    scene_long: (it.scene_long || '').slice(0, 220),
    culture: it.culture || null,
    creation_year: it.creation_year ?? null,
    depicted_era: it.depicted_era || null,
  };
}

function escSql(s){
  if (s == null) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function writeUpdateSql(map){
  const header = `-- Auto-generated by scripts/backfill_clues.mjs
-- ${map.size} UPDATE statements; each updates time_clue / culture_clue / depicted_region
-- for one artwork. Run after scripts/alter_artworks_clues.sql.
-- Safe to re-apply (UPDATE is idempotent).

`;
  const lines = [];
  for (const r of map.values()) {
    lines.push(
      `UPDATE artworks SET time_clue=${escSql(r.time_clue)}, ` +
      `culture_clue=${escSql(r.culture_clue)}, ` +
      `depicted_region=${escSql(r.depicted_region)} WHERE id=${escSql(r.id)};`
    );
  }
  await fs.writeFile(OUT_SQL, header + lines.join('\n') + '\n');
}

async function loadLiveIds(){
  try {
    const raw = await fs.readFile(LIVE_IDS, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('live_ids.json must be a JSON array of id strings');
    return new Set(arr.map(String));
  } catch(e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function main(){
  const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  const liveIds = await loadLiveIds();
  const cache = await loadCache();
  const total = manifest.length;

  let pool = manifest;
  if (liveIds) {
    pool = manifest.filter(it => liveIds.has(it.id));
    console.log(`live_ids.json present: filtering ${total} → ${pool.length} live IDs`);
  } else {
    console.log(`(no paintings_data/live_ids.json — backfilling all manifest rows; UPDATEs will no-op for IDs not in D1)`);
  }

  const todo = pool.filter(it => !cache.has(it.id));
  console.log(`Pool: ${pool.length}    cached: ${cache.size}    to backfill: ${todo.length}`);

  if (todo.length === 0) {
    console.log('Nothing to do. Writing SQL anyway...');
    await writeUpdateSql(cache);
    console.log(`Wrote ${OUT_SQL}`);
    return;
  }

  let processed = 0;
  let errors = 0;
  const startTs = Date.now();

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE).map(compactItem);
    const prompt = `Generate clue cards for these ${batch.length} artworks. Use the id verbatim. Return JSON only.\n\n${JSON.stringify(batch, null, 2)}`;

    try {
      const clues = await callClaudeJson(prompt);
      let added = 0;
      for (const c of clues) {
        if (!c?.id || !c?.time_clue || !c?.culture_clue || !c?.depicted_region) continue;
        cache.set(c.id, {
          id: c.id,
          time_clue: String(c.time_clue).slice(0, 200),
          culture_clue: String(c.culture_clue).slice(0, 200),
          depicted_region: String(c.depicted_region).slice(0, 80),
        });
        added++;
      }
      processed += added;
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(0);
      console.log(`[${i + batch.length}/${todo.length}] +${added}  total cached: ${cache.size}  errors: ${errors}  elapsed: ${elapsed}s`);
      await saveCache(cache);
    } catch(e) {
      errors++;
      console.error(`[batch ${i}] FAILED: ${e.message}`);
      // Brief backoff on errors before continuing
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\nDone. Processed: ${processed}    errors: ${errors}    final cache: ${cache.size}`);
  await writeUpdateSql(cache);
  console.log(`Wrote ${OUT_SQL}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Apply scripts/alter_artworks_clues.sql in D1 (ONCE — adds the 3 columns)`);
  console.log(`  2. Apply scripts/clues_update.sql in D1 (~${cache.size} UPDATE rows)`);
  console.log(`  3. Redeploy worker.js (handler will be updated to read the new fields)`);
}

main().catch(e => { console.error(e); process.exit(1); });
