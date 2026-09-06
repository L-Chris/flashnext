# Cognitive Memory Core

This branch introduces the first backend layer for evolving FlashNext from a flashcard app into a personal cognitive database.

## Goals

- Keep existing Deck / Card / FSRS behavior unchanged.
- Treat flashcards as one optional memory mechanism rather than the primary knowledge model.
- Introduce stable knowledge identities that future domains (math, books, skills, notes) can share.
- Expose agent-friendly vocabulary APIs without leaking raw FSRS internals.

## New models

### Profile

Represents the owner of personal knowledge state. The current single-user product uses profile `id = 1`.

### KnowledgeEntity

A domain-neutral identity layer.

Examples:

- `en:word:derive`
- future: `math:calculus:chain-rule`
- future: `isbn:9780141033570`

`kind` indicates the domain (`word`, later `math_concept`, `book`, etc.). Domain-specific fields remain in their own tables.

### PersonalKnowledgeState

Stores the user's relationship with a knowledge entity.

Current fields:

- `memoryPolicy`: `NONE`, `PERMANENT`, `FSRS`, later `ASSESSMENT`
- `status`: currently projected as `UNKNOWN`, `EXPOSED`, `LEARNING`, `KNOWN`, `MASTERED`
- `confidence`: 0..1 semantic confidence for agent consumption
- evidence timestamps

The current vocabulary implementation projects these semantic states from the existing Card/FSRS state. The FSRS tables remain the source of scheduling truth.

## Word integration

`Word` now has an optional one-to-one `knowledgeEntityId`.

It is nullable intentionally so an existing SQLite database can be upgraded with `prisma db push` without requiring an all-or-nothing data migration.

After upgrading, call:

```http
POST /api/knowledge/sync/words
```

This operation is idempotent. It:

1. creates/updates `KnowledgeEntity(kind=word)` records,
2. links existing `Word` rows,
3. creates/updates `PersonalKnowledgeState` for profile 1,
4. projects the best existing card state into an agent-friendly status.

## APIs

### Profile summary

```http
GET /api/knowledge/profile
```

Returns the default profile plus knowledge/tracking counts.

### Vocabulary check

```http
POST /api/knowledge/vocabulary/check
Content-Type: application/json

{
  "words": ["derive", "mitigate", "ephemeral"]
}
```

Returns semantic status, confidence, memory policy, rank and vocabulary tags for each requested word.

This endpoint is designed for external agents/readers and intentionally does not expose raw FSRS scheduler fields.

### Vocabulary profile

```http
GET /api/knowledge/vocabulary/profile
```

Returns total tracked vocabulary and semantic status counts.

## Deployment

After pulling the branch:

```bash
cd server
npm run prisma:generate
npm run prisma:push
```

Then start the server and run once:

```http
POST /api/knowledge/sync/words
```

Existing Deck/Card/ReviewLog data is preserved.

## Next steps

Recommended next iteration:

1. automatically refresh vocabulary knowledge state after a review instead of only during sync,
2. change WordsView from “card coverage” to semantic knowledge-state coverage,
3. add KnowledgeRelation and math domain models,
4. add Book + ReadingRecord,
5. add explicit read scopes / MCP adapter for external agents.
