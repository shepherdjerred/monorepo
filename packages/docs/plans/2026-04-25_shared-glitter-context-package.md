# Shared Glitter-Context Package

## Status

**Not Started.** Tracking the eventual extraction of duplicated friend-group context (style cards + new lore files) into a single workspace package.

## Motivation

Two AI surfaces consume the same "Glitter Boys" context, and content is duplicated across both packages today:

- Per-person style cards: `packages/birmel/src/persona/style-cards/` and `packages/scout-for-lol/packages/data/src/review/prompts/style-cards/`
- Friend-group history: `packages/birmel/src/lore/glitter-boys-history.txt` and `packages/scout-for-lol/packages/data/src/review/prompts/context/glitter-boys-history.txt`
- Relationship graph: `packages/birmel/src/lore/relationships.txt` and `packages/scout-for-lol/packages/data/src/review/prompts/context/relationships.txt`

Verified `jerred_style.json` is byte-for-byte identical between the two style-card directories. Scout has three personas Birmel does not (`caitlyn`, `colin`, `richard`).

Drift risk grows as content evolves — a fix or addition in one package can silently miss the other.

## Proposed shape

New workspace package: `packages/glitter-context/`

```
packages/glitter-context/
├── package.json                # name: @shepherdjerred/glitter-context (or similar)
├── tsconfig.json
├── src/
│   ├── index.ts                # Re-exports everything
│   ├── style-cards/
│   │   ├── *.json              # Canonical style card files
│   │   └── loader.ts           # Zod-validated loader, mirrors birmel/src/persona/style-transform.ts:24-49
│   └── lore/
│       ├── glitter-boys-history.txt
│       ├── relationships.txt
│       └── loader.ts           # Static text exports for synchronous embedding
```

## Migration

1. Create `packages/glitter-context/` with content + loaders.
2. Pick the canonical style-card directory and move there. Reconcile the three personas missing from Birmel (caitlyn/colin/richard) — confirm with the user whether they should appear in Birmel too or stay Scout-only.
3. Update Birmel's `src/persona/style-transform.ts` to import from the shared package instead of reading `src/persona/style-cards/`.
4. Update Birmel's `src/voltagent/agents/system-prompt.ts` to import lore from the shared package.
5. Update Scout's `packages/backend/src/league/review/prompts.ts` (style cards via `STYLECARDS_DIR`) and `packages/data/src/review/pipeline-stages.ts` (lore via the static text imports added 2026-04-25) to import from the shared package.
6. Delete the duplicates in both packages.
7. Verify no consumer outside these two packages reads from the old paths (e.g. the Python `ai_analyze_llm.py` still writes to `packages/scout-for-lol/packages/analysis/llm-out/` — see open question below).

## Open questions

- **Style-card generation.** `packages/scout-for-lol/packages/analysis/ai_analyze_llm.py` is the script that produces style cards from Discord exports. Should it write directly into the shared package, or stay in Scout's `analysis/llm-out/` and be sync'd by a small build step? Direct writes mean the Python tool grows a dependency on the JS package layout; a sync step adds a pre-commit hook / CI check.
- **Three-package threshold.** Today only Birmel and Scout consume this content. If a third surface appears (another AI bot, a frontend that renders the relationship graph, etc.) the value of extraction goes up — until then duplication of two `.txt` files plus ~10 JSON style cards is cheap. Worth waiting for a concrete third consumer rather than building speculatively.
- **Versioning model.** Style cards regenerate when the Python analyzer reruns; lore changes by hand. Should the shared package version-bump on every regeneration, or do consumers always pull from `workspace:*`? Workspace-relative is simpler in this monorepo.

## Critical files for the future migration

**Style-card consumers to redirect:**

- `packages/birmel/src/persona/style-transform.ts:24-49` — `loadStyleCard()`
- `packages/scout-for-lol/packages/backend/src/league/review/prompts.ts:35-47` — `getStyleCardsDir()`

**Lore consumers to redirect (added 2026-04-25):**

- `packages/birmel/src/voltagent/agents/system-prompt.ts:1-2` — text imports
- `packages/scout-for-lol/packages/data/src/review/pipeline-stages.ts` — text imports of `prompts/context/*.txt`

**Style-card generator to consider rewiring:**

- `packages/scout-for-lol/packages/analysis/ai_analyze_llm.py` — Python script writing to `analysis/llm-out/`
