#!/usr/bin/env node
// Render every hand-drawn icon SVG in the repo to the PNG sizes a web app
// manifest, iOS and Expo need. Run after editing any of the SVGs below:
//
//   npx -y -p playwright node scripts/render-icons.mjs
//
// Needs a Playwright Chromium (`npx playwright install chromium`). The PNGs are
// committed, so nothing in the build or deploy depends on this script.
// (Texas Hold'em is not here: its icon is a painting, not an SVG.)
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repo = resolve(import.meta.dirname, '..');

// What a browser needs: manifest icons plus the iOS home-screen icon.
const web = (dir) => [
  [`${dir}/icon-192.png`, 192],
  [`${dir}/icon-512.png`, 512],
  [`${dir}/apple-touch-icon.png`, 180],
];

// [source SVG, [[output PNG, size], ...]] — all paths relative to the repo root.
const icons = [
  ['site/games/icons/hub.svg', web('site/games/icons')],
  ['site/games/sudoku/icons/sudoku.svg', web('site/games/sudoku/icons')],
  ['site/games/cat-cafe/icons/cat-cafe.svg', web('site/games/cat-cafe/icons')],
  ['site/games/road-trip/trivia/icons/town-trivia.svg', web('site/games/road-trip/trivia/icons')],
  ['site/games/road-trip/photo/icons/photo-guess.svg', web('site/games/road-trip/photo/icons')],
  ['site/games/road-trip/categories/icons/categories.svg', web('site/games/road-trip/categories/icons')],
  ['games/yahtzee/public/icons/icon.svg', web('games/yahtzee/public/icons')],
  ['games/dots/public/icons/icon.svg', web('games/dots/public/icons')],
  ['games/mahjong/public/icons/icon.svg', web('games/mahjong/public/icons')],
  ['games/pawprints/public/icons/icon.svg', web('games/pawprints/public/icons')],
  ['games/tabby-eights/public/icons/icon.svg', web('games/tabby-eights/public/icons')],
  [
    'games/backgammon/public/icons/icon.svg',
    // The assets/images copies are what app.json points Expo at.
    [
      ...web('games/backgammon/public/icons'),
      ['games/backgammon/assets/images/icon.png', 1024],
      ['games/backgammon/assets/images/favicon.png', 64],
    ],
  ],
  [
    'games/gin-rummy/public/icons/icon.svg',
    [
      ...web('games/gin-rummy/public/icons'),
      ['games/gin-rummy/assets/images/icon.png', 1024],
      ['games/gin-rummy/assets/images/favicon.png', 64],
    ],
  ],
];

const browser = await chromium.launch();
for (const [source, outputs] of icons) {
  const svg = readFileSync(join(repo, source), 'utf8');
  for (const [output, size] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    await page.screenshot({ path: join(repo, output) });
    await page.close();
  }
}
await browser.close();
