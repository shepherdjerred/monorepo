# LLM model-reference audit (OpenAI + Claude)

## Status

Complete (audit only — fixes not yet applied)

## Goal

Find every OpenAI and Claude model reference in the monorepo and check each
against the current latest models:

- **Claude:** Opus 4.8 (`claude-opus-4-8`), Sonnet 4.6 (`claude-sonnet-4-6`),
  Haiku 4.5 (`claude-haiku-4-5`) — confirmed via the `claude-api` skill catalog.
- **OpenAI:** flagship `gpt-5.5`, mini `gpt-5.4-mini`, nano `gpt-5.4-nano`
  (per the owner; corroborated by birmel/temporal/dotfiles already pinning
  `gpt-5.5`). Embeddings: `text-embedding-3-small`.

## Method caveat

The Bash tool output in this environment obfuscates model-id substrings
(`gpt-5.5`→`ni.5`, `claude-opus-4-8`→`ni-4-8`, and collapses opus/sonnet/haiku
into one token). File paths + line numbers are unaffected. Ground truth was
obtained by reading the real source files (the `Read` tool renders cleanly) —
not from grep stdout.

## Result — Claude: all current except ONE

| Ref                                 | File                                             | Value                 | Verdict                           |
| ----------------------------------- | ------------------------------------------------ | --------------------- | --------------------------------- |
| CORRECTNESS_MODEL                   | temporal pr-review/specialists/correctness.ts:30 | `claude-opus-4-8`     | ✅                                |
| PERF_MODEL                          | …/perf.ts                                        | `claude-opus-4-8`     | ✅                                |
| SECURITY_MODEL                      | …/security.ts:24                                 | `claude-opus-4-8`     | ✅                                |
| CONVENTION_MODEL                    | …/convention.ts:25                               | `claude-sonnet-4-6`   | ✅                                |
| DEPS_MODEL                          | …/deps.ts:24                                     | `claude-sonnet-4-6`   | ✅                                |
| SUMMARY_MODEL                       | temporal pr-review/summary.ts                    | `claude-haiku-4-5`    | ✅                                |
| DEFAULT_CLAUDE_MODEL                | temporal agent-task-command.ts:7                 | `claude-opus-4-8`     | ✅                                |
| DEFAULT_CLAUDE_MODEL                | temporal alert-remediation-command.ts            | `claude-opus-4-8`     | ✅                                |
| DEFAULT_MODEL                       | temporal homelab-audit.ts                        | `claude-opus-4-8`     | ✅                                |
| DEFAULT_MODEL                       | temporal scout-season-refresh.ts                 | `claude-opus-4-8`     | ✅                                |
| modelId default                     | monarch classifier/claude.ts:24 + config.ts      | `claude-sonnet-4-6`   | ✅                                |
| legacy review / homelab `claude -p` | temporal pr-agent / homelab-audit                | `claude-opus-4-8`     | ✅                                |
| **`claude -p --model`**             | **.dagger/src/release.ts:1401**                  | **`claude-opus-4-7`** | ⚠️ one behind → `claude-opus-4-8` |

- Local-iteration scripts (`run-{alert-remediation,homelab-audit,scout-season-refresh}-local.ts`)
  pin `claude-haiku-4-5-20251001` for cheap runs — intentional, fine.
- Haiku is referenced both as the alias (`claude-haiku-4-5`) and the dated id
  (`claude-haiku-4-5-20251001`). Both valid; cosmetic inconsistency only.

## Result — OpenAI: flagship current everywhere except scout-for-lol

On latest flagship `gpt-5.5`:

- birmel `OpenAIConfigSchema.model` (schema.ts:10), config/index.ts, homelab birmel env — `gpt-5.5`; classifier/style `gpt-5.4-nano` ✅
- temporal `DEFAULT_CODEX_MODEL` (agent-task-command.ts:8, alert-remediation-command.ts) — `gpt-5.5` ✅
- temporal deps-summary.ts — `gpt-5.5` ✅
- dotfiles settings.json `defaultModel` + workflow-modes.ts — `gpt-5.5` ✅
- birmel memory embedding — `text-embedding-3-small` ✅

