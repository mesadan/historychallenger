#!/usr/bin/env node
// QC pass on the existing painting library.
// Reads paintings_data/manifest.json and classifies each item by theme +
// scene-quality using metadata heuristics (free, instant). Drops items
// that are not really "scenes worth identifying" or are religious overweight.
//
// Outputs:
//   paintings_data/qc_report.json    — full per-id classification
//   paintings_data/qc_drop.sql       — DELETE statements for D1
//   paintings_data/qc_review.html    — visual review of drops vs keeps
//   paintings_data/manifest_clean.json — manifest filtered to keepers
//
// Usage:  node scripts/qc_paintings.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'paintings_data');

// ── CLASSIFIERS ──────────────────────────────────────────────────────────
// These regexes operate on the combined title + scene + scene_long text.

const T = {
  battle:   /\b(battle|siege|war|warrior|cavalry|legion|army|fleet|naval|cannon|musket|conquest|crusade|invasion|raid|combat|skirmish|sack of|fall of|defense of|defence of|charge of)\b/i,
  histEvent:/\b(coronation|treaty|signing|surrender|envoy|delegation|ambassador|throne|assembly|senate|tribune|forum|triumph|procession|funeral of|wedding of|reception|audience with|court of|reign|exile|assassinat|execution|crowning|enthron|abdicat)\b/i,
  histFig:  /\b(napoleon|caesar|alexander the great|hannibal|xerxes|cyrus|cleopatra|charlemagne|washington|lincoln|napoleon|metternich|bismarck|cromwell|elizabeth|henry viii|louis xiv|peter the great|catherine the great|akbar|kublai|genghis|saladin|attila|justinian|hadrian|nero|caligula|trajan|constantine|charlemagne|frederick|augustus|tiberius|claudius|marcus aurelius|pharaoh|sultan|caliph|tsar)\b/i,
  mythNamed:/\b(hercules|achilles|odysseus|venus|apollo|jupiter|aphrodite|zeus|narcissus|diana|mars|neptune|psyche|cupid|bacchus|dionysus|orpheus|perseus|medusa|iliad|odyssey|trojan|theseus|jason|argonaut|prometheus|atlas)\b/i,
  religiousNarrative: /\b(last supper|crucifixion|nativity|annunciation|adoration|baptism of christ|resurrection|entombment|garden of gethsemane|sermon on the mount|raising of lazarus|wedding at cana|flight into egypt|massacre of the innocents|judith and holofernes|david and goliath|samson|moses|noah|exodus|tower of babel)\b/i,
  religiousDevotional: /\b(virgin and child|madonna|saint [a-z]+|st\.? [a-z]+|holy family|pieta|magdalen|apostle|christ child|lamentation|sacred heart|pope|bishop|cardinal|monk|nun|cherub|angel|altarpiece|devotional)\b/i,
  portrait: /\b(portrait of|self-portrait|bust of|likeness of|head of [a-z]+ [a-z]+)\b/i,
  daily:    /\b(market scene|tavern|peasants? (?:dancing|feasting|working)|harvest|kitchen scene|street scene|village (?:scene|festival)|kermis|fair scene)\b/i,
  landscape:/\b(landscape|seascape|view of|panorama|sunset|sunrise|mountains?|river [a-z]+ at|coastal|garden|countryside)\b/i,
  stilllife:/\b(still life|still-life|vanitas|bouquet|fruit basket|vase of flowers)\b/i,

  // Object / artefact tells (we drop most of these)
  pureObject:/\b(fragment|sherd|shard|potsherd|funerary cone|cone of|bracelet|necklace|ring|brooch|earring|pendant|amulet|scarab|seal of|seal-impression|coin|medal|token|alabastron|alabaster (?:perfume|jar|vase|bowl)|mirror with|mirror of|cup with|cup of|bowl with|bowl of|jar with|jar of|vase with|vase of|amphora|krater|kylix|aryballos|oinochoe|lekythos|hydria|pyxis|ostracon|stamp|cameo|intaglio|inkwell|loom weight|spindle whorl|figurine|terracotta figure|statuette|clay figure|head of a clay figure|water filter|writing desk|cabinet|table|chair|tile|plaque|architectural fragment|relief fragment|pectoral|aegis|ankh|staff|scepter|sceptre|finial|pommel|hilt|capital|column|column-base|ostrakon|shabti|ushabti|funerary mask|sarcophagus fragment|stela|stele|cartouche|inscription|hieroglyph|bookplate)\b/i,

  // Damaged / partial subject indicators
  damaged: /\b(fragment of|fragmentary|partial|damaged|incomplete|unfinished sketch|study for|sketch of|preparatory|copy after)\b/i,

  // Decorative/abstract pattern indicators
  decorativeOnly: /\b(geometric pattern|floral motif|decorative band|ornamental border|ornament with|abstract pattern|filigree|inlay pattern|tile pattern)\b/i,
};

