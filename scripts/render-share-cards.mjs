#!/usr/bin/env node
// Draw the link-preview cards (Open Graph images, 1200 × 630) that Slack,
// LinkedIn, iMessage and friends show when a mouro.ai link is pasted:
//
//   node scripts/render-share-cards.mjs
//
// It writes two things, both committed, so nothing in the build or deploy
// depends on this script:
//
//   site/static/share/<name>.png     one card per page, project and game
//   site/projects/<id>/index.html    a share address for each project
//
// A link preview is fetched by URL and ignores the #fragment, so
// /projects/#pcb-agent can only ever show the Projects card. Each project
// therefore gets a tiny page at /projects/<id>/ that carries its own card and
// sends people straight on to the write-up. Share that address.
//
// The pages themselves point at their card by hand (og:image in each <head>);
// adding a page means adding a row here and those tags there.
//
// Needs Playwright with Chromium (`npm i --no-save playwright && npx playwright
// install chromium`) and network access for the games' Google Fonts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repo = resolve(import.meta.dirname, '..');
const W = 1200;
const H = 630;

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const dataUri = (path) =>
  `data:${mime[extname(path)]};base64,${readFileSync(join(repo, path)).toString('base64')}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ── The cards ───────────────────────────────────────────────────────────────

const POSTER = 'site/static/video/round-trip-poster.jpg';

// Portfolio pages: the site's own look (aluminium, steel ink, safety yellow).
const pages = [
  {
    name: 'home',
    label: 'Portfolio',
    title: 'Rami Mouro',
    text: 'Robotics and physical AI developer relations lead at Qualcomm. VLA models on edge NPUs, tutorials and workshops, and tools for FIRST teams.',
    path: 'mouro.ai',
    art: 'site/static/img/Rami_Pic.jpg',
    loud: true,
  },
  {
    name: 'projects',
    label: 'Portfolio',
    title: 'Projects',
    text: 'Write-ups on flagship builds, field automation, and applied research.',
    path: 'mouro.ai/projects',
    list: ['Pi0.5 VLA on Dragonwing NPU', 'PCB Agent', 'FIRST Agentic CSA', 'FIRST and K-12 robotics', 'Edge AI demos', 'FRC Shooter Selector'],
    loud: true,
  },
  {
    name: 'pcb-design-with-ai',
    label: 'Article',
    title: 'Designing a circuit board end to end with an AI agent',
    text: 'A CSV as the source of truth, idempotent build passes, and checks that run on the fab output.',
    path: 'mouro.ai/blog/pcb-design-with-ai',
    art: POSTER,
  },
];

// One per write-up on /projects/. `id` is the write-up's anchor on that page.
const projects = [
  {
    id: 'pi05',
    title: 'Pi0.5 VLA on Dragonwing NPU',
    text: 'A vision-language-action model running on edge NPUs: 86/100 task success on LIBERO-10.',
  },
  {
    id: 'pcb-agent',
    title: 'PCB Agent',
    text: 'Circuit boards designed end to end by an AI agent: parts, netlist, placement, routing and gerbers.',
    art: POSTER,
  },
  {
    id: 'agentic-csa',
    title: 'FIRST Agentic CSA',
    text: 'AI-powered search across the FRC documentation, for students and the volunteers who support them.',
  },
  {
    id: 'first-k12',
    title: 'FIRST and K-12 robotics at Qualcomm',
    text: 'A grassroots robotics partnership with FIRST that became a Qualcomm engineering initiative.',
  },
  {
    id: 'edge-ai-demos',
    title: 'Edge AI demos',
    text: 'MCP across cloud, PC and IoT hardware, on-device Gemma, and the RUBIK Pi developer experience.',
  },
  {
    id: 'shooter-selector',
    title: 'FRC Shooter Selector',
    text: 'A ballistics analysis and optimization tool for choosing a robot’s shooter.',
  },
  {
    id: 'rubik-tflite',
    title: 'Rubik TFLite',
    text: 'TFLite and libQnn running on the Qualcomm NPU.',
  },
  {
    id: 'military-service',
    title: 'Military Service Leadership',
    text: 'Maintenance, logistics, and mission support in the Colorado Army National Guard.',
  },
  {
    id: 'auto-xo',
    title: 'Auto XO',
    text: 'Signal-driven task automation for the tactical operations center.',
  },
  {
    id: 'dd-1750',
    title: 'DD Form 1750 Automation',
    text: 'An Excel macro that fills in Army packing lists.',
  },
  {
    id: 'qualcomm-youtube',
    title: 'Talks and demos',
    text: 'Edge AI talks and demos made for Qualcomm on YouTube.',
  },
];

// Games: the hub's look, each in its own tile colours (site/games/index.html).
const games = [
  {
    name: 'games',
    title: 'Family game night',
    text: 'Seven games to play with family and friends. No accounts, no ads — share a code and play.',
    path: 'mouro.ai/games',
    a: '#1c2d26', b: '#0c1512', ink: '#e0b64a',
    icons: [
      'games/holdem/public/icons/icon-512.png',
      'games/backgammon/public/icons/icon-512.png',
      'games/gin-rummy/public/icons/icon-512.png',
      'games/dots/public/icons/icon-512.png',
      'games/yahtzee/public/icons/icon-512.png',
      'site/games/sudoku/icons/icon-512.png',
      'site/games/cat-cafe/icons/icon-512.png',
    ],
  },
  {
    name: 'holdem',
    title: 'Texas Hold’em',
    text: 'No-limit poker night. Play friends online, or take on a table of card-sharp cats.',
    tags: ['2–6 players', 'Online', 'vs computer cats'],
    path: 'mouro.ai/holdem',
    a: '#7a4a26', b: '#3b2313', ink: '#e0b64a',
    icon: 'games/holdem/public/icons/icon-512.png',
  },
  {
    name: 'backgammon',
    title: 'Backgammon',
    text: 'Tawleh rules: mars counts double, no cube. Play a friend online, or the Professor, a computer cat.',
    tags: ['2 players', 'Online', 'vs computer cat'],
    path: 'mouro.ai/backgammon',
    a: '#1f5a47', b: '#12362a', ink: '#e0b64a',
    icon: 'games/backgammon/public/icons/icon-512.png',
  },
  {
    name: 'gin-rummy',
    title: 'Gin Rummy',
    text: 'Classic two-player gin. Share a room code, or play Marmalade, a computer cat.',
    tags: ['2 players', 'Online', 'vs computer cat'],
    path: 'mouro.ai/gin-rummy',
    a: '#8a3443', b: '#561d28', ink: '#f5f0e1',
    icon: 'games/gin-rummy/public/icons/icon-512.png',
  },
  {
    name: 'dots',
    title: 'Dots and Boxes',
    text: 'Draw a line, close a box, go again. Up to four friends, or outfox the computer cats.',
    tags: ['2–4 players', 'Online', 'vs computer cats'],
    path: 'mouro.ai/dots',
    a: '#5b3a7a', b: '#2e1c42', ink: '#f2a35e',
    icon: 'games/dots/public/icons/icon-512.png',
  },
  {
    name: 'pawprints',
    title: 'Pawprints',
    text: 'Five paws in a row across a patchwork quilt. Block your friends online, or outwit the computer cats.',
    tags: ['2–4 players', 'Online', 'vs computer cats'],
    path: 'mouro.ai/pawprints',
    a: '#8a4b1f', b: '#45240e', ink: '#f7d9a8',
    icon: 'games/pawprints/public/icons/icon-512.png',
  },
  {
    name: 'yahtzee',
    title: 'Yahtzee',
    text: 'Five dice, thirteen boxes. Up to four players on their own phones, or pass one around.',
    tags: ['1–4 players', 'Online', 'Pass & play'],
    path: 'mouro.ai/yahtzee',
    a: '#2d3360', b: '#171a30', ink: '#f0a830',
    icon: 'games/yahtzee/public/icons/icon-512.png',
  },
  {
    name: 'sudoku',
    title: 'Sudoku',
    text: 'A new puzzle every day, plus easy to expert on demand. Notes, hints and your progress saved.',
    tags: ['1 player', 'Daily puzzle'],
    path: 'mouro.ai/games/sudoku',
    a: '#27437a', b: '#14213f', ink: '#7bb8ff',
    icon: 'site/games/sudoku/icons/icon-512.png',
  },
  {
    name: 'cat-cafe',
    title: 'Cat Café',
    text: 'Draft cat-shaped tiles and fit them onto your café floor. Match coats, keep rivals apart, fill whole rows.',
    tags: ['1 player', 'Tile puzzle', 'vs computer cat'],
    path: 'mouro.ai/games/cat-cafe',
    a: '#1f6f78', b: '#123f47', ink: '#f2b560',
    icon: 'site/games/cat-cafe/icons/icon-512.png',
  },
  {
    name: 'road-trip',
    title: 'Road Trip',
    text: 'Trivia about each town and county you cross into, guess when you’ll pass a photo of the road ahead, and Categories out loud.',
    tags: ['Live GPS', 'Word game', 'Car screen'],
    path: 'mouro.ai/games/road-trip',
    a: '#2f4a66', b: '#172433', ink: '#f4c542',
    icon: 'site/games/road-trip/icons/icon-512.png',
  },
];

// ── Templates ───────────────────────────────────────────────────────────────

const reset = `*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;overflow:hidden}
body{-webkit-font-smoothing:antialiased;display:flex}`;

// Long titles step down in size so they stay on three lines or fewer.
const titleSize = (title, loud, narrow) => {
  if (loud) return narrow ? 108 : 132;
  const n = title.length;
  if (narrow) return n > 40 ? 54 : n > 22 ? 64 : 80;
  return n > 40 ? 68 : n > 22 ? 84 : 104;
};

function pageCard({ label, title, text, path, art, list, loud }) {
  const side = art || list;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Archivo;src:url(${dataUri('site/static/fonts/archivo-latin.woff2')}) format("woff2");font-weight:100 900;font-stretch:62% 125%}
${reset}
body{font-family:Archivo,sans-serif;background:#e7eaec;color:#16202b}
.copy{flex:1;min-width:0;display:flex;flex-direction:column;padding:56px 56px 52px 64px}
.top{display:flex;align-items:center;gap:16px;font-size:26px;font-weight:650}
.mark{width:44px;height:44px}
.label{margin-left:auto;font-size:20px;font-weight:650;letter-spacing:.14em;text-transform:uppercase;color:#4c5b69}
h1{margin-top:auto;font-size:${titleSize(title, loud, side)}px;font-weight:800;line-height:.98;letter-spacing:-.035em;text-wrap:balance}
h1.loud{margin-left:-.045em;white-space:nowrap}
p{margin-top:24px;font-size:29px;line-height:1.35;color:#4c5b69;max-width:23em;text-wrap:pretty}
.path{margin-top:30px;display:flex;align-items:center;gap:14px;font-size:24px;font-weight:650}
.path i{width:40px;height:8px;background:#ffcf0d}
.side{flex:none;width:430px;background:#16202b;color:#e7eaec;position:relative}
.side img{width:100%;height:100%;object-fit:cover;display:block}
/* The article's diagram sits mid-frame in a 16:9 poster: show just that part. */
.side.poster{width:540px;background:#0d1117 var(--art) -339px 74px / 1103px auto no-repeat}
ol{list-style:none;padding:60px 44px;display:flex;flex-direction:column;justify-content:center;height:100%}
li{padding:17px 0;border-top:1px solid rgba(231,234,236,.18);font-size:27px;font-weight:650;display:flex;gap:18px}
li:first-child{border-top:0}
li span{color:#ffcf0d;font-variant-numeric:tabular-nums}
</style>
<div class="copy">
  <div class="top">
    <svg class="mark" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#ffcf0d"/><path d="M8 23V9l8 9 8-9v14" fill="none" stroke="#16202b" stroke-width="3.4" stroke-linecap="square"/></svg>
    <span>Rami Mouro</span><span class="label">${esc(label)}</span>
  </div>
  <h1 class="${loud ? 'loud' : ''}">${esc(title)}</h1>
  <p>${esc(text)}</p>
  <div class="path"><i></i>${esc(path)}</div>
</div>
${art === POSTER ? `<div class="side poster" style="--art:url(${dataUri(art)})"></div>` : ''}
${art && art !== POSTER ? `<div class="side"><img src="${dataUri(art)}"></div>` : ''}
${list ? `<div class="side"><ol>${list.map((x, i) => `<li><span>0${i + 1}</span>${esc(x)}</li>`).join('')}</ol></div>` : ''}`;
}

