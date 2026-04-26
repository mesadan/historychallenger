#!/usr/bin/env node
// Wikimedia v2 — focused gap-fill for areas the v1 run missed:
//   - Punic Wars (Hannibal, Cannae, Zama, Scipio)
//   - Assyria, Babylon, ancient Near Eastern reliefs
//   - Famous classical battles (Marathon, Thermopylae, Gaugamela, Issus)
//   - History painters who weren't covered (Tiepolo, Poussin, Le Brun)
//   - Specific named historical figures missing from v1
//
// Reads ALL existing manifests (manifest.json, manifest_clean.json,
// manifest_historical.json, manifest_wikimedia.json, manifest_combined.json)
// and the in-progress manifest_wikimedia_v2.json so it never duplicates an
// item already in your library.
//
// Same architecture as curate_wikimedia.mjs: PD-only license filter, small
// image first for classification, strict reject prompt for caption-leak +
// religious devotional + generic scenes.
//
// Usage:
//   $env:ANTHROPIC_API_KEY="sk-ant-..."
//   node scripts/curate_wikimedia_v2.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  outputDir:     path.join(PROJECT_ROOT, 'paintings_data'),
  manifestFile:  'manifest_wikimedia_v2.json',
  commonsApi:    'https://commons.wikimedia.org/w/api.php',
  anthropicBase: 'https://api.anthropic.com/v1/messages',
  anthropicModel:'claude-sonnet-4-5',

  // Focused categories agreed with user 2026-04-26: ancient world heavy
  // (Carthage, Assyria, Hittites, Greece, Persia), 5 western buckets,
  // 5 pre-Columbian civilisations, 5 Asian buckets.
  categories: [
    // ═════════ CARTHAGE / PUNIC WARS ═════════
    'Category:Hannibal crossing the Alps',
    'Category:Battle of Cannae',
    'Category:Battle of Zama',
    'Category:Battle of the Trebia',
    'Category:Battle of Lake Trasimene',
    'Category:Battle of Cape Ecnomus',
    'Category:Battle of Drepana',
    'Category:Battle of the Aegates',
    'Category:Battle of the Metaurus',
    'Category:Battle of Ilipa',
    'Category:Siege of Saguntum',
    'Category:Siege of Carthage (Third Punic War)',
    'Category:Hannibal Barca',
    'Category:Hamilcar Barca',
    'Category:Hasdrubal Barca',
    'Category:Scipio Africanus',
    'Category:Continence of Scipio',
    'Category:Death of Hannibal',
    'Category:Carthage in art',
    'Category:Hanno the Navigator',

    // ═════════ ASSYRIA ═════════
    'Category:Lion Hunt of Ashurbanipal',
    'Category:Reliefs from Nineveh',
    'Category:Reliefs from Nimrud',
    'Category:Reliefs from Khorsabad',
    'Category:Sennacherib',
    'Category:Ashurbanipal',
    'Category:Ashurnasirpal II',
    'Category:Tiglath-Pileser III',
    'Category:Sargon II',
    'Category:Esarhaddon',
    'Category:Siege of Lachish',
    'Category:Sack of Babylon',
    'Category:Battle of Halule',
    'Category:Battle of Til-Tuba',
    'Category:Lamassu',
    'Category:Black Obelisk of Shalmaneser III',
    'Category:Assyrian palace reliefs',
    'Category:Fall of Nineveh',
    'Category:Assyrian art',
    'Category:Battle of Carchemish',

    // ═════════ HITTITES ═════════
    'Category:Battle of Kadesh',
    'Category:Treaty of Kadesh',
    'Category:Hittite reliefs',
    'Category:Hittite art',
    'Category:Suppiluliuma I',
    'Category:Mursili II',
    'Category:Hattusili III',
    'Category:Tudhaliya IV',
    'Category:Lions Gate (Hattusa)',
    'Category:Sphinx Gate (Hattusa)',
    'Category:Yazılıkaya',
    'Category:Reliefs at Hattusa',
    'Category:Hittite chariots',
    'Category:Hittite warriors',
    'Category:Sack of Hattusa',

    // ═════════ ANCIENT GREECE ═════════
    'Category:Battle of Marathon',
    'Category:Battle of Thermopylae',
    'Category:Battle of Salamis',
    'Category:Battle of Plataea',
    'Category:Battle of Mycale',
    'Category:Battle of Chaeronea',
    'Category:Battle of Leuctra',
    'Category:Battle of Mantinea',
    'Category:Battle of the Granicus',
    'Category:Battle of Issus',
    'Category:Battle of Gaugamela',
    'Category:Battle of the Hydaspes',
    'Category:Death of Socrates in art',
    'Category:Death of Alexander the Great',
    'Category:Leonidas I',
    'Category:Themistocles',
    'Category:Pericles',
    'Category:Alexander the Great in art',
    'Category:Greco-Persian Wars',
    'Category:Peloponnesian War in art',

    // ═════════ PERSIA (Achaemenid + Sassanid) ═════════
    'Category:Persepolis reliefs',
    'Category:Behistun Inscription',
    'Category:Cyrus the Great in art',
    'Category:Darius I in art',
    'Category:Xerxes I in art',
    'Category:Artaxerxes II in art',
    'Category:Cambyses II in art',
    'Category:Darius III in art',
    'Category:Battle of Pelusium (525 BC)',
    'Category:Battle of Opis',
    'Category:Family of Darius before Alexander',
    'Category:Achaemenid art',
    'Category:Sassanid art',
    'Category:Shapur I in art',
    'Category:Khosrow I in art',
    'Category:Khosrow II in art',
    'Category:Naqsh-e Rostam reliefs',
    'Category:Naqsh-e Rajab reliefs',
    'Category:Tomb of Cyrus',
    'Category:Cyrus Cylinder',

    // ═════════ ROMAN REPUBLIC + EMPIRE ═════════
    'Category:Death of Caesar in art',
    'Category:Caesar crossing the Rubicon',
    'Category:Cincinnatus in art',
    'Category:Death of Mark Antony',
    'Category:Cornelia, mother of the Gracchi',
    'Category:Mucius Scaevola in art',
    'Category:Horatii in art',
    'Category:Lucretia in art',
    'Category:Death of Germanicus',
    'Category:Triumph of Pompey',
    'Category:Triumph of Titus',
    'Category:Battle of Pharsalus',
    'Category:Battle of Actium',
    'Category:Battle of Cynoscephalae',
    'Category:Battle of Pydna',
    'Category:Battle of Teutoburg Forest',
    'Category:Battle of Adrianople (378)',
    'Category:Spartacus in art',
    'Category:Roman triumphs in art',
    'Category:Roman Senate in art',

    // ═════════ ANCIENT EGYPT ═════════
    'Category:Ramesses II in art',
    'Category:Tutankhamun in art',
    'Category:Cleopatra in art',
    'Category:Death of Cleopatra in art',
    'Category:Akhenaten in art',
    'Category:Hatshepsut in art',
    'Category:Thutmose III in art',
    'Category:Battle of Megiddo (15th century BC)',
    'Category:Sea Peoples',
    'Category:Egyptian temple reliefs',
    'Category:Tomb paintings of ancient Egypt',
    'Category:Joseph in Egypt in art',
    'Category:Moses and the burning bush',
    'Category:Crossing of the Red Sea in art',
    'Category:Plagues of Egypt in art',
    'Category:Death of the Firstborn (Bible)',
    'Category:Antony and Cleopatra in art',
    'Category:Battle of the Pyramids',

    // ═════════ MEDIEVAL EUROPE ═════════
    'Category:Battle of Hastings',
    'Category:Bayeux Tapestry',
    'Category:Battle of Bouvines',
    'Category:Battle of Crécy',
    'Category:Battle of Agincourt',
    'Category:Battle of Poitiers (1356)',
    'Category:Battle of Tours',
    'Category:First Crusade in art',
    'Category:Second Crusade in art',
    'Category:Third Crusade in art',
    'Category:Fourth Crusade in art',
    'Category:Siege of Jerusalem (1099)',
    'Category:Battle of Hattin',
    'Category:Saladin in art',
    'Category:Richard the Lionheart in art',
    'Category:Joan of Arc in art',
    'Category:Battle of Las Navas de Tolosa',
    'Category:Reconquista in art',
    'Category:Coronation of Charlemagne',
    'Category:Battle of Legnano',

    // ═════════ RENAISSANCE + EARLY MODERN WARS ═════════
    'Category:Battle of Pavia',
    'Category:Italian Wars in art',
    'Category:Battle of Lepanto in art',
    'Category:Battle of Marignano',
    'Category:Battle of Mohács (1526)',
    'Category:Siege of Vienna (1529)',
    'Category:Battle of Vienna (1683)',
    'Category:Battle of White Mountain',
    'Category:Battle of Lützen (1632)',
    'Category:Battle of Breitenfeld (1631)',
    'Category:Battle of Rocroi',
    'Category:Thirty Years\' War in art',
    'Category:Eighty Years\' War in art',
    'Category:Spanish Armada in art',
    'Category:Surrender of Breda',
    'Category:Siege of La Rochelle',
    'Category:Battle of Nördlingen',
    'Category:Battle of Nieuwpoort',
    'Category:Sack of Magdeburg',

    // ═════════ NAPOLEONIC + 19TH CENTURY ═════════
    'Category:Battle of Austerlitz',
    'Category:Battle of Borodino',
    'Category:Battle of Waterloo in art',
    'Category:Battle of Trafalgar in art',
    'Category:Battle of the Nile in art',
    'Category:Battle of the Pyramids',
    'Category:Battle of Friedland',
    'Category:Battle of Eylau',
    'Category:Battle of Wagram',
    'Category:Battle of Leipzig',
    'Category:Battle of Marengo',
    'Category:Coronation of Napoleon',
    'Category:Battle of Jena',
    'Category:Battle of Inkerman',
    'Category:Battle of Balaclava',
    'Category:Charge of the Light Brigade in art',
    'Category:Battle of Sedan',
    'Category:Battle of Königgrätz',
    'Category:Battle of Solferino',
    'Category:Crimean War in art',

    // ═════════ PRE-COLUMBIAN: Aztec ═════════
    'Category:Aztec art',
    'Category:Aztec codices',
    'Category:Moctezuma II',
    'Category:Cuauhtémoc',
    'Category:Aztec rituals in art',
    'Category:Aztec warfare in art',
    'Category:Templo Mayor',
    'Category:Conquest of Mexico in art',
    'Category:Tenochtitlan in art',
    'Category:Hernán Cortés in art',

    // ═════════ PRE-COLUMBIAN: Maya ═════════
    'Category:Maya art',
    'Category:Maya reliefs',
    'Category:Maya stelae',
    'Category:Maya murals',
    'Category:Pakal the Great',
    'Category:Tikal',
    'Category:Palenque',
    'Category:Bonampak murals',
    'Category:Maya hieroglyphs',
    'Category:Maya ballgame in art',

    // ═════════ PRE-COLUMBIAN: Inca ═════════
    'Category:Inca art',
    'Category:Atahualpa',
    'Category:Pachacuti',
    'Category:Manco Inca Yupanqui',
    'Category:Conquest of Peru in art',
    'Category:Machu Picchu in art',
    'Category:Inca textiles',
    'Category:Quipu',
    'Category:Sapa Inca',
    'Category:Francisco Pizarro in art',

    // ═════════ PRE-COLUMBIAN: Olmec ═════════
    'Category:Olmec art',
    'Category:Olmec colossal heads',
    'Category:Olmec reliefs',
    'Category:La Venta',
    'Category:San Lorenzo Tenochtitlán',
    'Category:Olmec figurines',
    'Category:Olmec deities',

    // ═════════ PRE-COLUMBIAN: Moche ═════════
    'Category:Moche art',
    'Category:Moche pottery',
    'Category:Lord of Sipán',
    'Category:Huaca de la Luna',
    'Category:Huaca del Sol',
    'Category:Moche ceramic figures',
    'Category:Moche iconography',

    // ═════════ ASIAN: Imperial China ═════════
    'Category:Qin Shi Huang in art',
    'Category:Han dynasty in art',
    'Category:Battle of Red Cliffs',
    'Category:Battle of Fei River',
    'Category:Tang dynasty in art',
    'Category:Song dynasty in art',
    'Category:Yongle Emperor',
    'Category:Kangxi Emperor',
    'Category:Qianlong Emperor',
    'Category:Empress Wu Zetian',
    'Category:Three Kingdoms in art',
    'Category:Mongol invasion of China in art',
    'Category:Boxer Rebellion in art',
    'Category:Opium Wars in art',
    'Category:Taiping Rebellion in art',

    // ═════════ ASIAN: Sengoku Japan / Samurai ═════════
    'Category:Battle of Sekigahara',
    'Category:Battle of Nagashino',
    'Category:Battle of Okehazama',
    'Category:Oda Nobunaga',
    'Category:Toyotomi Hideyoshi',
    'Category:Tokugawa Ieyasu',
    'Category:Date Masamune',
    'Category:Takeda Shingen',
    'Category:Uesugi Kenshin',
    'Category:Forty-seven Ronin in art',
    'Category:Battle of Shizugatake',
    'Category:Siege of Osaka',
    'Category:Genpei War in art',
    'Category:Battle of Dan-no-ura',
    'Category:Sengoku period in art',

    // ═════════ ASIAN: Mughal India ═════════
    'Category:Akbar in art',
    'Category:Jahangir in art',
    'Category:Shah Jahan in art',
    'Category:Aurangzeb in art',
    'Category:Babur in art',
    'Category:Humayun in art',
    'Category:First Battle of Panipat',
    'Category:Second Battle of Panipat',
    'Category:Third Battle of Panipat',
    'Category:Battle of Talikota',
    'Category:Battle of Plassey in art',
    'Category:Battle of Buxar',
    'Category:Mughal court paintings',
    'Category:Mughal miniature paintings',
    'Category:Tipu Sultan in art',

    // ═════════ ASIAN: Mongol Conquests ═════════
    'Category:Genghis Khan in art',
    'Category:Kublai Khan in art',
    'Category:Ögedei Khan',
    'Category:Möngke Khan',
    'Category:Hulagu Khan',
    'Category:Battle of Liegnitz (1241)',
    'Category:Battle of Mohi',
    'Category:Mongol siege of Baghdad (1258)',
    'Category:Mongol invasions of Japan',
    'Category:Sack of Baghdad (1258)',
    'Category:Mongol Empire in art',
    'Category:Mongol cavalry in art',
    'Category:Conquest of Khwarezmia',
    'Category:Mongol invasion of Hungary',

    // ═════════ ASIAN: Korea / Vietnam / SE Asia ═════════
    'Category:Imjin War',
    'Category:Yi Sun-sin',
    'Category:Battle of Hansan Island',
    'Category:Battle of Myeongnyang',
    'Category:Trung Sisters in art',
    'Category:Battle of Bach Dang River',
    'Category:Khmer Empire art',
    'Category:Angkor Wat reliefs',
    'Category:Bayon reliefs',
    'Category:Goryeo dynasty in art',
    'Category:Joseon dynasty in art',
    'Category:King Sejong the Great',
    'Category:Khmer warriors in art',
    'Category:Lê dynasty in art',
  ],

  perCategoryLimit: 300,       // bigger pool per category for thorough gap-fill
  totalTarget: 400,            // cap at ~$10
  classifyImageWidth: 500,
  fullImageWidth:    1400,
  imageMaxWidth:     1200,
  thumbMaxWidth:     400,
  imageQuality:      82,
  thumbQuality:      75,

  commonsRateMs:  280,
  claudeRateMs:   1500,
  fetchTimeoutMs: 45000,
  saveEvery:      20,
  heartbeatEvery: 50,
};

