---
id: plan-llm-model-catalog-refresh-2026-07-26
type: plan
status: complete
board: false
---

# LLM Model Catalog Refresh — Opus 5 / Sonnet 5 / Fable 5 / GPT-5.6

## Goal

Add the current Anthropic (Opus 5, Sonnet 5, Fable 5) and OpenAI (GPT-5.6
Sol/Terra/Luna) models to the central catalog (`packages/llm-models`), then bump
every monorepo caller off superseded IDs to the latest.

## Research (authoritative sources)

- **Anthropic** — live models page
  (`https://docs.claude.com/en/docs/about-claude/models/overview.md`, fetched
  2026-07-26): Opus 4.8 is now **Legacy**; current lineup is Fable 5,
  **Opus 5**, Sonnet 5, Haiku 4.5.
- **OpenAI** — models.dev (repo's own sync upstream) + web: **GPT-5.6** family
  (Sol/Terra/Luna) shipped 2026-07-09; `gpt-5.4-mini`/`nano` remain current.

| New model         | provider  | in/out $/1M | cache        | ctx         | max out | status  | wired?            |
| ----------------- | --------- | ----------- | ------------ | ----------- | ------- | ------- | ----------------- |
| `claude-opus-5`   | anthropic | 5 / 25      | r0.5 / w6.25 | 1M (pinned) | 128k    | current | yes               |
| `claude-sonnet-5` | anthropic | 3 / 15¹     | r0.3 / w3.75 | 1M          | 128k    | current | yes               |
| `claude-fable-5`  | anthropic | 10 / 50     | r1.0 / w12.5 | 1M (pinned) | 128k    | current | no (catalog only) |
| `gpt-5.6-sol`     | openai    | 5 / 30      | cached 0.5   | 1.05M       | 128k    | current | yes (flagship)    |
| `gpt-5.6-terra`   | openai    | 2.5 / 15    | cached 0.25  | 1.05M       | 128k    | current | no (catalog only) |
| `gpt-5.6-luna`    | openai    | 1 / 6       | cached 0.1   | 1.05M       | 128k    | current | no (catalog only) |

¹ Sonnet 5 has introductory pricing of $2/$10 through 2026-08-31; catalog stores
the **standard** $3/$15 sticker (reverts after intro; avoids future sync drift)
with the intro noted in `description`.

Superseded-but-kept (marked `status: "deprecated"`, pricing retained for
historical cost attribution / observability fixtures): `claude-opus-4-8`,
`claude-sonnet-4-6`, `gpt-5.5`.

## Decisions (confirmed with user 2026-07-26)

- Flagship OpenAI callers → `gpt-5.6-sol` (same $5/$30 as gpt-5.5).
- Sonnet callers → `claude-sonnet-5` (adaptive thinking ON by default, new
  tokenizer ~+30% tokens, rejects temperature/top_p).
- Opus callers → `claude-opus-5` (same $5/$25 as Opus 4.8; Opus 4.8 now legacy).
- Keep cost-tier workers `gpt-5.4-mini` (scout chunks) / `gpt-5.4-nano` (birmel
  classifier+style, dpp) — no newer equivalent in the 5.6 family.
- Keep Haiku 4.5 and Gemini image models unchanged.
- Fable 5 / GPT-5.6 Terra+Luna added to catalog for pricing/completeness, not
  wired to any caller.

## Model-ID bumps (source)

**gpt-5.5 → gpt-5.6-sol**

- birmel: `src/config/index.ts:46`, `src/config/schema.ts:10`, `.env.example:8`,
  `AGENTS.md:95`, `e2e/openclaw-capabilities-container.ts:112,174`,
  `tests/config/schema.test.ts:53` (assert)
- homelab: `src/cdk8s/src/resources/birmel/index.ts:133`
- scout: `packages/backend/src/reports/ai/report-query-agent.ts:83`,
  `.../ai/status.ts:14`, `packages/backend/src/configuration.ts:103`,
  `packages/data/src/review/pipeline-defaults.ts:165,173`

**claude-sonnet-4-6 → claude-sonnet-5**

- monarch: `src/lib/config.ts:43`, `src/lib/classifier/claude.ts:24`,
  `src/lib/usage.ts:19`, `README.md:50`, `ARCHITECTURE.md:219`
- temporal: `specialists/deps.ts:24`, `specialists/convention.ts:25`

**claude-opus-4-8 → claude-opus-5**

- temporal: `specialists/perf.ts:26`, `specialists/correctness.ts:24`,
  `specialists/security.ts:24`, `activities/homelab-audit.ts:44`,
  `activities/scout-season-refresh.ts:41`, `activities/agent-task-command.ts:7`,
  `shared/pr-babysit/types.ts:76`, `AGENTS.md:290` + rationale comments
- scout: `packages/data/scripts/patch-analysis.ts:22`

Out of scope: `sandbox/**` (archived/practice), `node_modules/**`,
llm-observability test fixtures (opaque model strings, not our calls).

## Verify

- `bunx turbo run typecheck test lint --filter=@shepherdjerred/llm-models --filter=monarch --filter=birmel --filter=scout-for-lol --filter=temporal --filter=homelab`
- `bun run packages/llm-models/scripts/sync-from-upstreams.ts --check` (new
  OpenAI entries should match models.dev; Anthropic new entries "overlay-only").
- Rebuild `packages/llm-models` (`dist/` consumers).
