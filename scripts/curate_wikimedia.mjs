#!/usr/bin/env node
// Curate historical paintings from Wikimedia Commons.
//
// - Pulls candidates from curated Commons categories (battle paintings,
//   history paintings, coronations, etc.)
// - Filters to PUBLIC DOMAIN / CC0 only (commercial-safe)
// - Bandwidth-saving: downloads a 400px thumbnail FIRST, classifies with
//   Claude on that, only fetches the full-resolution image if Claude
//   approves. ~70% bandwidth saving vs. download-everything.
//
// Usage:
//   $env:ANTHROPIC_API_KEY="sk-ant-..."
//   node scripts/curate_wikimedia.mjs
//
// Output:
//   paintings_data/manifest_wikimedia.json
//   paintings_data/images/wm-XXXXXXXX.jpg
//   paintings_data/thumbs/wm-XXXXXXXX.jpg

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  outputDir:     path.join(PROJECT_ROOT, 'paintings_data'),
  manifestFile:  'manifest_wikimedia.json',
  commonsApi:    'https://commons.wikimedia.org/w/api.php',
  anthropicBase: 'https://api.anthropic.com/v1/messages',
  anthropicModel:'claude-sonnet-4-5',

  // Categories on Commons to traverse. Each is sampled up to perCategoryLimit
  // members. Drawn broadly to cover battles, named figures, treaties,
  // coronations, ancient civilizations, and historical events.
  categories: [
    // ── Battles + military (general) ───────────────────────
    'Category:Battle paintings',
    'Category:Naval battles in art',
    'Category:Sieges in art',
    'Category:Battle scenes in art',
    'Category:Military art',
    'Category:Cavalry charges in art',
    'Category:Cavalry in art',
    'Category:Infantry in art',
    'Category:Artillery in art',
    'Category:Soldiers in art',
    'Category:Knights in art',
    'Category:Naval warfare in art',
    'Category:Sea battles in art',

    // ── History painting genre ─────────────────────────────
    'Category:History paintings',
    'Category:Paintings of historical events',
    'Category:Narrative paintings',
    'Category:Historical paintings by Eugène Delacroix',
    'Category:Historical paintings by Jacques-Louis David',
    'Category:Paintings by John Trumbull',
    'Category:Paintings by Benjamin West',
    'Category:Paintings by Jean-Léon Gérôme',
    'Category:Paintings by Antoine-Jean Gros',
    'Category:Paintings by Horace Vernet',

    // ── Specific event types ───────────────────────────────
    'Category:Coronations in art',
    'Category:Treaties in art',
    'Category:Surrenders in art',
    'Category:Assassinations in art',
    'Category:Executions in art',
    'Category:Royal court paintings',
    'Category:Triumphs in art',
    'Category:Funerals in art',
    'Category:Diplomatic missions in art',
    'Category:Royal weddings in art',

    // ── Named figures, ancient ─────────────────────────────
    'Category:Paintings of Julius Caesar',
    'Category:Paintings of Alexander the Great',
    'Category:Paintings of Cleopatra',
    'Category:Paintings of Hannibal',
    'Category:Paintings of Roman emperors',
    'Category:Paintings of Augustus',
    'Category:Paintings of Nero',
    'Category:Paintings of Constantine the Great',
    'Category:Paintings of Pericles',
    'Category:Paintings of Socrates',

    // ── Named figures, medieval / early modern ────────────
    'Category:Paintings of Charlemagne',
    'Category:Paintings of Joan of Arc',
    'Category:Paintings of Saladin',
    'Category:Paintings of Genghis Khan',
    'Category:Paintings of Henry VIII of England',
    'Category:Paintings of Elizabeth I of England',
    'Category:Paintings of Mary, Queen of Scots',
    'Category:Paintings of Louis XIV',
    'Category:Paintings of Frederick the Great',
    'Category:Paintings of Peter the Great',
    'Category:Paintings of Catherine the Great',

    // ── Named figures, modern ──────────────────────────────
    'Category:Paintings of Napoleon',
    'Category:Paintings of Marie Antoinette',
    'Category:Paintings of George Washington',
    'Category:Paintings of Abraham Lincoln',
    'Category:Paintings of Thomas Jefferson',
    'Category:Paintings of Benjamin Franklin',
    'Category:Paintings of Wellington',
    'Category:Paintings of Bismarck',
    'Category:Paintings of Napoleon III',

    // ── Ancient civilizations ──────────────────────────────
    'Category:Ancient Roman scenes in art',
    'Category:Ancient Greek scenes in art',
    'Category:Ancient Egyptian scenes in art',
    'Category:Mesopotamian art',
    'Category:Achaemenid art',
    'Category:Assyrian palace reliefs',
    'Category:Egyptian tomb paintings',
    'Category:Egyptian reliefs',
    'Category:Roman frescoes',
    'Category:Pompeii frescoes',
    'Category:Roman mosaics with historical subjects',
    'Category:Greek vase paintings with mythological subjects',
    'Category:Persian miniatures',
    'Category:Sassanian art',
    'Category:Babylonian art',
    'Category:Hittite art',
    'Category:Phoenician art',

    // ── Medieval ──────────────────────────────────────────
    'Category:Medieval scenes in paintings',
    'Category:Crusader art',
    'Category:Tournaments in art',
    'Category:Medieval miniatures of battles',
    'Category:Bayeux Tapestry',
    'Category:Medieval illuminated manuscripts depicting battles',

    // ── Renaissance + early modern ─────────────────────────
    'Category:Renaissance history paintings',
    'Category:Paintings of the Italian Wars',
    'Category:Paintings of the Thirty Years War',
    'Category:Paintings of the English Civil War',
    'Category:Paintings of the Hundred Years War',
    'Category:Paintings of the Wars of the Roses',

    // ── American + revolutionary scenes ────────────────────
    'Category:Paintings of the American Revolutionary War',
    'Category:Paintings of the American Civil War',
    'Category:Paintings of the French Revolution',
    'Category:Paintings of the Napoleonic Wars',
    'Category:Paintings of the War of 1812',
    'Category:Paintings of the Crimean War',
    'Category:Paintings of the Franco-Prussian War',
    'Category:Paintings of the Mexican-American War',

    // ── Asian historical ───────────────────────────────────
    'Category:Mughal paintings',
    'Category:Mughal court paintings',
    'Category:Ukiyo-e prints depicting historical events',
    'Category:Ukiyo-e prints depicting samurai',
    'Category:Chinese history paintings',
    'Category:Paintings of Chinese emperors',
    'Category:Paintings of Japanese emperors',
    'Category:Japanese woodblock prints of historical battles',
    'Category:Indian miniature paintings',

    // ── Pre-Columbian + African ────────────────────────────
    'Category:Aztec art',
    'Category:Inca art',
    'Category:Maya art',
    'Category:Olmec art',
    'Category:Pre-Columbian art',
    'Category:Benin Bronzes',
    'Category:Ethiopian art',

    // ── Exploration + science ──────────────────────────────
    'Category:Paintings of Christopher Columbus',
    'Category:Paintings of explorers',
    'Category:Voyages in art',
    'Category:Paintings of historical scientists',
  ],

  perCategoryLimit: 200,       // up to 200 file titles per category
  totalTarget: 400,            // stop accepting once we hit this (caps ~$10 budget)
  classifyImageWidth: 500,     // small image fetched for Claude classification
  fullImageWidth:    1400,     // full image fetched after Claude OK
  imageMaxWidth:     1200,     // sharp resize for our R2 image
  thumbMaxWidth:     400,
  imageQuality:      82,
  thumbQuality:      75,

  commonsRateMs:  280,
  claudeRateMs:   1500,
  fetchTimeoutMs: 45000,
  saveEvery:      20,
  heartbeatEvery: 50,          // print full progress summary every N processed
};