// ── PUBLIC DOMAIN LICENSE FILTER ──────────────────────────
function isPDOrCC0(extmetadata){
  const lic  = (extmetadata?.License?.value || '').toLowerCase();
  const name = (extmetadata?.LicenseShortName?.value || '').toLowerCase();
  const blob = lic + ' ' + name;
  if (/cc[- ]?by|share[- ]?alike|noncommercial|non-commercial|fair use|©|all rights reserved/.test(blob)) return false;
  if (/\b(cc0|cc-0|cc-?pdm|public domain|pd-?art|pd-?old|pd-?us|pd-?self|pd-?author|pd-?life|publicdomain|copyrighted free use)\b/.test(blob)) return true;
  if (lic === 'pd' || name === 'pd') return true;
  return false;
}

// ── UTILITIES ─────────────────────────────────────────────
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
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': 'HistoryChallengerBot/1.0 (info@historychallenger.com)', ...(opts.headers||{}) },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
      return res;
    } catch(e) {
      clearTimeout(timer);
      const msg = (e.name === 'AbortError') ? 'timeout' : e.message;
      if (attempt === maxRetries - 1) throw new Error(msg);
      await sleep(1200 * Math.pow(2, attempt));
    }
  }
}
function shortHash(s){ return crypto.createHash('md5').update(s).digest('hex').slice(0, 10); }
function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length-1; i > 0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── COMMONS API ───────────────────────────────────────────
async function commonsCategoryFiles(cat){
  await rateLimit('commons', CONFIG.commonsRateMs);
  const params = new URLSearchParams({
    action: 'query', format: 'json', list: 'categorymembers',
    cmtitle: cat, cmnamespace: '6', cmlimit: String(Math.min(CONFIG.perCategoryLimit, 500)),
    origin: '*',
  });
  const res = await fetchRetry(`${CONFIG.commonsApi}?${params}`, {}, `cat ${cat}`);
  const data = await res.json();
  if (data.error) return [];          // missing categories return error; skip
  return (data.query?.categorymembers || []).map(m => m.title);
}

