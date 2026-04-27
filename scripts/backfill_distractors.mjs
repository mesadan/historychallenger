#!/usr/bin/env node
// Pre-bake plausible distractor scene strings for every artwork in The
// Curator's Eye. One Claude call per artwork generates 9 distractors,
// 3 per difficulty (easy / medium / hard). Stored in artworks.distractors_*
// columns; the worker just reads them at session start (zero LLM at game time).
//
// Generation rather than corpus-picking: the user explicitly wants no
// "horse painting + steamship distractor" mismatches. Claude crafts thematic
// alternatives that match subject + era + region per difficulty rules.
//
// USAGE:
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."        # PowerShell
//   node scripts/backfill_distractors.mjs
//
// INPUTS:
//   paintings_data/manifest_combined.json  artwork metadata (scene, era, etc.)
//   paintings_data/live_ids.json           filter to live D1 IDs only
//   paintings_data/clues_backfill.json     adds depicted_region per artwork
//
// OUTPUTS:
//   paintings_data/distractors_backfill.json   incremental cache (resume-safe)
//   scripts/distractors_update.sql             UPDATE statements for D1
//
// COST/TIME for ~1183 live artworks: ~$5-7, ~25-40 min at default rate limits.
// SAFE TO RE-RUN: skips IDs already in distractors_backfill.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR    = path.join(PROJECT_ROOT, 'paintings_data');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');
const MANIFEST    = path.join(DATA_DIR, 'manifest_combined.json');
const LIVE_IDS    = path.join(DATA_DIR, 'live_ids.json');
const CLUES_FILE  = path.join(DATA_DIR, 'clues_backfill.json');
const CACHE_FILE  = path.join(DATA_DIR, 'distractors_backfill.json');
const OUT_SQL     = path.join(SCRIPTS_DIR, 'distractors_update.sql');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL   = 'claude-sonnet-4-5';
// Conservative parallelism — 4 concurrent requests, with backoff on 429.
const PARALLEL = 4;

if (!API_KEY) {
  console.error('Set ANTHROPIC_API_KEY first.');
  process.exit(1);
}

const SYSTEM = `You are designing distractor (wrong-answer) options for a painting identification quiz called The Curator's Eye. The player sees a historical painting and four short scene descriptions; one is the real answer, three are plausible decoys you generate.

A GOOD distractor is a SHORT scene description (5-10 words) that is THEMATICALLY plausible as something the painting could depict but is wrong. It should be the same TYPE of scene (portrait, battle, religious scene, mythological scene, allegorical scene, genre scene, landscape, still life, ceremony, court scene, etc.). Use real historical names, events, or figures where they fit naturally.

A BAD distractor is anachronistic, off-genre, or too easy to dismiss. NEVER mix subject types like "equestrian portrait of a king" with "industrial steamship departing port" or "still life with fruit". The player should genuinely have to study the painting.

DIFFICULTY RULES (you produce 3 distractors per difficulty):

EASY (3 distractors): Each must depict a scene from a DIFFERENT historical era than the correct answer. Same TYPE of scene (e.g. all portraits, or all battles), but era is the discriminator. Eras to mix from: Ancient (before 500 AD), Medieval (500-1500 AD), Modern (after 1500 AD).

MEDIUM (3 distractors): EXACTLY 1 distractor must be from the SAME era as the correct answer. The other 2 from DIFFERENT eras. Same scene type. Era can no longer be used to fully eliminate options.

HARD (3 distractors): All 3 must be from the SAME era AND same broad geographic region as the correct answer. Same scene type. The player must distinguish by content alone.

OTHER RULES:
- Distractors must NOT be the correct answer, near-paraphrases of it, or contain its named subject.
- American English spelling. No em dashes — use commas.
- Each distractor: 5-10 words. No leading articles unless natural ("The Coronation of Napoleon" is fine).
- No anachronistic concepts (e.g. don't put "telegraph operator" in a medieval distractor).

Return ONLY valid JSON, no markdown:
{"easy":["...","...","..."],"medium":["...","...","..."],"hard":["...","...","..."]}`;

