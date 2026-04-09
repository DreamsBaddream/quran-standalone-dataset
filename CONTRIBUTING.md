# Contributing

There are two ways to help improve this dataset:

---

## Option A — Vote on the review page (no account needed)

Visit **[the review page](https://dreamsbaddream.github.io/quran-standalone-dataset)**, go through verses, and click **"🚩 This is wrong"** if you spot an error. A short form will open — no account required, just submit and you're done.

Votes are reviewed periodically and accepted corrections are applied to `manual_overrides.json`.

---

## Option B — Submit a Pull Request

Edit [`dataset/manual_overrides.json`](dataset/manual_overrides.json) directly and open a PR.

Each entry looks like this:

```json
{
  "key": "2:255",
  "standalone": true,
  "confidence": "high",
  "note": "Ayatul Kursi — universally known standalone verse"
}
```

**Fields:**
| Field | Values | Notes |
|---|---|---|
| `key` | `"surah:ayah"` | e.g. `"2:255"` |
| `standalone` | `true` or `false` | Is this verse safe to post without surrounding context? |
| `confidence` | `"high"` or `"medium"` | How certain are you? |
| `note` | string | Brief reason — shown in the dataset |

**Rules:**
- One entry per verse
- If the verse is already in `manual_overrides.json`, update the existing entry rather than adding a duplicate
- `confidence: "high"` = you're certain; `confidence: "medium"` = you believe so but it's debatable
- Keep notes concise (one sentence)

---

## What makes a verse standalone?

A verse is **standalone** if a reader with no surrounding context would understand its meaning and it stands as a complete thought.

**Good candidates for standalone=true:**
- A declaration, command, or promise from Allah that needs no narrative setup
- A verse commonly quoted alone in khutbahs, reminders, or social media
- The opening verse of a surah or section

**Should stay standalone=false:**
- Continues a story mid-sentence ("He said...", "Then they...", "So We...")
- References a "them/him/her" from the previous verse
- Part of a legal ruling that requires the preceding condition to make sense

---

## Running the review tool locally

```bash
# Review likely false positives (standalone=true in long surahs — might need context)
node review_dataset.js --fp

# Review likely false negatives (standalone=false, no connective opener — might be OK alone)
node review_dataset.js --fn

# Review a specific verse
node review_dataset.js --key 2:255

# Review all verses in a surah
node review_dataset.js --surah 12
```

Corrections are saved to `dataset/pending_corrections.json`. Copy relevant entries into `dataset/manual_overrides.json` and open a PR.