async function commonsFileInfo(title, urlwidth){
  await rateLimit('commons', CONFIG.commonsRateMs);
  const params = new URLSearchParams({
    action: 'query', format: 'json', titles: title,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata|user|timestamp',
    iiurlwidth: String(urlwidth || CONFIG.classifyImageWidth),
    iiextmetadatafilter: 'License|LicenseShortName|Artist|Credit|DateTimeOriginal|ObjectName|ImageDescription|Categories',
    origin: '*',
  });
  const res = await fetchRetry(`${CONFIG.commonsApi}?${params}`, {}, `info ${title.slice(0, 60)}`);
  const data = await res.json();
  if (data.error) throw new Error('Commons API: ' + data.error.info);
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0];
  if (!page || page.missing || !page.imageinfo?.length) return null;
  return { ...page.imageinfo[0], pageid: page.pageid, title: page.title };
}

function pickArtistFromMeta(meta){
  const raw = meta?.Artist?.value || '';
  if (!raw) return null;
  return raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
}
function pickYearFromMeta(meta){
  const raw = meta?.DateTimeOriginal?.value || '';
  if (!raw) return null;
  const bc = raw.match(/(\d{1,4})\s*(BC|BCE)\b/i);
  if (bc) return -parseInt(bc[1], 10);
  const ad = raw.match(/(\d{3,4})/);
  if (ad){
    const y = parseInt(ad[1], 10);
    if (y > 0 && y < 2100) return y;
  }
  return null;
}
function pickDescriptionFromMeta(meta){
  const raw = meta?.ImageDescription?.value || '';
  return raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400) || null;
}