Behind on flagship (`gpt-5.4`, where `gpt-5.5` is available) — **all in scout-for-lol**:

| Ref                             | File:line                                     | Value                                             | →                            |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------- | ---------------------------- |
| DEFAULT_REVIEW_TEXT_MODEL       | data/src/review/pipeline-defaults.ts:165      | `gpt-5.4`                                         | `gpt-5.5`                    |
| DEFAULT_IMAGE_DESCRIPTION_MODEL | pipeline-defaults.ts:173                      | `gpt-5.4`                                         | `gpt-5.5`                    |
| frontend review-tool default    | frontend/.../review-tool/config/schema.ts:117 | `gpt-5.4`                                         | `gpt-5.5`                    |
| OPENAI_MODELS catalog           | data/src/review/models.ts                     | `gpt-5.4` labeled "🚀 Latest", no `gpt-5.5` entry | add `gpt-5.5`, move "Latest" |
| analysis prod model             | analysis/ai_analyze_llm.py                    | `gpt-5.4`                                         | `gpt-5.5` (optional tool)    |

- scout timeline/match-summary stages use `gpt-5.4-mini` — fine (mini latest is 5.4-mini).
- discord-plays-pokemon/mario-kart Codex goal mode uses `gpt-5.4-nano` (+ pricing rows for 5.4-nano/mini/5.4) — nano-class on purpose; current per latest-nano target. ✅
- scout models.ts also carries legacy catalog rows (gpt-4o, gpt-4-turbo, gpt-3.5, o1/o3) flagged deprecated — informational, harmless.

## ⚠️ Coupling note for the scout fix

`getImagePricing` / `getModelPricing` in `models.ts` **throw on unknown model
ids**. Bumping `pipeline-defaults.ts` to `gpt-5.5` REQUIRES adding a `gpt-5.5`
entry (with real pricing) to `OPENAI_MODELS` in the same change, or the cost
calculation throws at runtime. Need `gpt-5.5` list price to fill it in.

## Remediation checklist (if approved)

1. `.dagger/src/release.ts:1401` — `claude-opus-4-7` → `claude-opus-4-8`
2. scout `models.ts` — add `gpt-5.5` to OPENAI_MODELS (pricing TBD), relabel `gpt-5.4`
3. scout `pipeline-defaults.ts:165,173` — `gpt-5.4` → `gpt-5.5`
4. scout frontend `config/schema.ts:117` — `gpt-5.4` → `gpt-5.5`
5. (optional) `ai_analyze_llm.py` prod model + maps — `gpt-5.4` → `gpt-5.5`
6. Update affected test fixtures alongside (scout cost tests; no temporal/monarch test churn since those sources don't change)

## Observation (not a defect)

Model ids are scattered string literals; no single "current flagship" constant.
That's why birmel/temporal/dotfiles got bumped to gpt-5.5 while scout drifted.
A shared constant per provider would prevent future drift — larger refactor,
flagged only.

## Session Log — 2026-06-19

### Done

- Full cross-repo audit of OpenAI + Claude model references (read real source
  files to defeat Bash output obfuscation).
- Claude: all on latest except `.dagger/src/release.ts:1401` (`claude-opus-4-7`).
- OpenAI: flagship `gpt-5.5` everywhere except scout-for-lol (3 source spots on
  `gpt-5.4` + stale catalog "Latest" label + python analysis tool).

### Remaining

- Apply the 6-item remediation checklist (needs `gpt-5.5` list price for the
  scout pricing map). Not started — awaiting go-ahead.

### Caveats

- scout `getModelPricing`/`getImagePricing` throw on unknown ids — the scout
  bump must add the `gpt-5.5` catalog entry atomically.
- Bash tool output obfuscates model strings in this environment; verify any
  follow-up via the Read tool, not grep stdout.
