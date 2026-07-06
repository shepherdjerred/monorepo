# `packages/llm-models` — Central LLM Model Catalog

## Status

Complete

`@shepherdjerred/llm-models` is the single source of truth for active LLM models (OpenAI/Anthropic/Google) — pricing, capabilities, context windows (PR #1281).

## Source of truth

- **`src/catalog.json`** (not a `.ts`). Validated per-language: Zod (`src/index.ts` → `MODELS`, `getModel`, `getPricing`, `getPerTokenPricing`, `costForTextUsage`, `modelsByProvider`, `isModelId`) and Pydantic (`python/validate_catalog.py`). Active models only; legacy rows intentionally absent.
- **Pricing:** USD per 1M tokens (text), USD per image (Gemini `perImage`). OpenAI uses `cachedInput`; Anthropic uses `cacheRead`/`cacheWrite`.

## It's a BUILT package

`src/index.ts` statically imports `catalog.json` so it's bundler-inlined (scout Vite frontend) and Bun-resolved in Node, while consumers typecheck the committed `.d.ts`. Built in `setup.ts`' DAG. It is **not** in `release.ts` `SKIP_BUILD_DEPS`, so after editing `catalog.json` consumers need a forced reinstall (`bun install --force`) to see the new `dist/`.

## Consumers

Each deleted its local model map and imports the catalog: monarch `usage.ts`, temporal `pr-review/summary-cost.ts`, dpp `goal/pricing.ts`, scout `data/review/models.ts` (thin adapter keeping the old `OPENAI_MODELS`/`GEMINI_PRICING`/`getModelInfo` surface), scout python `ai_analyze_llm.py`.

## Auto-refresh

`scripts/sync-from-upstreams.ts` (`bun run sync`) deterministically cross-checks input/output/context prices vs models.dev + LiteLLM (both MIT) and rewrites on drift; cache + image prices are NOT cross-checked. Temporal `llm-catalog-refresh-weekly` runs it and opens a PR on drift (no LLM). Brand-new flagships and Gemini image models are "overlay-only" (manually maintained); the refresh report flags them.

## Fresh-worktree gotcha — missing `dist/`

`@shepherdjerred/llm-models` is a `file:` dep, so bun **copies** it into the consumer's `node_modules` rather than symlinking, and its `dist/` is gitignored. In a fresh worktree the copy lands **without `dist/`** (copied before the build ran), so tsc fails with `TS2307: Cannot find module '@shepherdjerred/llm-models'` even though `packages/llm-models/dist` exists in source. Fix: `bun run --filter='./packages/llm-models' build` then `bun install` in the consumer package (re-copies dist into its node_modules copy). Same class as scout's copied `file:` deps. Trap: `bun run typecheck 2>&1 | tail` reports the pipe's exit (0) — capture the un-piped status.
