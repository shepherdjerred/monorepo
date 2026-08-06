---
id: reference-completed-2026-06-19-central-llm-model-catalog
type: reference
status: complete
board: false
---

# Central LLM model catalog (`@shepherdjerred/llm-models`) + cross-checked auto-refresh

## Context

LLM model definitions were scattered across ~35 references in 10+ files across
TypeScript/Bun and Python, mixing model-id _choices_, _pricing_ maps, and
_capability/context_ maps. They drift independently (PR #1272 found the gpt-5.4
family mispriced in three separate maps). Goal: one language-neutral source of
truth for pricing + capabilities + context window, with full parity across
OpenAI, Anthropic, and Google — populated with **only the active models we use**.

**Prior art (researched):** LiteLLM `model_prices_and_context_window.json` (MIT)
and models.dev (MIT) exist and cover the three providers, but both lag the newest
flagships (no `gpt-5.5` yet) and carry no Gemini image-generation per-image
pricing. Decision: build our own small catalog and use those two as a
deterministic cross-check in the refresh (not as the source).

## Decisions (confirmed with user)

1. New dedicated package `packages/llm-models` (`@shepherdjerred/llm-models`).
2. Source of truth = `catalog.json` (not `.ts`); validate per-language with Zod (TS) + Pydantic (Python). No codegen; `ModelId` is a runtime-validated string.
3. Build our own, cross-checked against models.dev + LiteLLM.
4. Active models only, full 3-provider parity (~10-12 models).
5. Catalog only — services keep their own model _choice_ (validated against the catalog).

## Phase 1 — package (DONE)

`packages/llm-models/`: `catalog.json` (seeded from #1272 verified values),
`catalog.schema.json`, `src/index.ts` (Zod schema + `MODELS`, `getModel`,
`getPricing`, `getPerTokenPricing`, `costForTextUsage`, `isModelId`/`assertModelId`,
`modelsByProvider`), `python/validate_catalog.py` (Pydantic), tests (shape +
all-provider parity + cost-parity vs dpp/monarch/temporal/scout formulas).
Wiring: `scripts/ci ALL_PACKAGES`, `.dagger deps WORKSPACE_DEPS` + `release
SKIP_BUILD_DEPS`, `knip.json`. Verified: typecheck, 12 tests, eslint, Pydantic
validation, validate-catalog test (35 pkgs), full pre-commit gate.

Catalog shape: token prices USD/1M, image prices USD/image, discriminated by
modality. **Built package** (`dist/` + `.d.ts`): `src/index.ts` statically
imports `src/catalog.json` (bundler-inlined in browsers, resolved by Bun in
Node), so consumers typecheck the declarations rather than the source. Built in
`setup.ts`' DAG + consumer copies refreshed (mirrors webring); not in
`SKIP_BUILD_DEPS`.

## Phase 2 — migrate consumers (DONE)

Each TS consumer: add `file:` dep, append the `.dagger/src/deps.ts` edge, delete
its local map, point its helper at the catalog, refresh `bun.lock`.

- scout data `review/models.ts` — rewrite as a thin adapter keeping every exported name/signature; drop legacy/deprecated rows. **The catalog `file:` dep is declared at the scout _workspace root_, not in `data`** — declaring it in `data` (consumed via `file:` by 6 siblings) hits a bun 1.3.14 bug that makes `--frozen-lockfile` unsatisfiable; root-hoisting resolves it for `data/review/models.ts`. See prior analysis.
- temporal `pr-review/summary-cost.ts` — `estimateCostUsd` → `costForTextUsage("claude-haiku-4-5-20251001", …)`.
- dpp `goal/pricing.ts` — `computeCost` reads `getPricing`.
- monarch `lib/usage.ts` — `createUsageTracker` → `getPerTokenPricing(...) ?? getPerTokenPricing("claude-sonnet-4-6")`.
- scout Python `ai_analyze_llm.py` — load `catalog.json` with Pydantic; replace context-limit + price constants.
- Add a cross-consumer parity guard (every referenced model id ∈ catalog).

## Phase 3 — deterministic cross-checked refresh (DONE)

`packages/llm-models/scripts/sync-from-upstreams.ts`: fetch models.dev
`api.json` and the LiteLLM JSON (normalize keys/units), diff each catalog model,
write corrections, and report drift plus any catalog models absent upstream
(overlay-only). Temporal wrapper (reuse `openSeasonRefreshPr`): clone → sync →
prettier → drift-check → PR. Schedule `llm-catalog-refresh-weekly` (cron
`0 9 * * 1`, queue DEFAULT, SKIP overlap). Secrets: only `GITHUB_APP_*` (no LLM,
no scraping).
