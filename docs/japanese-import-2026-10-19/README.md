# Japanese N5 — 2026-10-19

This release adds a separate Japanese deck and a JLPT N5 vocabulary tab. It keeps
674 candidates from OpenJLPT commit `0d1d3410bec90bd4098a7c72de820543cb4f707c`.
343 entries have checked Chinese learning summaries and cards; 331 remain pending
and are excluded from automatic card creation. These are community level labels,
not an official JLPT word list.

## Identity and data

- English words retain all old values and IDs. Their added language is `en`, and
  their lexical key is `en:word:<exact-case headword>`.
- Japanese words use `ja:openjlpt:<stable source ID>`, independent of spelling,
  romanization and the English word namespace. Alternate spellings, kana readings
  and JMdict restrictions are retained; memory states are never copied by spelling.
- Japanese cards show Japanese writing on the front. The back has kana, POS and a
  concise Chinese summary; romanization is optional. No kana is stored as English
  IPA. The existing FSRS engine/settings are reused with separate deck queues.
- Source dictionaries are a pinned JMdict English JSON snapshot and Japanese
  records extracted from the Chinese Wiktionary Kaikki raw dump. The existing
  English Kaikki file is not used for Japanese.

Chinese candidates require review even when writing, reading and POS match. For
example, a direct match for あっち yielded the dialectal first-person meaning “我”
rather than the intended N5 “那边”. Matching 今日 to こんにち or 私 to a noun meaning
“私有物” is also rejected by reading/POS checks. Reviewed summaries are checked
against applicable JMdict English glosses and stored as a separate correction
layer; they are not described as JMdict-provided Chinese translations.

The pending set includes せっけん, which the upstream list linked to economy/thrift
rather than soap. The three writing/reading/entry-ID mismatches are also pending.
No missing or ambiguous summary silently becomes a learning card. The queue and
candidate evidence are retained locally for subsequent review.

## Changes and validation

| Added record | Count |
| --- | ---: |
| Japanese words and knowledge entities | 674 each |
| N5 membership tags | 674 |
| Checked Chinese summary/example records | 343 |
| Japanese deck | 1 |
| Japanese cards | 343 |

Existing English vocabulary statistics exclude Japanese. English dictionary
imports, cleanup, pronunciation preparation and card creation are scoped to `en`.
The legacy single-deck migration refuses to run on a multilingual library.
Japanese card search includes kana, spelling aliases and romanization. Review
undo returns the hydrated word, preserving the Japanese presentation. Tatoeba
example IDs and source links are retained; English example translations are
labelled as references. Audio, pitch accents and generated furigana are not part
of this version.

Validation includes schema migration on a consistent SQLite copy, dry-run,
repeat import, atomic rollback on a mid-import conflict, distinct identities for
the same spelling across languages, frontend/backend answer-template parity,
Japanese grading/undo, kana/romanization search and language-scoped coverage/card
creation. A full table/field comparison verifies that all pre-existing records
are unchanged, including all 10,251 existing English cards, 128,726 review logs, 18,322 personal
states and FSRS parameters. Server/web builds and 25 focused tests passed. The
live Japanese deck, N5 coverage, kana/romanization search and review queue were
also checked after deployment.

Operational instructions and source attribution are in
[the resource README](../../server/scripts/resources/README.md#japanese-n5).
Versioned membership, source metadata and reviewed summaries are under
`server/scripts/resources/japanese-n5-*`. Large source files, complete plans and
verification reports remain ignored under
`server/scripts/data/japanese-n5-2026-10-19/`. The production apply report records
the exact plan hash; `production-verification.json` records before/after counts.
The pre-migration database backup is
`server/data-backup/flashnext-pre-japanese-20261019.db`.
