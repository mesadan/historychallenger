#!/usr/bin/env node
// Drop generic scenes that lack a specific named person, place, event, or year.
//
// Logic: a scene is SPECIFIC if it contains at least one of:
//   - a non-generic capitalized word (proper noun: place, person, named event)
//   - a year (3-4 digit number, possibly with BC/AD)
//   - a specific event pattern like "Battle of X", "Death of Y" with a real name
//
// A scene is GENERIC if it has NONE of those. Examples to drop:
//   "Cavalry charge in combat"
//   "Two pigeons perched together"
//   "Knights jousting at tournament"
//   "Greek hoplite warrior"
//   "Standing Buddha figure"
//
// Examples to keep (specific):
//   "Battle of Cannae"          (Cannae = proper noun)
//   "Coronation of Napoleon"    (Napoleon = proper noun)
//   "Battle of Champigny 1870"  (Champigny + year)
//   "Death of Socrates"         (Socrates)
//
// Outputs:
//   paintings_data/qc_generic_report.json  — per-id classification
//   paintings_data/qc_generic_drop.sql     — DELETE statements for D1
//   Strips drops from local manifests too
//
// Usage:  node scripts/qc_drop_generic.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'paintings_data');

// Capitalized words that are NOT specific — adjectives, generic categories,
// cultures, eras, common titles, common nouns. These capitalized words alone
// don't qualify a scene as "specific".
const GENERIC_CAPS = new Set([
  // Cultures and peoples
  'Greek', 'Roman', 'Egyptian', 'Persian', 'Byzantine', 'Ottoman', 'Mughal', 'Mongol',
  'Frankish', 'Norman', 'Viking', 'Spartan', 'Phoenician', 'Etruscan', 'Carolingian',
  'Chinese', 'Japanese', 'Indian', 'Korean', 'Arab', 'Arabic', 'Bedouin', 'Tatar', 'Cossack',
  'Hindu', 'Christian', 'Muslim', 'Buddhist', 'Catholic', 'Jewish', 'Protestant',
  'Hellenistic', 'Mesopotamian', 'Sumerian', 'Babylonian', 'Assyrian', 'Hittite', 'Achaemenid',
  'Sassanian', 'Mayan', 'Aztec', 'Inca', 'Olmec', 'Toltec',
  'European', 'African', 'American', 'Asian', 'Western', 'Eastern',
  'British', 'French', 'German', 'Spanish', 'Italian', 'Dutch', 'Russian', 'Swedish',
  'Polish', 'Austrian', 'Prussian', 'Bavarian', 'Hungarian', 'Croatian', 'Serbian',
  'Confederate', 'Union', 'Allied', 'Axis',
  // Generic titles + roles
  'King', 'Queen', 'Emperor', 'Empress', 'Sultan', 'Pharaoh', 'Tsar', 'Caliph', 'Khan',
  'Prince', 'Princess', 'Duke', 'Duchess', 'Lord', 'Lady', 'Saint', 'Pope', 'Bishop',
  'Knight', 'Knights', 'Soldier', 'Soldiers', 'Warrior', 'Warriors', 'General', 'Colonel',
  'Captain', 'Officer', 'Officers', 'Cavalry', 'Infantry', 'Artillery', 'Hussar', 'Hussars',
  'Lancer', 'Lancers', 'Cuirassier', 'Cuirassiers', 'Grenadier', 'Grenadiers', 'Zouave',
  'Zouaves', 'Samurai', 'Crusader', 'Crusaders',
  // Periods and eras
  'Ancient', 'Medieval', 'Modern', 'Renaissance', 'Baroque', 'Classical', 'Early',
  'Late', 'Old', 'New', 'High', 'Low', 'Middle',
  // Directional / generic descriptors
  'East', 'West', 'North', 'South', 'Northern', 'Southern', 'Eastern', 'Western',
  'Holy', 'Sacred', 'Royal', 'Imperial', 'Court', 'Courtly',
  // Common scene-type words that get capitalized as first word
  'The', 'A', 'An',
  // Months (when years/dates appear, the year carries the specificity)
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]);

// "Battle of X" / "Death of Y" / etc. with a NON-generic name following
const SPECIFIC_EVENT_PATTERN = /\b(Battle|Siege|Fall|Sack|Defense|Defence|Death|Murder|Assassination|Coronation|Triumph|Surrender|Treaty|Oath|Crossing|Death|Funeral|Marriage|Capture|Execution|Conquest|Investiture) of (?:the )?([A-Z][a-zA-Z]+)/;

function isGenericCap(word){
  return GENERIC_CAPS.has(word);
}

