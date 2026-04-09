#!/usr/bin/env node
/**
 * review_dataset.js
 *
 * Interactive CLI to review dataset entries and propose corrections.
 * Corrections are written to dataset/pending_corrections.json for PR submission.
 *
 * Usage:
 *   node review_dataset.js              — review random borderline entries
 *   node review_dataset.js --key 2:255  — review a specific verse
 *   node review_dataset.js --surah 12   — review all entries in a surah
 *   node review_dataset.js --fp         — review likely false positives (ruku-first, long surahs)
 *   node review_dataset.js --fn         — review likely false negatives (dependent, no connective)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

// ─── Load data ────────────────────────────────────────────────────────────────

const dataset   = JSON.parse(readFileSync('dataset/standalone_ayahs.json', 'utf8'));
const verseMap  = new Map(dataset.verses.map(v => [v.key, v]));

const pendingPath = 'dataset/pending_corrections.json';
const pending = existsSync(pendingPath)
  ? JSON.parse(readFileSync(pendingPath, 'utf8'))
  : [];
const pendingMap = new Map(pending.map(p => [p.key, p]));

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args[0] || '--fp';

let candidates = [];

if (mode === '--key') {
  const key = args[1];
  if (!verseMap.has(key)) { console.error(`Verse ${key} not found.`); process.exit(1); }
  candidates = [verseMap.get(key)];

} else if (mode === '--surah') {
  const ch = parseInt(args[1], 10);
  candidates = dataset.verses.filter(v => parseInt(v.key.split(':')[0], 10) === ch);

} else if (mode === '--fp') {
  // Likely false positives: standalone=true, method=algorithmic, long/mid surahs (1-77)
  candidates = dataset.verses.filter(v => {
    const ch = parseInt(v.key.split(':')[0], 10);
    return v.standalone && v.method !== 'manual' && ch <= 77;
  });
  shuffle(candidates);

} else if (mode === '--fn') {
  // Likely false negatives: standalone=false, method=algorithmic, no connective note
  candidates = dataset.verses.filter(v => {
    return !v.standalone && v.method !== 'manual' &&
           !v.note.includes('Connective');
  });
  shuffle(candidates);

} else {
  // Default: random sample of all entries
  candidates = [...dataset.verses];
  shuffle(candidates);
}

// ─── Load translations for display ───────────────────────────────────────────
// We re-read from the dataset which stores the note but not the translation.
// We'll just show the note + classification; the reviewer can look up the verse.

// ─── Review loop ─────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function displayVerse(v) {
  console.log('\n' + '─'.repeat(60));
  console.log(`Verse:      ${v.key}`);
  console.log(`Standalone: ${v.standalone ? '✅ YES' : '❌ NO'}`);
  console.log(`Confidence: ${v.confidence}`);
  console.log(`Method:     ${v.method}`);
  console.log(`Note:       ${v.note || '(none)'}`);
  if (pendingMap.has(v.key)) {
    const p = pendingMap.get(v.key);
    console.log(`\n⚠️  Already has pending correction: standalone=${p.standalone} — "${p.note}"`);
  }
  console.log('\nLook up the verse: https://quran.com/' + v.key.replace(':', '/'));
  console.log('─'.repeat(60));
}

async function runReview() {
  console.log(`\nReview mode: ${mode}`);
  console.log(`Candidates: ${candidates.length} verses`);
  console.log('Commands: [y] correct  [n] wrong — flip it  [s] wrong — set note  [q] quit  [Enter] skip\n');

  let reviewed = 0;
  let changed  = 0;

  for (const v of candidates) {
    displayVerse(v);

    const answer = (await ask('Correct? [y/n/s/q/Enter] ')).trim().toLowerCase();

    if (answer === 'q') break;
    if (answer === '' || answer === 'y') { reviewed++; continue; }

    let newStandalone = !v.standalone;
    let note = v.note;

    if (answer === 's') {
      const flip = (await ask(`Flip to standalone=${newStandalone}? [y/n] `)).trim().toLowerCase();
      if (flip !== 'y') newStandalone = v.standalone; // keep current, just update note
      note = (await ask('Correction note: ')).trim();
    } else {
      note = (await ask('Reason (optional, Enter to skip): ')).trim() || `Manually reviewed — should be standalone=${newStandalone}`;
    }

    const correction = {
      key:        v.key,
      standalone: newStandalone,
      confidence: 'manual',
      note,
      reviewed_by: 'reviewer', // GitHub username would go here
    };

    pendingMap.set(v.key, correction);
    changed++;
    reviewed++;
    console.log(`  → Correction queued: ${v.key} standalone=${newStandalone}`);
  }

  rl.close();

  // Save pending corrections
  const updated = [...pendingMap.values()];
  writeFileSync(pendingPath, JSON.stringify(updated, null, 2), 'utf8');

  console.log(`\nReviewed: ${reviewed}  |  Corrections queued: ${changed}`);
  console.log(`Saved to: ${pendingPath}`);
  console.log('\nTo submit: open a PR adding your entries to dataset/manual_overrides.json');
}

runReview().catch(err => { console.error(err); process.exit(1); });