// ── PUBLIC DOMAIN LICENSE FILTER ─────────────────────────────────────────
// Match Commons "License" / "LicenseShortName" values that are public domain
// or CC0 (commercial-safe). REJECT anything CC-BY, CC-BY-SA, CC-BY-NC, fair
// use, etc. Be conservative.
function isPDOrCC0(extmetadata){
  const lic  = (extmetadata?.License?.value || '').toLowerCase();
  const name = (extmetadata?.LicenseShortName?.value || '').toLowerCase();
  const blob = lic + ' ' + name;
  // Strict: REJECT first if any restricted term appears (CC-BY, share-alike,
  // NC, fair use, copyright symbol, "all rights reserved")
  if (/cc[- ]?by|share[- ]?alike|noncommercial|non-commercial|fair use|©|all rights reserved/.test(blob)) return false;
  // Acceptable PD / CC0 / Public Domain Mark variants
  if (/\b(cc0|cc-0|cc-?pdm|public domain|pd-?art|pd-?old|pd-?us|pd-?self|pd-?author|pd-?life|publicdomain|copyrighted free use)\b/.test(blob)) return true;
  if (lic === 'pd' || name === 'pd') return true;
  return false;
}

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

function shortHash(s){
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 10);
}

function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length-1; i > 0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── COMMONS API ───────────────────────────────────────────────────────────
async function commonsCategoryFiles(cat){
  // Returns up to perCategoryLimit file titles from a category (namespace 6).
  await rateLimit('commons', CONFIG.commonsRateMs);
  const params = new URLSearchParams({
    action: 'query', format: 'json', list: 'categorymembers',
    cmtitle: cat, cmnamespace: '6', cmlimit: String(Math.min(CONFIG.perCategoryLimit, 500)),
    origin: '*',
  });
  const res = await fetchRetry(`${CONFIG.commonsApi}?${params}`, {}, `cat ${cat}`);
  const data = await res.json();
  if (data.error) throw new Error('Commons API: ' + data.error.info);
  return (data.query?.categorymembers || []).map(m => m.title);
}

