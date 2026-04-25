#!/usr/bin/env node
// Merge manifest_clean.json (post-QC keepers) + manifest_historical.json
// (newly curated historical pieces) into manifest_combined.json.
//
// De-dupes by `id`. Preserves theme tag if present.
// Usage: node scripts/combine_manifests.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'paintings_data');

async function readJsonOrEmpty(file){
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8')); }
  catch(e) { console.log(`(skipped: ${file} not found)`); return []; }
}

async function main(){
  const clean = await readJsonOrEmpty('manifest_clean.json');
  const hist  = await readJsonOrEmpty('manifest_historical.json');
  console.log(`manifest_clean.json:      ${clean.length}`);
  console.log(`manifest_historical.json: ${hist.length}`);

  const seen = new Map();
  for (const it of clean) seen.set(it.id, it);
  for (const it of hist){
    if (!seen.has(it.id)) seen.set(it.id, it);   // historical wins on collision
  }
  const combined = [...seen.values()];
  console.log(`combined (deduped): ${combined.length}`);

  await fs.writeFile(path.join(DATA_DIR, 'manifest_combined.json'), JSON.stringify(combined, null, 2));
  console.log(`\nWrote paintings_data/manifest_combined.json`);
  console.log(`\nNext steps:`);
  console.log(`  1. Upload images + generate seed SQL:`);
  console.log(`       MANIFEST_FILE=manifest_combined.json node scripts/upload_paintings.mjs`);
  console.log(`  2. Apply qc_drop.sql in D1 console (deletes the 387 bad items)`);
  console.log(`  3. Apply scripts/artworks_seed.sql in D1 console (INSERT OR REPLACE all combined items)`);
}

main().catch(e => { console.error(e); process.exit(1); });
