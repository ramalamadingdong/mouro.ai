#!/usr/bin/env node
// Fails if a page or game on mouro.ai is missing the analytics tag.
//
//   node scripts/check-analytics.mjs        (also run by CI and `npm test`)
//
// Checked: every site/**/*.html, every games/<game>/index.html (Vite) and
// every games/<game>/src/app/+html.tsx (Expo). See "Analytics" in CLAUDE.md.
// A page that must not be tracked goes in SKIP with the reason.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TAG = 'https://mouro.ai/static/js/analytics.js';

// Instant redirects: nobody sees them, and the page they forward to is tracked.
const SKIP = new Set([
  'site/games/road-trip/index.html', // forwards old links to the road trip tabs
]);
// site/projects/<id>/index.html are share addresses written by
// scripts/render-share-cards.mjs that redirect straight to /projects/#<id>.
const isShareRedirect = (p) => /^site\/projects\/[^/]+\/index\.html$/.test(p);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const pages = walk(join(ROOT, 'site')).filter((p) => p.endsWith('.html'));
for (const g of readdirSync(join(ROOT, 'games'))) {
  for (const f of ['index.html', 'src/app/+html.tsx']) {
    const p = join(ROOT, 'games', g, f);
    if (existsSync(p)) pages.push(p);
  }
}

const missing = pages
  .map((p) => relative(ROOT, p))
  .filter((p) => !SKIP.has(p) && !isShareRedirect(p))
  .filter((p) => !readFileSync(join(ROOT, p), 'utf8').includes(TAG));

if (missing.length) {
  console.error(`Missing the analytics tag (see "Analytics" in CLAUDE.md):\n  ${missing.join('\n  ')}`);
  console.error(`\nAdd before </head>:\n  <script defer src="${TAG}"></script>`);
  process.exit(1);
}
console.log(`analytics tag present on ${pages.length} pages`);