function classifyTheme(text){
  // Priority order: clearly historical/narrative beats vague matches
  if (T.battle.test(text))             return 'battle';
  if (T.histEvent.test(text))          return 'historical_event';
  if (T.histFig.test(text))            return 'historical_figure';
  if (T.religiousNarrative.test(text)) return 'religious_narrative';   // famous biblical scenes — keep
  if (T.mythNamed.test(text))          return 'mythological';          // named myth — keep
  if (T.religiousDevotional.test(text)) return 'religious_devotional'; // generic devotional — drop most
  if (T.daily.test(text))              return 'daily_life';
  if (T.portrait.test(text))           return 'portrait';
  if (T.landscape.test(text))          return 'landscape';
  if (T.stilllife.test(text))          return 'still_life';
  return 'other';
}

function classifyObjectness(text, classification){
  const c = (classification || '').toLowerCase();
  const objClassifications = /(vases?|mirrors?|jewelry|bracelets|gems|coins?|medals?|seals?|amulets?|figurines?|terracottas?|metalwork|inscription|funerary|fragments?|tiles?|textile fragment|architectural)/i;
  const isObjectClass = objClassifications.test(c);
  const isPureObjectText = T.pureObject.test(text);
  const isDamaged = T.damaged.test(text);
  const isDecorative = T.decorativeOnly.test(text);
  return { isObjectClass, isPureObjectText, isDamaged, isDecorative };
}

// ── DECISION ──────────────────────────────────────────────────────────────
function decide(item){
  const text = ((item.title||'') + ' ' + (item.scene||'') + ' ' + (item.scene_long||'')).toLowerCase();
  const theme = classifyTheme(text);
  const objectness = classifyObjectness(text, item.classification);
  const reasons = [];

  // Hard drops
  if (objectness.isPureObjectText){ reasons.push('pure object/artefact text'); }
  if (objectness.isDamaged)       { reasons.push('damaged/fragment/study'); }
  if (objectness.isDecorative)    { reasons.push('decorative pattern only'); }
  if (objectness.isObjectClass && theme === 'other') { reasons.push('object classification + no scene match'); }

  // Religious downsample: keep famous narrative scenes, drop generic devotional
  if (theme === 'religious_devotional'){
    reasons.push('religious devotional (overweight in library)');
  }

  // Anonymous portraits with low difficulty are not interesting
  if (theme === 'portrait' && item.difficulty >= 4){
    // Keep only if a recognizable historical figure was matched separately
    if (!T.histFig.test(text)) reasons.push('obscure portrait (no famous sitter)');
  }

  // Pure landscapes / still lifes are weak quiz material — drop most
  if (theme === 'landscape' && item.difficulty >= 4){
    reasons.push('generic landscape, no historical hook');
  }
  if (theme === 'still_life' && item.difficulty >= 4){
    reasons.push('still life — not a scene to identify');
  }

  // "Other" with high difficulty is usually anonymous decorative — drop
  if (theme === 'other' && item.difficulty >= 5){
    reasons.push('anonymous decorative object');
  }

  const keep = reasons.length === 0;
  return { keep, theme, reasons };
}

