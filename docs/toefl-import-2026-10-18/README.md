# TOEFL import — 2026-10-18

The TOEFL tab now exposes 4,264 exact-case headwords through the existing shared
English deck. This is a community word list, not an ETS official list or a
verified textbook edition. Its fixed source commit is
`e889a3879cc276fb40bf00a7252c8c32458b95dd`; see
[the source manifest](../../server/scripts/resources/toefl-source.json).

## Applied changes

| Item | Result |
| --- | ---: |
| Existing words reused without editing | 3,918 |
| New words | 346 |
| TOEFL membership tags | 4,264 |
| Words receiving missing Kaikki senses | 1,485 |
| New gloss-bearing senses | 7,054 |
| New pronunciation candidate records | 955 |
| New words with accepted learner-style UK IPA | 140 |
| New words without accepted UK IPA (left blank) | 206 |
| Reviewed Chinese learning summaries | 17 |
| Existing entity keys corrected for case | 6 |
| Automatically created cards | 0 |

Of the target words, 3,077 already have studied cards and retain their progress.
The TOEFL “补建本级” button can add the remaining 1,187 cards. That operation was
tested against the preview database and was not performed on production.

All Kaikki records matching target words with missing senses were read, rather
than stopping at the first part of speech. Senses without examples were retained;
quotations were excluded from the ordinary example list. Original records remain
in the local import artifact. Rare/archaic senses are stored after other senses;
this is a conservative display preference, not a frequency claim. Legacy sense
data was preserved. Imported senses store their source, revision, part of speech,
tags and stable keys. Dictionary summaries use guarded ECDICT data plus 17
explicit Chinese paraphrases reviewed against Kaikki, including corrections to
`Jupiter`, `mime`, `officious` and lowercase `catholic`/`democrat`.

Six old entities used lowercase keys for `Polish`, `Congress`, `Supreme`,
`Catholic`, `Senate` and `Democrat`. Only their keys were restored to the actual
spelling; their IDs, summaries, existing cards and personal states were preserved.
Distinct lowercase entries were then created without transferring memory state.

## Validation and local artifacts

- Server typecheck/build and web build passed; 14 focused tests passed.
- Repeated import produced zero changes; conflict tests verified atomic rollback.
- Full table/field comparison preserved all 9,064 cards, 128,488 review logs,
  18,322 personal knowledge states, FSRS parameters, settings and existing words.
- Database integrity and foreign-key checks passed. The definition-reference
  audit found no reference-only/form-only/placeholder summaries.
- Live TOEFL tag/coverage endpoints and deployed web bundle were verified.

Ignored local artifacts under `server/scripts/data/toefl-2026-10-18/` retain the
source snapshot, complete plan, raw Kaikki records, production apply/repeat logs
and full verification report. A consistent pre-change database backup is at
`server/data-backup/flashnext-pre-toefl-20261018.db`. Neither these datasets nor the
backup belongs in Git. Operational instructions are in
[the resource README](../../server/scripts/resources/README.md#toefl-4264).
