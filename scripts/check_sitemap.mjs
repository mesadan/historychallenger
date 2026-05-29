#!/usr/bin/env node
// Fetch every URL in sitemap.xml and assert each returns 200 directly,
// not 301/302/308. Catches the Cloudflare Pages .html-stripping trap
// where a URL like /foo.html returns 308 → /foo, which Google flags as
// "Page with redirect" / "Redirect error" and refuses to index.
//
// USAGE:
//   node scripts/check_sitemap.mjs
//
// Exit codes:
//   0 = all URLs return 200
//   1 = at least one URL redirects or errors
//
// Run before pushing any change to sitemap.xml or canonical tags.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(PROJECT_ROOT, 'sitemap.xml');

// Pages that Cloudflare Pages serves at clean URLs (no .html).
// auth-callback.html is intentionally excluded: Google's registered OAuth
// redirect URI uses the .html suffix and must keep matching.
const CLEAN_PAGES = [
  'dispatch','play','overlap','persona','hq','dialogue','paintings',
  'blog','misconceptions','battles','coincidences','blog-index',
  'profile','auth-magic'
];

async function scanForStaleHtmlLinks() {
  const exts = ['.html','.js'];
  const entries = await fs.readdir(PROJECT_ROOT);
  const files = entries.filter(f => exts.includes(path.extname(f)));
  const issues = [];
  const pageAlt = CLEAN_PAGES.join('|');
  const patterns = [
    { name: 'og:url with .html',  re: new RegExp(`<meta\\s+property=["']og:url["']\\s+content=["']https://historychallenger\\.com/(${pageAlt})\\.html`, 'gi') },
    { name: 'canonical with .html', re: new RegExp(`rel=["']canonical["']\\s+href=["']https://historychallenger\\.com/(${pageAlt})\\.html`, 'gi') },
    { name: 'internal href with .html', re: new RegExp(`href=["']/(${pageAlt})\\.html`, 'g') },
  ];
  for (const f of files) {
    const txt = await fs.readFile(path.join(PROJECT_ROOT, f), 'utf8');
    for (const p of patterns) {
      let m;
      while ((m = p.re.exec(txt))) {
        const line = txt.slice(0, m.index).split('\n').length;
        issues.push(`  ${f}:${line}  ${p.name}: ${m[0]}`);
      }
    }
  }
  if (issues.length) {
    console.log('Stale .html references found (Cloudflare Pages will 308-redirect these, Google flags as "Page with redirect"):\n');
    console.log(issues.join('\n'));
    console.log(`\nFix: drop the .html from the listed lines. Allowed exception: auth-callback.html (OAuth).`);
    process.exit(1);
  }
}

async function main() {
  await scanForStaleHtmlLinks();
  const xml = await fs.readFile(SITEMAP, 'utf8');
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].trim());
  if (!locs.length) {
    console.error('No <loc> entries found in sitemap.xml');
    process.exit(1);
  }
  console.log(`Checking ${locs.length} URLs from sitemap.xml ...\n`);

  let bad = 0;
  for (const url of locs) {
    try {
      // redirect: 'manual' so fetch reports the redirect itself, doesn't follow
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
      if (res.status === 200) {
        console.log(`  OK   ${res.status}  ${url}`);
      } else if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location') || '?';
        console.log(`  BAD  ${res.status}  ${url}  →  ${loc}`);
        bad++;
      } else {
        console.log(`  BAD  ${res.status}  ${url}`);
        bad++;
      }
    } catch (e) {
      console.log(`  ERR        ${url}  (${e.message})`);
      bad++;
    }
  }

  console.log(`\n${locs.length - bad}/${locs.length} URLs return 200 directly.`);
  if (bad) {
    console.log(`\n${bad} issue(s) found.`);
    console.log(`Likely cause: a URL with .html or /index.html that Cloudflare Pages 308-strips.`);
    console.log(`Fix: edit sitemap.xml (and the matching canonical tag) to use the clean URL.`);
    process.exit(1);
  }
  console.log('All clean.');
}

main().catch(e => { console.error(e); process.exit(1); });
