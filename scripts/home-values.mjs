#!/usr/bin/env node
// Home Price Guess (site/games/road-trip/homes/): turn Zillow's public Home
// Value Index into one small file per state, so the game can look up the
// typical home value of whatever town the car is in without asking anyone.
//
//   node scripts/home-values.mjs            # downloads the latest CSVs
//   node scripts/home-values.mjs city.csv county.csv
//
// ZHVI is Zillow's "typical home value": all homes (single-family and condo),
// middle tier (35th–65th percentile), smoothed and seasonally adjusted. Zillow
// publishes it monthly at https://www.zillow.com/research/data/ and lets it be
// used with attribution. Re-run this when a new month is out and commit the
// result; nothing in the build or deploy depends on it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const out = join(repo, 'site/games/road-trip/homes/data/values');
const BASE = 'https://files.zillowstatic.com/research/public_csvs/zhvi';
const URLS = [
  `${BASE}/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
  `${BASE}/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
];

async function load(arg, url) {
  if (arg) return readFileSync(arg, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

// Plain CSV with quoted fields ("Denver-Aurora-Centennial, CO").
function rows(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = (line) => {
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const head = split(lines[0]);
  return { head, body: lines.slice(1).map(split) };
}

// The newest value, or the newest within the last year if a town skipped a month.
function latest(head, row) {
  const first = head.findIndex((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  for (let i = head.length - 1; i >= Math.max(first, head.length - 12); i--) {
    const v = parseFloat(row[i]);
    if (v > 0) return { value: Math.round(v), month: head[i].slice(0, 7) };
  }
  return null;
}

const [city, county] = await Promise.all([load(process.argv[2], URLS[0]), load(process.argv[3], URLS[1])]);
const states = {};
let month = '';
const add = (kind, text) => {
  const { head, body } = rows(text);
  const col = (n) => head.indexOf(n);
  const [name, st] = [col('RegionName'), col('State')];
  month = head.at(-1).slice(0, 7);
  for (const row of body) {
    const v = latest(head, row);
    if (!v || !row[st]) continue;
    const s = (states[row[st]] ??= { month, towns: {}, counties: {} });
    // Same name twice in a state (rare): keep the bigger place, which comes first.
    s[kind][row[name]] ??= v.value;
  }
};
add('towns', city);
add('counties', county);

mkdirSync(out, { recursive: true });
let n = 0;
for (const [st, data] of Object.entries(states)) {
  if (!/^[A-Z]{2}$/.test(st)) continue;
  writeFileSync(join(out, `${st}.json`), JSON.stringify({ month, ...data }) + '\n');
  n += Object.keys(data.towns).length;
}
console.log(`Wrote ${Object.keys(states).length} states, ${n} towns, ZHVI for ${month}.`);
