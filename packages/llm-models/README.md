# @shepherdjerred/llm-models

Language-neutral catalog of the active LLM models used across this repo, with
pricing and capabilities. The source of truth is `src/catalog.json`, described
by [catalog.schema.json](catalog.schema.json) (JSON Schema 2020-12) and
validated at runtime by Zod in TypeScript and Pydantic in Python.

Units: token prices are **USD per 1,000,000 tokens**; image prices are **USD
per image**. Each entry carries provider (`openai` | `anthropic` | `google`),
display name, pricing (text or image modality, including cache pricing),
capabilities (temperature/top-p support, effort tiers, adaptive thinking),
context window, and status (`current` | `preview` | `deprecated`).

## TypeScript consumption

The package entry is the built `dist/` output with the JSON alongside
(`bun run build` compiles TS and copies `catalog.json` into `dist/`), so it is
safe in both browser and node contexts — no `node:fs` read. Raw JSON is also
exported at `@shepherdjerred/llm-models/catalog.json`.

```ts
import {
  MODELS,
  getModel,
  getPricing,
  costForTextUsage,
  modelsByProvider,
  assertModelId,
} from "@shepherdjerred/llm-models";
```

`MODELS` is the Zod-parsed catalog; accessors include `isModelId` /
`assertModelId`, `getModel`, `getPricing`, `getPerTokenPricing`,
`costForTextUsage`, `allModelIds`, and `modelsByProvider`.

## Python consumption

`python/validate_catalog.py` is the Pydantic view of the same JSON and the
template for other Python consumers:

```bash
uv run packages/llm-models/python/validate_catalog.py
```

## Upstream cross-check

`scripts/sync-from-upstreams.ts` cross-checks every text model against two
public datasets — [models.dev](https://models.dev) and LiteLLM's
`model_prices_and_context_window.json` — for the unambiguous fields (input
price, output price, context window). It rewrites drifted values by default,
never adds or removes models, and deliberately skips cache prices and image
models (upstreams normalize those inconsistently); models absent from both
upstreams are reported as overlay-only and stay manually maintained.

```bash
bun run sync                                     # apply drift, rewrite src/catalog.json
bun run scripts/sync-from-upstreams.ts --check   # report only, non-zero exit on drift
```

The Temporal schedule `llm-catalog-refresh-weekly`
([packages/temporal](../temporal/)`/src/schedules/schedule-definitions.ts`)
runs this cross-check every Monday and opens a PR when pricing drifts.

## Development

```bash
bun run build       # tsc + copy catalog.json into dist/
bun run test
bun run typecheck
bun run lint
```

Consumers include `packages/temporal` (bot-clone, data-dragon, budget
activities) and `packages/scout-for-lol` (review model selection). Background
and history: `packages/docs/guides/2026-06-28_llm-models-catalog.md`.
