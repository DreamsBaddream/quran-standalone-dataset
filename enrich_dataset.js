#!/usr/bin/env node
/**
 * enrich_dataset.js
 *
 * Adds ruku number and group boundaries to every verse in the dataset.
 * Re-fetches all verses from the API (ruku_number field only, no translations = faster).
 *
 * Adds to each entry:
 *   ruku        — global ruku number (1–558)
 *   group_start — first verse key of this ruku  (same as key if standalone)
 *   group_end   — last verse key of this ruku   (same as key if standalone)
 *
 * Usage:
 *   QURAN_CLIENT_ID=<id> QURAN_CLIENT_SECRET=<secret> node enrich_dataset.js
 */

import { readFileSync, writeFileSync } from 'fs';

const CLIENT_ID     = process.env.QURAN_CLIENT_ID;
const CLIENT_SECRET = process.env.QURAN_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: QURAN_CLIENT_ID and QURAN_CLIENT_SECRET must be set.');
  process.exit(1);
}

const AUTH_URL = 'https://oauth2.quran.foundation/oauth2/token';
const BASE_URL = 'https://apis.quran.foundation/content/api/v4';
const DELAY_MS = 200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getToken() {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=content',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token');
  return data.access_token;
}

async function fetchChapter(token, chapter, page = 1) {
  await sleep(DELAY_MS);
  const res = await fetch(
    `${BASE_URL}/verses/by_chapter/${chapter}?fields=ruku_number&per_page=50&page=${page}`,
    { headers: { 'x-auth-token': token, 'x-client-id': CLIENT_ID } }
  );
  return res.json();
}

async function main() {
  console.error('Authenticating…');
  const token = await getToken();

  // ── Fetch ruku_number for every verse ─────────────────────────────────────
  // Map: verse_key → ruku_number
  const rukuMap = new Map();

  for (let chapter = 1; chapter <= 114; chapter++) {
    process.stderr.write(`Chapter ${String(chapter).padStart(3)} / 114…`);
    let page = 1;
    while (true) {
      const data  = await fetchChapter(token, chapter, page);
      const batch = data.verses || [];
      for (const v of batch) rukuMap.set(v.verse_key, v.ruku_number);
      const meta = data.pagination || data.meta;
      if (!meta || page >= (meta.total_pages ?? 1)) break;
      page++;
    }
    process.stderr.write(` done\n`);
  }

  console.error(`\nFetched ruku numbers for ${rukuMap.size} verses.`);

  // ── Build ruku → {first, last} verse key map ───────────────────────────────
  // Verses come in order so first/last are naturally correct
  const rukuBounds = new Map(); // ruku_number → { first, last }

  // Iterate in Quran order (map preserves insertion order from our loop)
  for (const [key, ruku] of rukuMap) {
    if (!rukuBounds.has(ruku)) rukuBounds.set(ruku, { first: key, last: key });
    else rukuBounds.get(ruku).last = key;
  }

  console.error(`Found ${rukuBounds.size} unique rukus.`);

  // ── Enrich the dataset ─────────────────────────────────────────────────────
  const dataset = JSON.parse(readFileSync('dataset/standalone_ayahs.json', 'utf8'));

  let enriched = 0;
  for (const entry of dataset.verses) {
    const ruku = rukuMap.get(entry.key);
    if (ruku === undefined) {
      console.error(`Warning: ruku not found for ${entry.key}`);
      continue;
    }
    const bounds = rukuBounds.get(ruku);
    entry.ruku        = ruku;
    entry.group_start = bounds.first;
    entry.group_end   = bounds.last;
    enriched++;
  }

  dataset.meta.fields = [
    'key', 'standalone', 'include_previous', 'include_next',
    'confidence', 'method', 'note', 'ruku', 'group_start', 'group_end'
  ];

  writeFileSync('dataset/standalone_ayahs.json', JSON.stringify(dataset, null, 2), 'utf8');
  console.error(`\nEnriched ${enriched} entries. Dataset updated.`);

  // ── Quick sample ──────────────────────────────────────────────────────────
  console.error('\nSample entries:');
  for (const key of ['2:255', '37:28', '1:1', '112:1']) {
    const e = dataset.verses.find(v => v.key === key);
    if (e) console.error(`  ${e.key.padEnd(8)} standalone=${String(e.standalone).padEnd(5)} ruku=${String(e.ruku).padEnd(4)} group=${e.group_start}–${e.group_end}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