// ── IMAGE DOWNLOAD + RESIZE ───────────────────────────────
async function downloadBuffer(url, label){
  await rateLimit('commonsimg', 100);
  const res = await fetchRetry(url, {}, `img ${label}`);
  return Buffer.from(await res.arrayBuffer());
}
async function resizeAndSave(buf, outBase, outDir){
  const meta = await sharp(buf).metadata();
  if ((meta.width || 0) < 600 && (meta.height || 0) < 600){
    throw new Error(`too small: ${meta.width}x${meta.height}`);
  }
  const imagePath = path.join(outDir, 'images', `${outBase}.jpg`);
  const thumbPath = path.join(outDir, 'thumbs', `${outBase}.jpg`);
  await sharp(buf).resize(CONFIG.imageMaxWidth, CONFIG.imageMaxWidth, { fit:'inside', withoutEnlargement:true })
    .jpeg({ quality: CONFIG.imageQuality, progressive: true }).toFile(imagePath);
  await sharp(buf).resize(CONFIG.thumbMaxWidth, CONFIG.thumbMaxWidth, { fit:'inside', withoutEnlargement:true })
    .jpeg({ quality: CONFIG.thumbQuality, progressive: true }).toFile(thumbPath);
}
async function cleanImageFiles(outBase, outDir){
  await fs.unlink(path.join(outDir, 'images', `${outBase}.jpg`)).catch(()=>{});
  await fs.unlink(path.join(outDir, 'thumbs', `${outBase}.jpg`)).catch(()=>{});
}