async function loadJsonOrEmpty(file, fallback){
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch(e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

async function loadCache(){
  const arr = await loadJsonOrEmpty(CACHE_FILE, []);
  const map = new Map();
  for (const r of arr) map.set(r.id, r);
  return map;
}

async function saveCache(map){
  await fs.writeFile(CACHE_FILE, JSON.stringify([...map.values()], null, 2));
}

async function callClaudeJson(prompt){
  const body = {
    model: MODEL,
    max_tokens: 600,
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
  if (res.status === 429 || res.status === 529) {
    const retryAfter = parseFloat(res.headers.get('retry-after') || '5');
    throw new Error(`RATE_LIMIT:${retryAfter}`);
  }
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
  return parsed;
}

function buildPrompt(art){
  const era = art.depicted_era || 'unknown';
  const region = art.depicted_region || 'unknown';
  const culture = art.culture || 'unspecified';
  return `Generate distractors for ONE artwork.

CORRECT ANSWER (do NOT use this or paraphrase it as a distractor):
  Scene: ${art.scene}
  Description: ${art.scene_long || '(none)'}

ARTWORK CONTEXT (use these to choose plausible same-era / same-region distractors per the rules):
  Era depicted: ${era}
  Region depicted: ${region}
  Culture: ${culture}
  Title (the literal painting title, may or may not match the scene): ${art.title || '(none)'}

Return ONLY JSON: {"easy":["...","...","..."],"medium":["...","...","..."],"hard":["...","...","..."]}
Reminder: easy = 3 different-era; medium = 1 same-era + 2 different-era; hard = 3 same-era + same-region. Same scene TYPE as the correct answer in all cases.`;
}

function escSql(s){
  if (s == null) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function writeUpdateSql(map){
  const header = `-- Auto-generated by scripts/backfill_distractors.mjs
-- ${map.size} UPDATE statements; each fills distractors_easy/medium/hard
-- as JSON arrays of 3 distractor scene strings.
-- Run after scripts/alter_artworks_distractors.sql.
-- Safe to re-apply (UPDATE is idempotent).

`;
  const lines = [];
  for (const r of map.values()) {
    lines.push(
      `UPDATE artworks SET ` +
      `distractors_easy=${escSql(JSON.stringify(r.easy))}, ` +
      `distractors_medium=${escSql(JSON.stringify(r.medium))}, ` +
      `distractors_hard=${escSql(JSON.stringify(r.hard))} ` +
      `WHERE id=${escSql(r.id)};`
    );
  }
  await fs.writeFile(OUT_SQL, header + lines.join('\n') + '\n');
}

function validateClaudeOutput(parsed, artScene){
  if (!parsed) return null;
  const correctKey = (artScene || '').toLowerCase().trim();
  const cleanList = (arr) => {
    if (!Array.isArray(arr)) return null;
    const out = [];
    const seen = new Set([correctKey]);
    for (const s of arr) {
      if (typeof s !== 'string') continue;
      const cleaned = s.trim().replace(/[—–]/g, ',');
      const k = cleaned.toLowerCase();
      if (!cleaned || seen.has(k)) continue;
      out.push(cleaned);
      seen.add(k);
      if (out.length >= 3) break;
    }
    return out.length === 3 ? out : null;
  };
  const easy = cleanList(parsed.easy);
  const medium = cleanList(parsed.medium);
  const hard = cleanList(parsed.hard);
  if (!easy || !medium || !hard) return null;
  return { easy, medium, hard };
}

async function processOne(art, cache){
  const prompt = buildPrompt(art);
  let attempt = 0;
  while (attempt < 4) {
    attempt++;
    try {
      const parsed = await callClaudeJson(prompt);
      const validated = validateClaudeOutput(parsed, art.scene);
      if (!validated) {
        if (attempt >= 4) return { ok: false, reason: 'malformed after 4 attempts' };
        await sleep(1000);
        continue;
      }
      cache.set(art.id, { id: art.id, ...validated });
      return { ok: true };
    } catch (e) {
      const msg = String(e.message || '');
      if (msg.startsWith('RATE_LIMIT:')) {
        const wait = parseFloat(msg.split(':')[1]) * 1000;
        await sleep(Math.max(wait, 1500));
        continue;
      }
      if (attempt >= 4) return { ok: false, reason: msg };
      await sleep(1500 * attempt);
    }
  }
  return { ok: false, reason: 'exhausted retries' };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main(){
  const manifest = await loadJsonOrEmpty(MANIFEST, []);
  const liveIdsArr = await loadJsonOrEmpty(LIVE_IDS, null);
  const cluesArr = await loadJsonOrEmpty(CLUES_FILE, []);
  const cache = await loadCache();

  if (!liveIdsArr) {
    console.error('paintings_data/live_ids.json not found. Run: SELECT json_group_array(id) FROM artworks; in D1 and save the result first.');
    process.exit(1);
  }

  const liveSet = new Set(liveIdsArr.map(String));
  const cluesById = new Map();
  for (const c of cluesArr) cluesById.set(c.id, c);

  // Build the work list from manifest, filtered to live IDs, augmented
  // with depicted_region from the prior clues backfill.
  const work = [];
  for (const m of manifest) {
    if (!liveSet.has(m.id)) continue;
    if (cache.has(m.id)) continue;
    const clues = cluesById.get(m.id) || {};
    work.push({
      id: m.id,
      title: m.title || '',
      scene: m.scene || '',
      scene_long: m.scene_long || '',
      depicted_era: m.depicted_era || '',
      depicted_region: clues.depicted_region || '',
      culture: m.culture || '',
    });
  }

  const total = liveIdsArr.length;
  console.log(`live IDs: ${total}    cached: ${cache.size}    to backfill: ${work.length}`);

  if (work.length === 0) {
    console.log('Nothing to do. Writing SQL anyway...');
    await writeUpdateSql(cache);
    console.log(`Wrote ${OUT_SQL}`);
    return;
  }

  const startTs = Date.now();
  let done = 0, errors = 0;
  let batchSinceSave = 0;

  // Process in chunks of PARALLEL with bounded concurrency
  for (let i = 0; i < work.length; i += PARALLEL) {
    const chunk = work.slice(i, i + PARALLEL);
    const results = await Promise.all(chunk.map(art => processOne(art, cache)));
    for (let j = 0; j < results.length; j++) {
      if (results[j].ok) done++;
      else { errors++; console.error(`  ERR ${chunk[j].id}: ${results[j].reason}`); }
    }
    batchSinceSave += chunk.length;
    if (batchSinceSave >= 20) {
      await saveCache(cache);
      batchSinceSave = 0;
    }
    const elapsed = ((Date.now() - startTs) / 1000).toFixed(0);
    const processed = i + chunk.length;
    const rate = (processed / Math.max(elapsed, 1)).toFixed(1);
    console.log(`[${processed}/${work.length}]  done:${done}  err:${errors}  cached:${cache.size}  ${elapsed}s  ${rate}/s`);
  }

  await saveCache(cache);
  await writeUpdateSql(cache);

  console.log(`\nDone. processed: ${done}    errors: ${errors}    final cache: ${cache.size}`);
  console.log(`Wrote ${OUT_SQL}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Apply scripts/alter_artworks_distractors.sql in D1 (ONCE — adds 3 columns)`);
  console.log(`  2. Apply scripts/distractors_update.sql in D1 (~${cache.size} UPDATE rows)`);
  console.log(`  3. Redeploy worker.js so the game reads pre-baked distractors`);
}

main().catch(e => { console.error(e); process.exit(1); });
