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

# TOEFL 4,264

`toefl-headwords.txt` is an exact-case membership snapshot of Qwerty Learner's
`TOEFL_3_T.json`. `toefl-source.json` pins its commit, original-file and word-list
hashes. This is a community transcription, not an ETS word list; the original
textbook edition is unverified. It is a complete list, not a CET increment.
Source translations and pronunciation fields are not imported from that list.

Preparation uses the local ECDICT snapshot for legacy Chinese summaries and local
Kaikki for all matching English entries, gloss-bearing senses (even without
examples), explicitly marked examples, sense translations and IPA candidates.
`toefl-reviewed-definitions.json` supplies reviewed Chinese paraphrases where
exact-case ECDICT entries were missing or had clearly unsuitable learning summaries. Each prepared plan records dictionary
hashes and definition origin. The adjacent raw Kaikki JSON retains full source
records, including quotations, relationships and etymologies omitted from the
compatibility display projection. Preserve this artifact and attribution/share-
alike information if exporting the dictionary data. Missing verified UK IPA stays
blank; raw candidates remain available for review. Existing words and their
pronunciations/definitions are preserved. Existing sense rows are also preserved;
only words with no senses receive the new projection.

```sh
python3 server/scripts/prepare-toefl.py --db /absolute/database.db \
  --output server/scripts/data/toefl/plan.json
# Back up the database and apply the additive Prisma schema before importing.
DATABASE_URL=file:/absolute/database.db node server/node_modules/prisma/build/index.js \
  db push --schema server/prisma/schema.prisma --skip-generate
python3 server/scripts/import-toefl.py --db /absolute/database.db \
  --plan server/scripts/data/toefl/plan.json \
  --report server/scripts/data/toefl/dry-run.json
# Add --apply to write in one transaction; rerunning is idempotent.
```

Run Python CLIs on the host (the application image does not require Python).
Review the plan before applying. Entity-key conflicts caused by older imports
lowercasing proper names are explicitly planned: keep the existing entity ID and
restore its actual spelling in the key before creating the distinct lowercase
word. Conflicts that cannot be resolved by this rule fail the import. A stale
existing word also fails the import instead of overwriting it. Preparation does
not write the database; application never creates cards, review logs or personal
learning states. The TOEFL tab uses the shared deck and existing progress. Its
“补建本级” action can create the missing cards separately.

Checks:

```sh
python3 server/scripts/tests/toefl.py
python3 server/scripts/tests/verify-toefl-import.py --before /snapshot.db \
  --after /imported.db --plan server/scripts/data/toefl/plan.json \
  --report server/scripts/data/toefl/verification.json
```

The old `import-kaikki-examples.js` is restricted to legacy senses and skips
words with sourced sense data, so it cannot erase the new import on a later run.

# Japanese N5

`japanese-n5-source.json` and `japanese-n5-membership.json` pin 674 OpenJLPT N5
candidates, their stable IDs and readings. Levels are community approximations,
not an official JLPT vocabulary specification. The snapshots include dictionary
hashes and upstream attribution links. English data files are never reused as
Japanese dictionaries.

The importer uses a separate `ja:openjlpt:<stable-id>` lexical identity. JMdict
writing/reading restrictions are retained in `readings` and `spellings`, while
`source_metadata` retains the complete matching JMdict entry, original OpenJLPT
row, a matched Kaikki entry where available and source revisions. The full
Chinese candidate sets are retained in the prepared plan. Same spelling in another language,
and different readings of the same spelling, do not share memory state. Different
teaching entries such as 早い/速い remain explicit source entries rather than being
merged automatically by romanization or a shared JMdict ID.

343 Chinese learning summaries are explicitly reviewed in
`japanese-n5-reviewed.json`. They are Chinese paraphrases checked against the
applicable English JMdict senses, not claimed to be JMdict Chinese translations.
Kaikki Chinese entries are candidates: matching writing, reading and POS alone
cannot reliably establish meaning. Unreviewed, missing, ambiguous or invalid
mappings remain `pending` and cannot be selected by automatic card creation.
The current 331 pending entries have readable English references stored but no
cards. Their review queue is written beside the plan. One detected source problem
is せっけん linked to the economy/thrift entry instead of soap.

The initial import creates a separate Japanese deck and 343 reviewed cards.
Existing English words gain only language/identity metadata; no old card, state,
review log, definition or pronunciation is rewritten. The English headword's old
unique index is replaced by a unique lexical key and a language/headword index.
`migrate-word-languages.js` fills missing English keys after `prisma db push`;
the entrypoint also runs this idempotent migration. Old English imports and
pronunciation maintenance are scoped to `en`.

```sh
python3 server/scripts/fetch-japanese.py --data server/scripts/data/japanese-n5
python3 server/scripts/prepare-japanese.py --data server/scripts/data/japanese-n5 \
  --output server/scripts/data/japanese-n5/plan.json
# Back up the target database before migrating the Prisma schema.
DATABASE_URL=file:/absolute/database.db node server/node_modules/prisma/build/index.js \
  db push --schema server/prisma/schema.prisma --skip-generate
DATABASE_URL=file:/absolute/database.db node server/scripts/migrate-word-languages.js
python3 server/scripts/import-japanese.py --db /absolute/database.db \
  --plan server/scripts/data/japanese-n5/plan.json \
  --report server/scripts/data/japanese-n5/dry-run.json --cards
# Add --apply after reviewing the plan. Without --cards only the deck/words are imported.
```

Fetching verifies the pinned hashes and fails if upstream has changed. The large
Chinese Wiktionary dump is streamed from gzip; only Japanese records are written
uncompressed. Retain the plan and dictionary snapshots for attribution and audit.
A new dictionary version or reviewed correction requires preparing and reviewing
an explicit migration; the importer deliberately refuses to overwrite changed
existing Japanese entries. It is not a general-purpose dictionary updater.

Japanese backs contain kana, Japanese POS labels and Chinese summaries, without
IPA slashes or an English accent label. Romanization is optional on reveal.
Search supports kana, aliases and romanization. Tatoeba examples retain sentence
IDs and source links; English translations are labelled as references. Audio,
pitch-accent validation and automatic furigana generation are outside this first
version. Both decks use the existing FSRS engine/settings; their queues and daily
usage are calculated separately by deck.

Checks:

```sh
python3 server/scripts/tests/japanese.py
node --test server/scripts/tests/japanese.cjs
# Integration checks require the prepared plan at data/japanese-n5-2026-10-19/plan.json.
python3 server/scripts/tests/japanese-import.py
python3 server/scripts/tests/verify-japanese-import.py --before /snapshot.db \
  --after /imported.db --plan server/scripts/data/japanese-n5/plan.json \
  --report server/scripts/data/japanese-n5/verification.json
```
