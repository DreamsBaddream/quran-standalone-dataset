#!/usr/bin/env node
/**
 * validate_dataset.js
 *
 * Spot-checks dataset/standalone_ayahs.json after generation.
 * Prints a sample of borderline/low-confidence entries for manual review.
 *
 * Usage: node validate_dataset.js
 */

import { readFileSync } from 'fs';

const raw  = readFileSync('dataset/standalone_ayahs.json', 'utf8');
const data = JSON.parse(raw);

console.log('=== Dataset Summary ===');
console.log(`Total:      ${data.meta.total}`);
console.log(`Standalone: ${data.meta.standalone}`);
console.log(`Dependent:  ${data.meta.dependent}`);
console.log(`Generated:  ${data.meta.generated}`);
console.log();

// Well-known standalone verses that must be standalone: true
const KNOWN_STANDALONE = [
  '2:255',   // Ayatul Kursi
  '1:1',     // Al-Fatiha
  '112:1',   // Al-Ikhlas
  '36:1',    // Ya-Sin opening
  '55:1',    // Ar-Rahman opening
];

console.log('=== Sanity checks (known standalone verses) ===');
for (const key of KNOWN_STANDALONE) {
  const v = data.verses.find(x => x.key === key);
  if (!v) {
    console.log(`  MISSING: ${key}`);
  } else {
    const mark = v.standalone ? '✅' : '❌ WRONG';
    console.log(`  ${mark}  ${key} — standalone=${v.standalone} (${v.confidence}) ${v.note}`);
  }
}
console.log();

// Well-known context-dependent verses
const KNOWN_DEPENDENT = [
  '2:7',    // "Allah has set a seal upon their hearts..." — continuation of 2:6
  '12:5',   // "He said, O my son..." — narrative mid-story
];

console.log('=== Sanity checks (known dependent verses) ===');
for (const key of KNOWN_DEPENDENT) {
  const v = data.verses.find(x => x.key === key);
  if (!v) {
    console.log(`  MISSING: ${key}`);
  } else {
    const mark = !v.standalone ? '✅' : '⚠️  possibly wrong';
    console.log(`  ${mark}  ${key} — standalone=${v.standalone} (${v.confidence}) ${v.note}`);
  }
}
console.log();

// Low-confidence entries — candidates for community correction
const low = data.verses.filter(v => v.confidence === 'low');
console.log(`=== Low-confidence entries (${low.length}) — need manual review ===`);
for (const v of low.slice(0, 20)) {
  console.log(`  ${v.key.padEnd(8)} standalone=${String(v.standalone).padEnd(5)} ${v.note}`);
}
if (low.length > 20) console.log(`  ... and ${low.length - 20} more`);
console.log();

// Distribution by surah group
const groups = [
  { label: 'Surahs 1–35  (long narrative)', min: 1,  max: 35  },
  { label: 'Surahs 36–77 (mid-length)',     min: 36, max: 77  },
  { label: 'Surahs 78–114 (short)',         min: 78, max: 114 },
];

console.log('=== Standalone % by surah group ===');
for (const g of groups) {
  const group = data.verses.filter(v => {
    const ch = parseInt(v.key.split(':')[0], 10);
    return ch >= g.min && ch <= g.max;
  });
  const sa = group.filter(v => v.standalone).length;
  const pct = group.length ? ((sa / group.length) * 100).toFixed(1) : '0';
  console.log(`  ${g.label.padEnd(36)} ${pct}% (${sa}/${group.length})`);
}