// ── REVIEW HTML ───────────────────────────────────────────────────────────
function reviewHtml(items, summary){
  const cards = items.map(it => {
    const cls = it._decision.keep ? 'keep' : 'drop';
    const reasons = it._decision.reasons.join(' • ') || 'kept';
    return `<div class="card ${cls}" data-keep="${it._decision.keep}" data-theme="${it._decision.theme}">
      <img src="thumbs/${it.id}.jpg" loading="lazy">
      <div class="meta">
        <div class="badges">
          <span class="badge ${cls}">${cls.toUpperCase()}</span>
          <span class="badge theme">${it._decision.theme}</span>
          <span class="badge diff">d${it.difficulty}</span>
          <span class="badge era">${it.depicted_era}</span>
        </div>
        <div class="scene">${(it.scene||'').replace(/</g,'&lt;')}</div>
        <div class="title">${(it.title||'').replace(/</g,'&lt;')}</div>
        <div class="reasons">${reasons}</div>
      </div>
    </div>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>QC Review (${items.length})</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#1a150e;color:#e8d8b8;margin:0;padding:1rem}
h1{color:#c49020;margin:0 0 .5rem}
.summary{background:#241a0e;border:1px solid #3a2a14;padding:1rem;border-radius:6px;margin-bottom:1rem;font-size:14px;line-height:1.7}
.summary strong{color:#c49020}
.filters{position:sticky;top:0;background:#1a150e;padding:.5rem 0;border-bottom:1px solid #3a2a14;margin-bottom:1rem;display:flex;gap:.4rem;flex-wrap:wrap;z-index:10}
.filters button{background:#241a0e;border:1px solid #3a2a14;color:#e8d8b8;padding:.4rem .8rem;border-radius:4px;cursor:pointer;font-size:13px}
.filters button.active{background:#c49020;color:#000;border-color:#c49020;font-weight:700}
.count{margin-left:auto;color:#7a5c30;font-size:12px;align-self:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
.card{background:#0d0a05;border:1px solid #3a2a14;border-radius:6px;overflow:hidden}
.card.drop{border-color:#5a2a14;opacity:.7}
.card.keep{border-color:#2a4a14}
.card img{width:100%;display:block;background:#000;aspect-ratio:4/3;object-fit:cover}
.meta{padding:.7rem}
.badges{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:.4rem}
.badge{font-size:10px;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.05em}
.badge.keep{background:#2a4a14;color:#a8e878}
.badge.drop{background:#5a1414;color:#ff8888}
.badge.theme{background:#241a0e;color:#c49020}
.badge.diff{background:#241a0e;color:#7a5c30}
.badge.era{background:#241a0e;color:#a08868}
.scene{font-size:14px;font-weight:700;margin-bottom:.3rem;line-height:1.3}
.title{font-size:11px;color:#7a5c30;margin-bottom:.3rem;line-height:1.4}
.reasons{font-size:11px;color:#cc6644;font-style:italic;line-height:1.4}
.card.keep .reasons{color:#7a5c30}
.card.hidden{display:none}
</style></head><body>
<h1>Painting QC Review</h1>
<div class="summary">${summary}</div>
<div class="filters">
  <button data-f="all" class="active">All</button>
  <button data-f="keep">Keepers only</button>
  <button data-f="drop">Drops only</button>
  <button data-f="theme:battle">Battle</button>
  <button data-f="theme:historical_event">Historical Event</button>
  <button data-f="theme:historical_figure">Historical Figure</button>
  <button data-f="theme:religious_devotional">Religious Devotional</button>
  <button data-f="theme:religious_narrative">Religious Narrative</button>
  <button data-f="theme:mythological">Mythological</button>
  <button data-f="theme:portrait">Portrait</button>
  <button data-f="theme:other">Other</button>
  <span class="count" id="count">${items.length} shown</span>
</div>
<div class="grid">${cards}</div>
<script>
document.querySelectorAll('.filters button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b === btn));
    const f = btn.dataset.f;
    let shown = 0;
    document.querySelectorAll('.card').forEach(c => {
      let match = false;
      if (f === 'all') match = true;
      else if (f === 'keep') match = c.dataset.keep === 'true';
      else if (f === 'drop') match = c.dataset.keep === 'false';
      else if (f.startsWith('theme:')) match = c.dataset.theme === f.slice(6);
      c.classList.toggle('hidden', !match);
      if (match) shown++;
    });
    document.getElementById('count').textContent = shown + ' shown';
  };
});
</script>
</body></html>`;
}

// ── MAIN ─────────────────────────────────────────────────────────────────
async function main(){
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  console.log(`Loaded ${manifest.length} artworks from manifest`);

  const themeCounts = {};
  const dropReasonCounts = {};
  let kept = 0, dropped = 0;

  for (const item of manifest){
    const decision = decide(item);
    item._decision = decision;
    themeCounts[decision.theme] = (themeCounts[decision.theme]||0) + 1;
    if (decision.keep) kept++;
    else {
      dropped++;
      for (const r of decision.reasons){
        dropReasonCounts[r] = (dropReasonCounts[r]||0) + 1;
      }
    }
  }

  // Build summary
  const themeLines = Object.entries(themeCounts).sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `<strong>${k}</strong>: ${v}`).join(' &middot; ');
  const reasonLines = Object.entries(dropReasonCounts).sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `${v} &times; ${k}`).join('<br>');

  const summary = `
<strong>Total:</strong> ${manifest.length} &middot; <strong>Keep:</strong> ${kept} (${Math.round(kept*100/manifest.length)}%) &middot; <strong>Drop:</strong> ${dropped} (${Math.round(dropped*100/manifest.length)}%)<br><br>
<strong>By theme:</strong> ${themeLines}<br><br>
<strong>Drop reasons:</strong><br>${reasonLines}
`;

  // Write outputs
  const report = manifest.map(it => ({
    id: it.id,
    title: it.title,
    scene: it.scene,
    theme: it._decision.theme,
    keep: it._decision.keep,
    reasons: it._decision.reasons,
    difficulty: it.difficulty,
  }));
  await fs.writeFile(path.join(DATA_DIR, 'qc_report.json'), JSON.stringify(report, null, 2));

  const dropIds = manifest.filter(it => !it._decision.keep).map(it => it.id);
  const dropSql = dropIds.length
    ? `-- QC pass on ${new Date().toISOString().slice(0,10)} dropped ${dropIds.length} of ${manifest.length} artworks\n` +
      `DELETE FROM artworks WHERE id IN (\n  ${dropIds.map(id => `'${id.replace(/'/g,"''")}'`).join(',\n  ')}\n);\n`
    : '-- No drops\n';
  await fs.writeFile(path.join(DATA_DIR, 'qc_drop.sql'), dropSql);

  // Manifest filtered to keepers, with theme tag added
  const cleanManifest = manifest
    .filter(it => it._decision.keep)
    .map(it => {
      const { _decision, ...rest } = it;
      return { ...rest, theme: _decision.theme };
    });
  await fs.writeFile(path.join(DATA_DIR, 'manifest_clean.json'), JSON.stringify(cleanManifest, null, 2));

  // Review HTML
  await fs.writeFile(path.join(DATA_DIR, 'qc_review.html'), reviewHtml(manifest, summary));

  console.log('\n════════════ QC DONE ════════════');
  console.log(`  Total:   ${manifest.length}`);
  console.log(`  Keep:    ${kept}`);
  console.log(`  Drop:    ${dropped}`);
  console.log('\nBy theme:');
  for (const [k,v] of Object.entries(themeCounts).sort((a,b)=>b[1]-a[1])){
    console.log('  ' + k.padEnd(24) + v);
  }
  console.log('\nDrop reasons:');
  for (const [k,v] of Object.entries(dropReasonCounts).sort((a,b)=>b[1]-a[1])){
    console.log('  ' + String(v).padStart(4) + '  ' + k);
  }
  console.log(`\nOutputs:`);
  console.log(`  paintings_data/qc_report.json    (per-id classification)`);
  console.log(`  paintings_data/qc_drop.sql       (paste into D1 to delete drops)`);
  console.log(`  paintings_data/manifest_clean.json (manifest filtered to keepers)`);
  console.log(`  paintings_data/qc_review.html    (open in browser to spot-check)`);
}

main().catch(e => { console.error(e); process.exit(1); });
