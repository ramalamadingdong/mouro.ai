#!/usr/bin/env node
// Build site/static/data/frc-docs-index.json, the index behind the docs search
// demo on /projects/, from a checkout of the FIRST Agentic CSA server:
//
//   git clone https://github.com/ramalamadingdong/agentic-csa /tmp/agentic-csa
//   node scripts/build-docs-index.mjs /tmp/agentic-csa
//
// It reads the server's own index files for every plugin its config.json
// enables, tokenizes each page exactly as the server does (the tokenizer is
// shared with the page, site/static/js/docs-search.js) and writes an inverted
// index: per vendor, the pages and, for each term, which pages hold it and how
// often. Re-run it when the server's indexes are rebuilt, and commit the result.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tokenize } from '../site/static/js/docs-search.js';

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/build-docs-index.mjs <path to agentic-csa checkout>');
  process.exit(1);
}
const repo = resolve(import.meta.dirname, '..');
const plugins = join(resolve(source), 'src/wpilib_mcp/plugins');
const config = JSON.parse(readFileSync(join(resolve(source), 'config.json'), 'utf8'));

const NAMES = {
  wpilib: 'WPILib',
  rev: 'REV Robotics',
  ctre: 'CTRE Phoenix',
  redux: 'Redux Robotics',
  photonvision: 'PhotonVision',
  yagsl: 'YAGSL',
  yams: 'YAMS',
  advantagekit: 'AdvantageKit',
};

/** A short plain-text excerpt: the page text without markup or its own title. */
function preview(page) {
  let s = page.content
    .replace(/^---\n[\s\S]*?\n---\n/, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\{%[\s\S]*?%\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*:{1,3}[\w-]*.*$/gm, ' ')
    .replace(/\{[a-z-]+\}/g, ' ')
    .replace(/[#*`|>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = page.title.replace(/\s+/g, ' ').trim();
  // Drop the page's own title from the front, unless the index cut the title short mid-word.
  for (let i = 0; i < 2 && s.toLowerCase().startsWith(`${title.toLowerCase()} `); i++) s = s.slice(title.length).trim();
  if (s.length <= 190) return s;
  const cut = s.slice(0, 190);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const vendors = [];
let builtAt = '';
for (const [id, settings] of Object.entries(config.plugins)) {
  if (!settings.enabled) continue;
  const file = join(plugins, id, 'data', settings.versions ? `index_${settings.versions[0]}.json` : 'index.json');
  if (!existsSync(file)) continue;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data.pages?.length) {
    console.warn(`${id}: index is empty, skipped`);
    continue;
  }
  if (data.built_at > builtAt) builtAt = data.built_at;

  const docs = [];
  const terms = Object.create(null);
  data.pages.forEach((page, doc) => {
    const section = page.section ?? 'General';
    const tokens = tokenize(`${page.title} ${section} ${page.content ?? ''}`);
    const counts = new Map();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t, n] of counts) (terms[t] ??= []).push(doc, n);
    docs.push([page.url, page.title, section, preview(page), tokens.length]);
  });
  vendors.push({ id, name: NAMES[id] ?? id, docs, terms });
  console.log(`${id}: ${docs.length} pages, ${Object.keys(terms).length} terms`);
}

const out = join(repo, 'site/static/data/frc-docs-index.json');
mkdirSync(join(repo, 'site/static/data'), { recursive: true });
writeFileSync(out, JSON.stringify({ builtAt: builtAt.slice(0, 10), vendors }));
console.log(`wrote ${out}`);