function specificityScore(scene){
  if (!scene) return 0;
  let score = 0;
  const words = scene.split(/\s+/).map(w => w.replace(/[.,;:!?\(\)\[\]"']/g, ''));

  // Non-generic capitalized words after the first (proper nouns)
  let properNounCount = 0;
  for (let i = 0; i < words.length; i++){
    const w = words[i];
    if (!w) continue;
    // Capitalized + has lowercase (not all-caps acronyms)
    if (/^[A-Z][a-z]+/.test(w) && !isGenericCap(w)){
      // Skip the very first word ONLY if it's a sentence-starting common verb
      // (heuristic: most short generic openers like "Standing", "Mounted",
      // "Seated" are 6-9 letters and end in -ed/-ing). Real proper nouns
      // (Napoleon, Hastings) survive the filter.
      if (i === 0 && /(?:ed|ing)$/i.test(w)) continue;
      properNounCount++;
    }
  }
  if (properNounCount >= 1) score += 2;
  if (properNounCount >= 2) score += 1;

  // Year (3-4 digit number)
  if (/\b\d{3,4}\b/.test(scene)) score += 2;
  // BC / AD / BCE / CE marker
  if (/\b(?:BC|BCE|AD|CE)\b/.test(scene)) score += 1;

  // Specific named event ("Battle of Hastings" but not "Battle scene")
  if (SPECIFIC_EVENT_PATTERN.test(scene)){
    const m = scene.match(SPECIFIC_EVENT_PATTERN);
    if (m && !isGenericCap(m[2])) score += 3;
  }

  return score;
}

function decide(item){
  const score = specificityScore(item.scene || '');
  return { score, generic: score < 2 };
}

async function readJsonOrEmpty(file){
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8')); }
  catch(e) { return []; }
}

async function main(){
  const manifest = await readJsonOrEmpty('manifest_combined.json');
  if (!manifest.length){
    console.error('manifest_combined.json not found or empty');
    process.exit(1);
  }
  console.log(`Scanning ${manifest.length} artworks for generic scenes...`);

  const generic = [];
  const specific = [];
  for (const item of manifest){
    const d = decide(item);
    if (d.generic) generic.push({ ...item, _score: d.score });
    else specific.push(item);
  }

  console.log(`\nGeneric (score < 2): ${generic.length}`);
  console.log(`Specific (kept):     ${specific.length}\n`);
  console.log('Sample of generic items being dropped:');
  for (const g of generic.slice(0, 30)){
    console.log(`  [score ${g._score}] ${g.id}: ${g.scene}`);
  }
  if (generic.length > 30) console.log(`  ... and ${generic.length - 30} more`);

  // Write report
  const report = manifest.map(it => ({
    id: it.id, scene: it.scene, score: specificityScore(it.scene || ''), generic: specificityScore(it.scene || '') < 2,
  }));
  await fs.writeFile(path.join(DATA_DIR, 'qc_generic_report.json'), JSON.stringify(report, null, 2));

  // Write SQL
  const dropIds = generic.map(g => g.id);
  const sql = dropIds.length
    ? `-- Drop generic-scene items (${new Date().toISOString().slice(0,10)})\n` +
      `-- Generated by scripts/qc_drop_generic.mjs\n` +
      `-- Items whose scene field has no proper noun, no year, and no named event.\n` +
      `-- These are essentially unguessable in a quiz format.\n\n` +
      `DELETE FROM artworks WHERE id IN (\n  ` +
      dropIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',\n  ') +
      `\n);\n`
    : '-- No drops\n';
  await fs.writeFile(path.join(DATA_DIR, 'qc_generic_drop.sql'), sql);

  // Strip from local manifests so re-uploads don't reinsert
  const dropSet = new Set(dropIds);
  for (const fname of ['manifest_clean.json', 'manifest_historical.json', 'manifest_wikimedia.json', 'manifest_combined.json']){
    try {
      const m = JSON.parse(await fs.readFile(path.join(DATA_DIR, fname), 'utf8'));
      const filtered = m.filter(it => !dropSet.has(it.id));
      const removed = m.length - filtered.length;
      if (removed > 0){
        await fs.writeFile(path.join(DATA_DIR, fname), JSON.stringify(filtered, null, 2));
        console.log(`  ${fname}: removed ${removed}, kept ${filtered.length}`);
      }
    } catch(e) {}
  }

  console.log(`\nNext: paste paintings_data/qc_generic_drop.sql into the D1 console.`);
}

main().catch(e => { console.error(e); process.exit(1); });