// ── CLAUDE VISION ─────────────────────────────────────────
async function classifyWithClaude(imgBuffer, fileTitle, meta, apiKey){
  await rateLimit('anthropic', CONFIG.claudeRateMs);
  const imgB64 = imgBuffer.toString('base64');
  const cleanTitle = fileTitle.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
  const artist = pickArtistFromMeta(meta);
  const year   = pickYearFromMeta(meta);
  const desc   = pickDescriptionFromMeta(meta);

  const prompt = `You are curating a SECULAR HISTORY image library for a quiz. The player will be shown the image and asked "what does this depict?" with 4 options.

WE ARE ESPECIALLY HUNTING gap-fill content in these areas:
- Punic Wars (Hannibal, Cannae, Zama, Scipio Africanus, Carthaginian scenes)
- Assyria, Babylon, ancient Near East (palace reliefs, Lion Hunt of Ashurbanipal, Sennacherib, Nebuchadnezzar)
- Famous classical battles (Marathon, Thermopylae, Salamis, Issus, Gaugamela, Pharsalus, Actium)
- Named ancient and medieval rulers in identifiable historical contexts
- History paintings by Tiepolo, Poussin, Le Brun and other major history painters

REJECT (set usable=false) if any apply:
- VISIBLE ANSWER-TEXT IN IMAGE: image has a printed title, caption, or engraved label that names or describes the scene. Common in 17th-19th century engravings.
- Generic religious devotional with no specific historical event (Madonna and Child, anonymous saint, generic Annunciation, generic Crucifixion, holy family).
- GENERIC scene with no specific named subject (e.g. "battle scene", "cavalry charge", "knights jousting", "soldier on guard"). The scene must name a specific event, named figure, or historical moment.
- Decorative pattern, abstract piece, unclear/damaged image
- Pure landscape, still life, genre scene with no historical hook
- Anonymous portrait of someone you can't name
- Photograph of a modern person/event post-2000
- Document/manuscript page shown as text only

KEEP (set usable=true) ONLY if the scene is a SPECIFIC named historical event, named figure in identifiable context, or famous narrative scene with a recognizable named plot.

Then provide:
- depicted_era: ancient (before 500 AD), medieval (500-1500), or modern (after 1500). Use the era of WHAT IS DEPICTED.
- scene: 2-8 words, SPECIFIC. Must include a proper noun (place, person, or named event). "Battle of Cannae" not "a Roman battle". "Death of Hannibal" not "death of a general".
- scene_long: one sentence describing what is happening with names.
- distractors: 3 plausible WRONG scene labels in the same category. Each 2-8 words. Each should also include a proper noun.
- difficulty: 1=universally famous (Crucifixion, Coronation of Napoleon), 2=well-known event, 3=recognized by history fans, 4=specialist, 5=obscure.
- theme: one of [battle, historical_event, historical_figure, religious_narrative, mythological, daily_life, other]
- STYLE: American English. No em dashes.

METADATA:
File title: ${cleanTitle}
Artist: ${artist || '(unknown)'}
Date: ${year || '(unknown)'}
Description: ${desc || '(none)'}

Return ONLY valid JSON:
{"usable":true|false,"depicted_era":"ancient|medieval|modern","scene":"...","scene_long":"...","distractors":["...","...","..."],"difficulty":1,"theme":"battle"}`;

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

// ── MAIN ─────────────────────────────────────────────────
async function readJsonOrEmpty(file){
  try { return JSON.parse(await fs.readFile(path.join(CONFIG.outputDir, file), 'utf8')); }
  catch(e) { return []; }
}

async function main(){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey){ log('ANTHROPIC_API_KEY env var required', 'r'); process.exit(1); }

  const outDir = CONFIG.outputDir;
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, 'images'));
  await ensureDir(path.join(outDir, 'thumbs'));

  // Collect ALL existing source_ids from every manifest so we never duplicate
  const existing = new Set();
  for (const f of [
    'manifest.json', 'manifest_clean.json', 'manifest_historical.json',
    'manifest_wikimedia.json', 'manifest_combined.json', CONFIG.manifestFile,
  ]){
    const m = await readJsonOrEmpty(f);
    for (const it of m) if (it.source_id) existing.add(it.source_id);
  }
  log(`Loaded ${existing.size} source_ids from existing manifests (will not duplicate)`, 'd');

  // Resume support
  const manifestPath = path.join(outDir, CONFIG.manifestFile);
  let resumed = await readJsonOrEmpty(CONFIG.manifestFile);
  if (resumed.length) log(`Resuming: ${resumed.length} v2 items already saved`, 'c');

  // Gather candidates
  log('\nGathering candidates from focused categories...', 'c');
  const allTitles = new Set();
  for (const cat of CONFIG.categories){
    try {
      const titles = await commonsCategoryFiles(cat);
      titles.forEach(t => allTitles.add(t));
      log(`  ${cat}: ${titles.length} files`, 'b');
    } catch(e){
      log(`  ${cat}: FAILED ${e.message.slice(0,80)}`, 'r');
    }
  }
  const candidates = shuffle([...allTitles]).filter(t => !existing.has(t));
  log(`Total unique new candidates (after dedup): ${candidates.length}`, 'c');

  const manifest = resumed.slice();
  const startTime = Date.now();
  let processed = 0, rejectedLicense = 0, rejectedSize = 0, rejectedClaude = 0, errored = 0;

  for (const title of candidates){
    if (manifest.length - resumed.length >= CONFIG.totalTarget){
      log(`\nTarget +${CONFIG.totalTarget} reached. Stopping.`, 'g');
      break;
    }
    processed++;
    const baseName = `wm-${shortHash(title)}`;
    const shortTitle = title.replace(/^File:/i, '').slice(0, 60);
    process.stdout.write(`\r[${processed}] ${shortTitle.padEnd(60).slice(0,60)} ...info`);

    try {
      const info = await commonsFileInfo(title, CONFIG.classifyImageWidth);
      if (!info){ errored++; process.stdout.write(` noInfo\n`); continue; }
      if (!isPDOrCC0(info.extmetadata || {})){
        rejectedLicense++;
        const lic = (info.extmetadata?.LicenseShortName?.value || '').slice(0, 30);
        process.stdout.write(` licenseRej (${lic})\n`);
        continue;
      }
      const mime = (info.mime || '').toLowerCase();
      if (!mime.startsWith('image/') || mime.includes('svg')){
        rejectedSize++; process.stdout.write(` mimeRej (${mime})\n`); continue;
      }

      process.stdout.write(`\r[${processed}] ${shortTitle.padEnd(60).slice(0,60)} ...classifying`);
      const smallUrl = info.thumburl || info.url;
      const smallBuf = await downloadBuffer(smallUrl, baseName);
      const cls = await classifyWithClaude(smallBuf, title, info.extmetadata || {}, apiKey);

      if (!cls.usable){
        rejectedClaude++;
        process.stdout.write(` claudeRej\n`);
        continue;
      }
      if (!['ancient','medieval','modern'].includes(cls.depicted_era)){
        errored++;
        process.stdout.write(` badEra (${cls.depicted_era})\n`);
        continue;
      }

      process.stdout.write(`\r[${processed}] ${shortTitle.padEnd(60).slice(0,60)} ...downloading full`);
      const fullInfo = await commonsFileInfo(title, CONFIG.fullImageWidth);
      const fullUrl = fullInfo?.thumburl || fullInfo?.url || info.url;
      const fullBuf = await downloadBuffer(fullUrl, baseName);
      try { await resizeAndSave(fullBuf, baseName, outDir); }
      catch(e){
        rejectedSize++;
        process.stdout.write(` ${e.message.slice(0,40)}\n`);
        continue;
      }

      const artist = pickArtistFromMeta(info.extmetadata || {});
      const year   = pickYearFromMeta(info.extmetadata || {});
      const cleanTitle = title.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').slice(0, 200);
      const sourceUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`;

      manifest.push({
        id:            baseName,
        source:        'wikimedia',
        source_id:     title,
        image_key:     `images/${baseName}.jpg`,
        thumb_key:     `thumbs/${baseName}.jpg`,
        title:         cleanTitle,
        artist,
        creation_year: year,
        depicted_era:  cls.depicted_era,
        scene:         cls.scene,
        scene_long:    cls.scene_long,
        distractors:   Array.isArray(cls.distractors) ? cls.distractors.slice(0,3) : [],
        medium:        null,
        museum:        'Wikimedia Commons',
        culture:       null,
        classification:cls.theme || 'other',
        difficulty:    Number(cls.difficulty) || 3,
        theme:         cls.theme || 'other',
        source_url:    sourceUrl,
      });

      process.stdout.write(`\r[${processed}] ${shortTitle.padEnd(60).slice(0,60)} ${cls.theme} ${cls.depicted_era} d${cls.difficulty}\n`);

      if (manifest.length % CONFIG.saveEvery === 0){
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        log(`----- saved ${manifest.length} total | licRej:${rejectedLicense} sizeRej:${rejectedSize} claudeRej:${rejectedClaude} err:${errored}`, 'g');
      }
      if (processed % CONFIG.heartbeatEvery === 0){
        const elapsedMin = Math.round((Date.now() - startTime) / 60000);
        const acceptRate = Math.round((manifest.length - resumed.length) * 100 / Math.max(1, processed));
        log(`heartbeat @ ${processed}/${candidates.length} | ${elapsedMin}min | ${manifest.length - resumed.length} keepers (${acceptRate}% accept)`, 'c');
      }
    } catch(e){
      errored++;
      await cleanImageFiles(baseName, outDir);
      process.stdout.write(` ERR: ${e.message.slice(0, 100)}\n`);
    }
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  log('\n════════════ DONE ════════════', 'g');
  log(`v2 items accepted (this run): ${manifest.length - resumed.length}`, 'c');
  log(`Total v2 in manifest: ${manifest.length}`, 'c');
  log(`Rejected by license:    ${rejectedLicense}`, 'd');
  log(`Rejected by image size: ${rejectedSize}`, 'd');
  log(`Rejected by Claude:     ${rejectedClaude}`, 'd');
  log(`Errored:                ${errored}`, 'd');
  log(`\nNext: node scripts/combine_manifests.mjs (will pick up _v2)`);
}

main().catch(e => { console.error(e); process.exit(1); });
