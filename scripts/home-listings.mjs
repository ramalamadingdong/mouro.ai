#!/usr/bin/env node
// Home Price Guess (site/games/road-trip/homes/): turn a folder of saved
// Zillow for-sale searches into the small listings file the game shows after
// each answer — a few homes from the low, middle and high end of each town.
//
//   node scripts/home-listings.mjs <folder of search results> [YYYY-MM-DD]
//
// Each input file is one search result as JSON ({results: [{result: {...}}],
// resultCounts}), one town per file, saved from Zillow's property search (in my
// case, the Zillow connector in a Claude session). Only the town that most of
// the listings belong to is kept. The raw files are not committed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dir, asOf = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!dir) { console.error('Usage: node scripts/home-listings.mjs <folder> [YYYY-MM-DD]'); process.exit(1); }
const out = resolve(import.meta.dirname, '..', 'site/games/road-trip/homes/data/listings.json');

const HOMES = new Set(['singleFamily', 'townhome', 'condo', 'manufactured', 'multiFamily', 'apartment']);
const towns = {};
for (const file of readdirSync(dir).filter((f) => /\.(json|txt)$/.test(f)).sort()) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const all = (data.results || []).map((r) => r.result || r).filter(Boolean);
  const count = {};
  for (const h of all) { const c = h.formattedAddress?.city; if (c) count[c] = (count[c] || 0) + 1; }
  const town = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!town) continue;
  const state = all.find((h) => h.formattedAddress?.stateOrProvince)?.formattedAddress.stateOrProvince || 'CO';
  let homes = all
    .filter((h) => h.formattedAddress?.city === town && HOMES.has(h.homeType) && h.price?.filteredPrice > 0)
    .map((h) => {
      const url = new URL(h.homeDetailsPageUrl); url.search = '';
      return {
        a: h.formattedAddress.line1, z: h.formattedAddress.postalCode, p: h.price.filteredPrice,
        bd: h.bedroomCount ?? null, ba: h.bathroomCount ?? null, sf: h.livingAreaSquareFeet ?? null,
        t: h.homeType, u: url.href,
      };
    })
    .sort((a, b) => a.p - b.p);
  // Drop asking prices far below the town's middle: mostly parking spaces,
  // mobile homes on rented lots and mistyped listings.
  const mid = homes[Math.floor(homes.length / 2)]?.p || 0;
  homes = homes.filter((h) => h.p >= mid * 0.15);
  if (homes.length < 9) { console.warn(`${town}: only ${homes.length} homes, skipped`); continue; }
  // Thirds by price; two examples from each, from the middle of the third so
  // the very cheapest and dearest outliers aren't the ones shown.
  const third = (k) => homes.slice(Math.floor(homes.length * k / 3), Math.floor(homes.length * (k + 1) / 3));
  const pick = (list) => [list[Math.floor(list.length * 0.3)], list[Math.floor(list.length * 0.7)]];
  const tiers = [0, 1, 2].map((k) => { const l = third(k); return { from: l[0].p, to: l.at(-1).p, homes: pick(l) }; });
  towns[`${town}, ${state}`] = {
    forSale: data.resultCounts?.totalMatchingCount ?? homes.length,
    sample: homes.length,
    median: homes[Math.floor(homes.length / 2)].p,
    tiers,
  };
}
writeFileSync(out, JSON.stringify({ asOf, source: 'Zillow for-sale listings', towns }) + '\n');
console.log(`Wrote ${Object.keys(towns).length} towns to ${out}`);
for (const [k, v] of Object.entries(towns)) console.log(k, v.forSale, v.sample, v.median, v.tiers.map((t) => `${t.from}-${t.to}`).join(' | '));
