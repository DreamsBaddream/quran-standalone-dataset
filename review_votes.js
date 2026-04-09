#!/usr/bin/env node
/**
 * review_votes.js
 *
 * Pulls votes from Supabase, finds contested verses, and lets you
 * approve or reject corrections interactively.
 * Accepted corrections are written to dataset/manual_overrides.json
 * and the dataset is updated automatically.
 *
 * Usage: node review_votes.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { createInterface }             from 'readline';
import { execSync }                    from 'child_process';

const SUPABASE_URL = 'https://dvelpmcfzsakdrdvlxwx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZWxwbWNmenNha2RyZHZseHd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjE0NTQsImV4cCI6MjA5MTI5NzQ1NH0.KAdGZMXeI2BrDfj6AMkmM-dSPmGpcAOR-WDzchcPdGI';
const MIN_VOTES    = 3;  // minimum votes needed before a verse shows up for review
const MIN_MAJORITY = 0.6; // 60%+ disagreement = contested

// ─── Fetch all votes from Supabase ───────────────────────────────────────────

async function fetchVotes() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/votes?select=verse_key,vote&limit=10000`, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  return res.json();
}

// ─── Aggregate votes per verse ────────────────────────────────────────────────

function aggregate(votes) {
  const map = new Map();
  for (const { verse_key, vote } of votes) {
    if (!map.has(verse_key)) map.set(verse_key, { standalone: 0, 'needs-context': 0 });
    map.get(verse_key)[vote] = (map.get(verse_key)[vote] ?? 0) + 1;
  }
  return map;
}

// ─── Find contested verses ────────────────────────────────────────────────────

function findContested(voteMap, dataset) {
  const verseMap = new Map(dataset.verses.map(v => [v.key, v]));
  const contested = [];

  for (const [key, counts] of voteMap) {
    const total      = counts.standalone + counts['needs-context'];
    if (total < MIN_VOTES) continue;

    const entry      = verseMap.get(key);
    if (!entry) continue;

    const currentVote   = entry.standalone ? 'standalone' : 'needs-context';
    const oppositeVote  = entry.standalone ? 'needs-context' : 'standalone';
    const disputeCount  = counts[oppositeVote] ?? 0;
    const disputeRatio  = disputeCount / total;

    if (disputeRatio >= MIN_MAJORITY) {
      contested.push({
        key,
        entry,
        counts,
        total,
        disputeCount,
        disputeRatio,
        suggestedStandalone: !entry.standalone,
      });
    }
  }

  // Sort by dispute ratio descending
  return contested.sort((a, b) => b.disputeRatio - a.disputeRatio);
}

// ─── Interactive review ───────────────────────────────────────────────────────

function ask(rl, q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  console.log('\nFetching votes from Supabase…');
  const votes = await fetchVotes();

  if (!Array.isArray(votes) || votes.length === 0) {
    console.log('No votes yet. Share the review page and come back later.');
    process.exit(0);
  }

  console.log(`Total votes: ${votes.length}`);

  const dataset    = JSON.parse(readFileSync('dataset/standalone_ayahs.json',  'utf8'));
  const overrides  = JSON.parse(readFileSync('dataset/manual_overrides.json', 'utf8'));
  const overrideMap = new Map(overrides.map(o => [o.key, o]));

  const voteMap  = aggregate(votes);
  const contested = findContested(voteMap, dataset);

  if (contested.length === 0) {
    console.log(`\nNo contested verses yet (need ${MIN_VOTES}+ votes with ${MIN_MAJORITY * 100}%+ disagreement).`);

    // Still show vote summary
    console.log('\nTop voted verses so far:');
    const sorted = [...voteMap.entries()]
      .sort((a, b) => (b[1].standalone + b[1]['needs-context']) - (a[1].standalone + a[1]['needs-context']))
      .slice(0, 10);
    for (const [key, c] of sorted) {
      const entry = dataset.verses.find(v => v.key === key);
      const current = entry?.standalone ? 'standalone' : 'needs-context';
      console.log(`  ${key.padEnd(8)} standalone=${String(entry?.standalone).padEnd(5)}  ✅ ${c.standalone ?? 0} agree  🚩 ${c['needs-context'] ?? 0} disagree  [current: ${current}]`);
    }
    process.exit(0);
  }

  console.log(`\nContested verses: ${contested.length}`);
  console.log(`(${MIN_VOTES}+ votes, ${MIN_MAJORITY * 100}%+ disagree with current classification)\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let accepted = 0;
  let rejected = 0;

  for (const c of contested) {
    const { key, entry, counts, total, disputeCount, suggestedStandalone } = c;
    const agreeCount = total - disputeCount;

    console.log('─'.repeat(60));
    console.log(`Verse:    ${key}`);
    console.log(`Current:  standalone=${entry.standalone} (${entry.confidence}, ${entry.method})`);
    console.log(`Suggested: standalone=${suggestedStandalone}`);
    console.log(`Votes:    ${agreeCount} agree with current · ${disputeCount} say it should change`);
    console.log(`          (${Math.round(c.disputeRatio * 100)}% want it changed)`);
    console.log(`Note:     ${entry.note || '(none)'}`);
    console.log(`Quran.com: https://quran.com/${key.replace(':', '/')}`);
    console.log('─'.repeat(60));

    const ans = (await ask(rl, 'Apply correction? [y] yes  [n] no  [q] quit: ')).trim().toLowerCase();

    if (ans === 'q') break;

    if (ans === 'y') {
      const note = (await ask(rl, 'Correction note (Enter to use default): ')).trim()
        || `Community correction: ${disputeCount}/${total} votes say standalone=${suggestedStandalone}`;

      overrideMap.set(key, {
        key,
        standalone:  suggestedStandalone,
        confidence:  'high',
        note,
      });
      accepted++;
      console.log(`  ✅ Correction queued for ${key}\n`);
    } else {
      rejected++;
      console.log(`  ⏭  Skipped ${key}\n`);
    }
  }

  rl.close();

  if (accepted === 0) {
    console.log('\nNo corrections accepted. Nothing changed.');
    process.exit(0);
  }

  // ── Write updated overrides ──────────────────────────────────────────────
  const updatedOverrides = [...overrideMap.values()];
  writeFileSync('dataset/manual_overrides.json', JSON.stringify(updatedOverrides, null, 2));

  // ── Re-apply overrides to dataset ────────────────────────────────────────
  let changed = 0;
  for (const entry of dataset.verses) {
    if (overrideMap.has(entry.key)) {
      const o = overrideMap.get(entry.key);
      if (entry.standalone !== o.standalone) changed++;
      entry.standalone = o.standalone;
      entry.confidence = o.confidence;
      entry.note       = o.note;
      entry.method     = 'manual';
    }
  }

  const standaloneCount = dataset.verses.filter(v => v.standalone).length;
  dataset.meta.standalone = standaloneCount;
  dataset.meta.dependent  = dataset.verses.length - standaloneCount;

  writeFileSync('dataset/standalone_ayahs.json', JSON.stringify(dataset, null, 2));

  console.log(`\n${accepted} corrections applied (${changed} changed classification).`);
  console.log('Committing and pushing…');

  execSync('git add dataset/standalone_ayahs.json dataset/manual_overrides.json');
  execSync(`git commit -m "Apply ${accepted} community corrections from vote review"`);
  execSync('git push');

  console.log('Done. Dataset updated on GitHub.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
