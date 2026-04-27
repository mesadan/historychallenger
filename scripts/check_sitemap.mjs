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

async function main() {
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
