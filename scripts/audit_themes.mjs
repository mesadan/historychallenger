import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('paintings_data/manifest.json', 'utf8'));
console.log('Total:', m.length);

const rel  = /\b(christ|jesus|virgin|madonna|saint|st\.|crucifix|annunc|nativity|holy family|pieta|magdalen|apostle|gospel|baptism|resurrec|adoration|magi|trinity|cherub|martyrdom|disciple|prophet|biblical|bible|altarpiece|devotional|sacred|saviour|savior|psalm|monk|nun|priest|bishop|cardinal|pope|pilgrim)\b/i;
const myth = /\b(venus|apollo|jupiter|hercules|achilles|odysseus|zeus|aphrodite|narcissus|diana|mars|neptune|psyche|cupid|nymph|satyr|bacchus|dionysus|orpheus|perseus|medusa|titan|muse|mythology|mythological|allegor)\b/i;
const battle = /\b(battle|siege|war|warrior|soldier|cavalry|legion|army|sword|spear|shield|fortress|sack|conquest|crusade|defeat|victory|invasion|raid|combat|skirmish|cannon|musket|fleet|naval)\b/i;
const histfig = /\b(napoleon|caesar|alexander|hannibal|xerxes|cleopatra|charlemagne|washington|lincoln|king|queen|emperor|empress|sultan|pharaoh|tsar|caliph|coronation|throne|assassinat|execution|treaty|signing|surrender|envoy|delegation)\b/i;
const dailylife = /\b(market|tavern|peasant|farm|harvest|kitchen|family|child|merchant|fisherman|hunter|musician|dance|festival|workshop|street|garden|courtyard)\b/i;
const portrait = /\b(portrait|bust|self-portrait|likeness)\b/i;
const landscape = /\b(landscape|seascape|mountains|river|view of|panorama|sunrise|sunset)\b/i;
const stilllife = /\b(still life|still-life|flowers|fruit|vase|bouquet|pomegranates|tulips)\b/i;

const counts = { religious:0, mythological:0, battle:0, historical_figure:0, portrait:0, daily_life:0, landscape:0, still_life:0, other:0 };
const samples = {};
for (const k of Object.keys(counts)) samples[k] = [];

for (const a of m){
  const t = ((a.title||'')+' '+(a.scene||'')+' '+(a.scene_long||'')).toLowerCase();
  let b;
  if (battle.test(t))           b = 'battle';
  else if (histfig.test(t))     b = 'historical_figure';
  else if (myth.test(t))        b = 'mythological';
  else if (rel.test(t))         b = 'religious';
  else if (portrait.test(t))    b = 'portrait';
  else if (landscape.test(t))   b = 'landscape';
  else if (stilllife.test(t))   b = 'still_life';
  else if (dailylife.test(t))   b = 'daily_life';
  else                          b = 'other';
  counts[b]++;
  if (samples[b].length < 6) samples[b].push(`[d${a.difficulty} ${a.depicted_era}] ${a.scene} | ${a.title?.slice(0,80)||''}`);
}

console.log('\nBy theme:');
const total = m.length;
for (const [k,v] of Object.entries(counts).sort((a,b)=>b[1]-a[1])){
  console.log('  ' + k.padEnd(20) + String(v).padStart(4) + '  (' + Math.round(v*100/total) + '%)');
}

console.log('\nSamples per bucket:');
for (const [k, list] of Object.entries(samples)){
  console.log('\n' + k.toUpperCase() + ':');
  list.forEach(s => console.log('  ' + s));
}

console.log('\nBy difficulty:');
const dc = {};
for (const a of m) dc[a.difficulty] = (dc[a.difficulty]||0)+1;
for (const [k,v] of Object.entries(dc).sort()) console.log('  diff ' + k + ':', v);

console.log('\nBy era:');
const ec = {};
for (const a of m) ec[a.depicted_era] = (ec[a.depicted_era]||0)+1;
for (const [k,v] of Object.entries(ec)) console.log('  ' + k + ':', v);

// Cross-tab: religious by era
console.log('\nReligious by era:');
const relByEra = {};
for (const a of m){
  const t = ((a.title||'')+' '+(a.scene||'')+' '+(a.scene_long||'')).toLowerCase();
  if (rel.test(t) && !battle.test(t) && !histfig.test(t)){
    relByEra[a.depicted_era] = (relByEra[a.depicted_era]||0)+1;
  }
}
for (const [k,v] of Object.entries(relByEra)) console.log('  ' + k + ':', v);
