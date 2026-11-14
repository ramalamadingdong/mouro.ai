#!/usr/bin/env node
// Render the hub and Sudoku icon SVGs (site/games/**/icons/*.svg) to the PNG
// sizes a web app manifest and iOS need. Run after editing either SVG:
//
//   npx -y -p playwright node scripts/render-icons.mjs
//
// Needs a Playwright Chromium (`npx playwright install chromium`). The PNGs are
// committed, so nothing in the build or deploy depends on this script.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repo = resolve(import.meta.dirname, '..');
const icons = [
  join(repo, 'site/games/icons/hub.svg'),
  join(repo, 'site/games/sudoku/icons/sudoku.svg'),
];
const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };

const browser = await chromium.launch();
for (const svgPath of icons) {
  const svg = readFileSync(svgPath, 'utf8');
  for (const [name, size] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    await page.screenshot({ path: join(dirname(svgPath), name) });
    await page.close();
  }
}
await browser.close();
