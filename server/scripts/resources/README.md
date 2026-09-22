# IELTS repeated-word usages

`ielts-repeated-words.json` restores 86 chapter occurrences for the 43 repeated
headwords identified in `docs/ielts-audit-2026-09-18/`. Each occurrence has its own
chapter, part of speech and meaning; all occurrences still reference the existing
Word and its existing cards. They are deliberately separate from Kaikki's
`word_senses`, so importing Kaikki examples cannot overwrite them.

The source is the pinned third-party transcription linked in the JSON, not a
publisher-verified edition. `editorialNotes` records corrections made during
preparation. No example sentences were copied. The original `ielts.txt` remains
the unique headword list. No new IELTS headwords are introduced by this repair.

After backing up the database and applying the Prisma schema:

```sh
node scripts/import-ielts-usages.js --dry-run
node scripts/import-ielts-usages.js
```

Set `DATABASE_URL` explicitly when importing into a specific database; the script
does not override it with `.env`. Imports validate all 43 mappings before writing,
then upsert the 86 occurrences in one transaction keyed by source + source order.
Rerunning the same dataset is idempotent. The normal `import-ielts.js` also invokes
this importer. A new source version requires an explicit migration decision;
changing the source identifier is not an automatic replacement of older versions.

In the app, expand a card row or reveal a review answer to see chapter usages.
Progress remains word/card based, not independent per chapter usage.