function gameCard({ title, text, tags = [], path, a, b, ink, icon, icons }) {
  return `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet">
<style>
${reset}
body{font-family:"DM Sans",sans-serif;color:#f5f0e1;align-items:stretch;
  background:radial-gradient(900px 520px at 100% 0%,rgba(255,255,255,.12),transparent 70%),linear-gradient(145deg,${a},${b})}
.copy{flex:1;min-width:0;display:flex;flex-direction:column;padding:56px 24px 52px 64px}
.top{display:flex;align-items:center;gap:14px;font-family:Fredoka,sans-serif;font-weight:600;font-size:28px}
.top img{width:46px;height:46px;border-radius:12px;box-shadow:0 6px 16px rgba(0,0,0,.35)}
h1{margin-top:auto;font-family:Fredoka,sans-serif;font-weight:700;font-size:${title.length > 12 ? 84 : 100}px;line-height:1.02;letter-spacing:-.01em}
p{margin-top:20px;font-size:29px;line-height:1.38;color:rgba(245,240,225,.82);max-width:21em;text-wrap:pretty}
.tags{margin-top:26px;display:flex;gap:10px}
.tags span{font-size:21px;font-weight:600;padding:7px 16px;border-radius:999px;background:rgba(0,0,0,.3)}
.path{margin-top:28px;font-size:24px;font-weight:700;color:${ink}}
.side{flex:none;width:470px;display:grid;place-items:center;padding-right:40px}
.side>img{width:360px;height:360px;border-radius:84px;box-shadow:0 14px 0 rgba(0,0,0,.28),0 34px 60px rgba(0,0,0,.4),0 0 0 2px rgba(255,255,255,.12)}
.shelf{display:flex;flex-wrap:wrap;justify-content:center;gap:18px;width:420px}
.shelf img{width:126px;height:126px;border-radius:30px;box-shadow:0 7px 0 rgba(0,0,0,.28),0 16px 28px rgba(0,0,0,.36),0 0 0 1px rgba(255,255,255,.12)}
</style>
<div class="copy">
  <div class="top"><img src="${dataUri('site/games/icons/icon-192.png')}">Mouro Games</div>
  <h1>${esc(title)}</h1>
  <p>${esc(text)}</p>
  ${tags.length ? `<div class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
  <div class="path">${esc(path)}</div>
</div>
<div class="side">${
    icons
      ? `<div class="shelf">${icons.map((i) => `<img src="${dataUri(i)}">`).join('')}</div>`
      : `<img src="${dataUri(icon)}">`
  }</div>`;
}

// The share address for a project: its card in the <head>, then on to the
// write-up. The body is only ever seen with scripts and meta refresh both off.
const projectPage = ({ id, title, text }) => `<!doctype html>
<html lang="en">
<head>
    <!-- Written by scripts/render-share-cards.mjs — edit the list there, not this file. -->
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)} — Rami Mouro</title>
    <meta name="description" content="${esc(text)}">
    <meta property="og:title" content="${esc(title)} — Rami Mouro">
    <meta property="og:description" content="${esc(text)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="https://mouro.ai/projects/${id}/">
    <meta property="og:site_name" content="Rami Mouro">
    <meta property="og:image" content="https://mouro.ai/static/share/${id}.png">
    <meta property="og:image:width" content="${W}">
    <meta property="og:image:height" content="${H}">
    <meta property="og:image:alt" content="${esc(title)}: ${esc(text)}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="canonical" href="https://mouro.ai/projects/#${id}">
    <link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
    <meta http-equiv="refresh" content="0; url=/projects/#${id}">
    <script>location.replace('/projects/#${id}');</script>
</head>
<body>
    <p><a href="/projects/#${id}">${esc(title)}</a> is on the projects page.</p>
</body>
</html>
`;

// ── Render ──────────────────────────────────────────────────────────────────

const jobs = [
  ...pages.map((c) => [c.name, pageCard(c)]),
  ...projects.map((c) => [c.id, pageCard({ ...c, label: 'Project', path: `mouro.ai/projects/${c.id}` })]),
  ...games.map((c) => [c.name, gameCard(c)]),
];

const out = join(repo, 'site/static/share');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [name, html] of jobs) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`✓ static/share/${name}.png`);
}
await browser.close();

for (const project of projects) {
  const file = join(repo, 'site/projects', project.id, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, projectPage(project));
  console.log(`✓ projects/${project.id}/index.html`);
}
