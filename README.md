# Quran Standalone Ayah Dataset

A public dataset classifying all 6,236 Quranic verses as **standalone** (safe to display without surrounding context) or **context-dependent** (needs neighbouring verses to make sense).

Built for "Ayah of the Day" bots and apps that pick random verses — so they never post a mid-story verse that confuses readers.

**[→ Review verses online](https://dreamsbaddream.github.io/quran-standalone-dataset)**

---

## Dataset

`dataset/standalone_ayahs.json` — 6,236 entries:

```json
{
  "key": "2:255",
  "standalone": true,
  "include_previous": false,
  "include_next": false,
  "confidence": "high",
  "method": "manual",
  "note": "Ayatul Kursi — universally known standalone verse"
}
```

| Field | Description |
|---|---|
| `key` | Surah:Ayah (e.g. `2:255`) |
| `standalone` | `true` = safe to post alone |
| `confidence` | `high` / `medium` |
| `method` | `algorithmic` or `manual` |
| `note` | Reason for classification |

**Current stats:** 1,079 standalone · 5,157 dependent · 16 manual overrides

---

## How it was built

Three-layer algorithm using the [Quran Foundation API](https://quran.foundation):

1. **Ruku-first check** — first verse of a ruku is likely standalone
2. **Connective filter** — translation starts with "Then he…", "So they…", etc. → dependent
3. **Surah bias** — surahs 78–114 are almost always standalone

Accuracy estimate: ~88–92%. Not perfect — this is why community review exists.

---

## How to help (no coding needed)

Visit **[the review page](https://dreamsbaddream.github.io/quran-standalone-dataset)**, go through verses one by one, and click **"This is wrong — report it"** if you spot an error.

You'll need a free [GitHub account](https://github.com/signup) to submit a report.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more ways to help.

---

## License

Dataset: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain, use freely.  
Code: MIT