async function commonsFileInfo(title, urlwidth){
  // Returns { url, thumburl, size, mime, extmetadata, pageid } or null.
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
  // Commons artist field is often raw HTML like:
  // "<bdi><a href=...>Edgar Degas</a></bdi>" — strip tags.
  const raw = meta?.Artist?.value || '';
  if (!raw) return null;
  return raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
}

function pickYearFromMeta(meta){
  // DateTimeOriginal can be free-form. Try to extract a 1-4 digit year.
  const raw = meta?.DateTimeOriginal?.value || '';
  if (!raw) return null;
  // Look for BC: "1500 BC" / "ca. 480 BC" / "circa 200 BCE"
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

// ── IMAGE DOWNLOAD + RESIZE ───────────────────────────────────────────────
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

// ── CLAUDE VISION ─────────────────────────────────────────────────────────
async function classifyWithClaude(imgBuffer, fileTitle, meta, apiKey){
  await rateLimit('anthropic', CONFIG.claudeRateMs);
  const imgB64 = imgBuffer.toString('base64');

  const cleanTitle = fileTitle.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
  const artist = pickArtistFromMeta(meta);
  const year   = pickYearFromMeta(meta);
  const desc   = pickDescriptionFromMeta(meta);

  const prompt = `You are curating a SECULAR HISTORY image library for a quiz. The player will be shown the image and asked "what does this depict?" with 4 options.

WHAT WE WANT (broad, generous): recognizable historical SCENES from the entire secular human past, all eras (ancient, medieval, modern), all civilizations. The kind of images that appear in serious history textbooks. Examples (illustrative, not exhaustive):
- Battles, sieges, military scenes (Cannae, Hastings, Waterloo, Yorktown, Civil War)
- Named historical figures DOING something (Napoleon's coronation, Caesar crossing the Rubicon, Washington crossing the Delaware)
- Coronations, treaties, surrenders, executions, royal court scenes
- Ancient reliefs/murals depicting real events (Assyrian campaigns, Egyptian pharaohs in battle, Persian processions)
- Famous classical scenes (Death of Socrates, Oath of the Horatii, Rape of the Sabines)
- Scientific/technological/cultural milestones (printing press, early balloon flights, famous lectures)
- Be GENEROUS: if a literate adult would say "yes, this depicts a recognizable historical scene from somewhere in the human past", it qualifies.

REJECT (set usable=false) if any apply:
- Generic religious devotional with no specific historical event (Madonna and Child, anonymous saint, generic Annunciation, generic Crucifixion, holy family). Famous biblical narrative scenes (Last Supper, David and Goliath) are fine; anonymous devotional is not.
- Pure mythological allegory unless a famous named scene (Death of Socrates is fine; a generic nymph painting is not)
- Decorative pattern, abstract piece, unclear/damaged image
- Pure landscape, still life, or genre scene with no historical hook
- Anonymous portrait of someone you can't name from the image
- Map without historical event depicted
- Photograph of a modern person/event post-2000
- Document/manuscript shown as text only (no scene)

Then provide:
- depicted_era: ancient (before 500 AD), medieval (500-1500), or modern (after 1500). Use the era of WHAT IS DEPICTED, not when the artwork was made.
- scene: 2-8 words, specific. "Battle of Issus" not "a battle". "Coronation of Napoleon" not "a king".
- scene_long: one sentence describing what is happening.
- distractors: 3 plausible WRONG scene labels in the same category. Each 2-8 words.
- difficulty: 1 = universally famous (Crucifixion, Coronation of Napoleon). 2 = well-known event. 3 = recognized by history fans. 4 = specialist. 5 = obscure.
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

// ── MAIN ─────────────────────────────────────────────────────────────────
async function main(){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey){ log('ANTHROPIC_API_KEY env var required', 'r'); process.exit(1); }

  const outDir = CONFIG.outputDir;
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, 'images'));
  await ensureDir(path.join(outDir, 'thumbs'));

  // Resume support: load existing manifest, also avoid IDs already in
  // manifest.json or manifest_historical.json.
  const manifestPath = path.join(outDir, CONFIG.manifestFile);
  let resumed = [];
  try {
    resumed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (Array.isArray(resumed) && resumed.length){
      log(`\nResuming: ${resumed.length} Wikimedia items already saved`, 'c');
    } else { resumed = []; }
  } catch(e) {}

  const seenSourceIds = new Set(resumed.map(r => r.source_id));

  // Gather candidate file titles from each category
  log('\nGathering candidate files from Commons categories...', 'c');
  const allTitles = new Set();
  for (const cat of CONFIG.categories){
    try {
      const titles = await commonsCategoryFiles(cat);
      titles.forEach(t => allTitles.add(t));
      log(`  ${cat}: ${titles.length} files`, 'b');
    } catch(e){
      log(`  ${cat}: FAILED ${e.message.slice(0,100)}`, 'r');
    }
  }
  const candidates = shuffle([...allTitles]).filter(t => !seenSourceIds.has(t));
  log(`Total unique candidates: ${candidates.length}  (${seenSourceIds.size} already done)`, 'c');

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
      // Skip non-image MIME types and SVGs (which sharp doesn't reliably handle)
      const mime = (info.mime || '').toLowerCase();
      if (!mime.startsWith('image/') || mime.includes('svg')){
        rejectedSize++; process.stdout.write(` mimeRej (${mime})\n`); continue;
      }

      // Step 1: download SMALL image for classification
      process.stdout.write(`\r[${processed}] ${shortTitle.padEnd(60).slice(0,60)} ...classifying (small)`);
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

      // Step 2: Claude approved -> download FULL image, resize, save
      process.stdout.write(`\r[${processed}] ${shortTitle.padEnd(60).slice(0,60)} ...downloading full`);
      const fullInfo = await commonsFileInfo(title, CONFIG.fullImageWidth);
      const fullUrl = fullInfo?.thumburl || fullInfo?.url || info.url;
      const fullBuf = await downloadBuffer(fullUrl, baseName);
      try {
        await resizeAndSave(fullBuf, baseName, outDir);
      } catch(e){
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
        log(`heartbeat @ ${processed}/${candidates.length} candidates | ${elapsedMin}min elapsed | ${manifest.length - resumed.length} keepers (${acceptRate}% accept rate)`, 'c');
      }
    } catch(e){
      errored++;
      await cleanImageFiles(baseName, outDir);
      process.stdout.write(` ERR: ${e.message.slice(0, 100)}\n`);
    }
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  log('\n════════════ DONE ════════════', 'g');
  log(`Wikimedia items accepted (this run): ${manifest.length - resumed.length}`, 'c');
  log(`Total in manifest: ${manifest.length}`, 'c');
  log(`Rejected by license:    ${rejectedLicense}`, 'd');
  log(`Rejected by image size: ${rejectedSize}`, 'd');
  log(`Rejected by Claude:     ${rejectedClaude}`, 'd');
  log(`Errored:                ${errored}`, 'd');
  log(`\nOutput: ${manifestPath}`, 'c');
}

main().catch(e => { console.error(e); process.exit(1); });
