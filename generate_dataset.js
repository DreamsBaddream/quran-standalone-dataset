#!/usr/bin/env node
/**
 * generate_dataset.js
 *
 * Fetches all 6,236 Quran verses from the Quran Foundation API and classifies
 * each as standalone or context-dependent using three layered checks:
 *   1. Ruku-first check  — first verse of a ruku is likely standalone
 *   2. Connective filter — translation starts with a continuative phrase
 *   3. Surah bias        — short surahs (78–114) almost always standalone
 *
 * Usage:
 *   QURAN_CLIENT_ID=<id> QURAN_CLIENT_SECRET=<secret> node generate_dataset.js
 *
 * Output: dataset/standalone_ayahs.json
 *
 * Requirements: Node 18+ (built-in fetch)
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

const CLIENT_ID     = process.env.QURAN_CLIENT_ID;
const CLIENT_SECRET = process.env.QURAN_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: QURAN_CLIENT_ID and QURAN_CLIENT_SECRET must be set.');
  process.exit(1);
}

const AUTH_URL  = 'https://oauth2.quran.foundation/oauth2/token';
const BASE_URL  = 'https://apis.quran.foundation/content/api/v4';
const PER_PAGE  = 50;
const DELAY_MS  = 300; // between API calls to avoid rate limiting
const TRANSLATION_ID = 20; // Saheeh International

// ─── Connective phrases that indicate context-dependence ─────────────────────
// "And" alone is NOT flagged — too common in Saheeh International (~40-50%)
// "And [he/she/they/it...]" IS flagged — bracket pronoun signals mid-narrative
const CONNECTIVE_PREFIXES = [
  'And [he',  'And [she',  'And [they', 'And [it',
  'And [We',  'And [your', 'And [his',  'And [her',
  'And [their','And [our',
  'But ',
  'So he',   'So she',    'So they',   'So it',    'So We',
  'So ',
  'Then he', 'Then she',  'Then they', 'Then it',  'Then We',
  'Then ',
  'He said', 'She said',  'They said', 'It said',
];

// ─── Surah verse counts (for reference / validation) ─────────────────────────
const TOTAL_CHAPTERS = 114;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getToken() {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=content',
  });

  if (!res.ok) {
    throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in auth response');
  return data.access_token;
}

async function fetchPage(token, chapterNum, page) {
  const url =
    `${BASE_URL}/verses/by_chapter/${chapterNum}` +
    `?fields=text_uthmani,translations,ruku_number` +
    `&translations=${TRANSLATION_ID}` +
    `&per_page=${PER_PAGE}` +
    `&page=${page}`;

  const res = await fetch(url, {
    headers: {
      'x-auth-token': token,
      'x-client-id': CLIENT_ID,
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed (chapter ${chapterNum} page ${page}): ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/** Fetch every verse in a chapter, handling pagination automatically. */
async function fetchAllVersesInChapter(token, chapterNum) {
  const verses = [];
  let page = 1;

  while (true) {
    await sleep(DELAY_MS);
    const data = await fetchPage(token, chapterNum, page);
    const batch = data.verses || [];
    verses.push(...batch);

    const meta = data.pagination || data.meta;
    if (!meta || page >= (meta.total_pages ?? 1)) break;
    page++;
  }

  return verses;
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Returns { standalone, confidence, note } for a single verse.
 *
 * @param {object} verse          - verse object from API
 * @param {boolean} isRukuFirst   - true if first verse of its ruku
 */
function classifyVerse(verse, isRukuFirst) {
  const key          = verse.verse_key;
  const chapterNum   = parseInt(key.split(':')[0], 10);
  const rawTranslation = verse.translations?.[0]?.text ?? '';

  // Strip HTML tags Saheeh International sometimes includes
  const cleanedHtml = rawTranslation.replace(/<[^>]+>/g, '');

  // Brackets at the START are a GOOD sign — Saheeh added clarification = self-contained
  const startsWithBracket = /^\s*\[/.test(cleanedHtml);

  // Strip leading bracket phrase to expose the actual first word for connective check
  const withoutLeadBracket = cleanedHtml.replace(/^\s*\[.*?\]\s*/, '').trim();

  // Surah bias: surahs 78–114 are almost always standalone
  const isShortSurah = chapterNum >= 78;
  // Surahs 36–77: mostly ok at ruku-first
  const isMidSurah   = chapterNum >= 36 && chapterNum < 78;

  // ── Check 1: connective prefix ───────────────────────────────────────────
  // Apply to the text AFTER stripping leading brackets (if any)
  const textToCheck = startsWithBracket ? withoutLeadBracket : cleanedHtml.trim();
  const connective  = CONNECTIVE_PREFIXES.some(p => textToCheck.startsWith(p));

  // ── Classification logic ─────────────────────────────────────────────────

  // Hard block: connective AND not a bracket-opener AND not a short surah
  if (connective && !startsWithBracket && !isShortSurah) {
    return {
      standalone: false,
      confidence: 'high',
      note: `Connective opener: "${textToCheck.slice(0, 40)}"`,
    };
  }

  // Soft block: connective in mid-narrative surah (36-77), even if ruku-first
  if (connective && !startsWithBracket && isMidSurah) {
    return {
      standalone: false,
      confidence: 'medium',
      note: `Connective opener in mid surah: "${textToCheck.slice(0, 40)}"`,
    };
  }

  // Ruku-first is a positive signal
  if (isRukuFirst) {
    if (connective && !startsWithBracket) {
      // Ruku-first but still connective — uncertain
      return {
        standalone: false,
        confidence: 'low',
        note: 'Ruku-first but connective opener',
      };
    }
    // Clean ruku-first
    return {
      standalone: true,
      confidence: isShortSurah ? 'high' : 'medium',
      note: isShortSurah ? 'Ruku-first, short surah' : 'Ruku-first',
    };
  }

  // Not ruku-first
  if (isShortSurah) {
    // Short surahs: even non-ruku-first verses are usually standalone
    return {
      standalone: true,
      confidence: 'medium',
      note: 'Short surah bias (78–114)',
    };
  }

  // Mid/long surah, not ruku-first → likely mid-narrative
  return {
    standalone: false,
    confidence: isMidSurah ? 'medium' : 'high',
    note: 'Not ruku-first, narrative surah',
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.error('Authenticating…');
  const token = await getToken();
  console.error('Token acquired.\n');

  const results   = [];
  let totalVerses = 0;
  let prevRuku    = null;

  for (let chapter = 1; chapter <= TOTAL_CHAPTERS; chapter++) {
    process.stderr.write(`Chapter ${String(chapter).padStart(3, ' ')} / ${TOTAL_CHAPTERS}…`);
    const verses = await fetchAllVersesInChapter(token, chapter);

    for (const verse of verses) {
      const isRukuFirst = verse.ruku_number !== prevRuku;
      prevRuku = verse.ruku_number;

      const { standalone, confidence, note } = classifyVerse(verse, isRukuFirst);

      results.push({
        key:              verse.verse_key,
        standalone,
        include_previous: false,
        include_next:     false,
        confidence,
        method:           'algorithmic',
        note,
      });
    }

    totalVerses += verses.length;
    process.stderr.write(` ${verses.length} verses\n`);
  }

  console.error(`\nTotal verses classified: ${totalVerses}`);

  // ── Apply manual overrides ───────────────────────────────────────────────────
  const overridesPath = join('dataset', 'manual_overrides.json');
  if (existsSync(overridesPath)) {
    const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
    const overrideMap = new Map(overrides.map(o => [o.key, o]));
    let overrideCount = 0;
    for (const entry of results) {
      if (overrideMap.has(entry.key)) {
        const o = overrideMap.get(entry.key);
        const prev = entry.standalone;
        entry.standalone        = o.standalone;
        entry.confidence        = o.confidence;
        entry.note              = o.note;
        entry.method            = 'manual';
        if (prev !== o.standalone) overrideCount++;
      }
    }
    console.error(`Manual overrides applied: ${overrides.length} entries (${overrideCount} changed classification)`);
  }

  // ── Write output ────────────────────────────────────────────────────────────
  mkdirSync('dataset', { recursive: true });
  const outPath = join('dataset', 'standalone_ayahs.json');

  const standaloneCount = results.filter(r => r.standalone).length;
  const output = {
    meta: {
      total:       results.length,
      standalone:  standaloneCount,
      dependent:   results.length - standaloneCount,
      generated:   new Date().toISOString(),
      translation: 'Saheeh International (resource_id 20)',
      method:      'algorithmic-v1 + manual-overrides',
    },
    verses: results,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.error(`\nDataset written to ${outPath}`);

  // Print summary stats
  const byConfidence = {};
  for (const r of results) {
    byConfidence[r.confidence] = (byConfidence[r.confidence] ?? 0) + 1;
  }
  console.error('\nConfidence breakdown:');
  for (const [k, v] of Object.entries(byConfidence)) {
    console.error(`  ${k.padEnd(8)} ${v}`);
  }

  const standalonePct = ((output.meta.standalone / results.length) * 100).toFixed(1);
  console.error(`\nStandalone: ${output.meta.standalone} (${standalonePct}%)`);
  console.error(`Dependent:  ${output.meta.dependent}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
