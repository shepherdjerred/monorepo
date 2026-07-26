---
id: plan-2026-07-25-review-provider-abstraction
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Generalize the CI review gate — provider-neutral, cut over Greptile → Codex

## Context

We're switching PR code review from **Greptile** to **Codex** (out of Greptile
credits → a fairly hard cutover). The review integration is hardcoded to Greptile
in two independent consumers and several docs. We want a **provider-neutral**
abstraction so the active reviewer (Greptile, Codex, CodeRabbit, homegrown, …) is
a swappable implementation and the next swap is a config change. Codex is active
after this change; Greptile stays as a second, dormant implementation to prove the
seam is real.

**The gate is BLOCKING** (`.buildkite/pipeline.yml:750` — "Blocking, like the old
pipeline"; no `soft_fail`; folds into the required aggregate `buildkite/monorepo/pr`).
`packages/temporal/AGENTS.md:240` calling it "soft-fail" is wrong and gets fixed.

## What Codex emits (verified on live PRs #1645/#1643/#1638/#1647)

| Signal              | Greptile                                | Codex                                               |
| ------------------- | --------------------------------------- | --------------------------------------------------- |
| Author              | `greptile-apps[bot]`                    | `chatgpt-codex-connector[bot]`                      |
| Completion          | check-run on head (`statusCheck:true`)  | submitted review with `commit_id == head`           |
| Clean / no findings | `<!-- greptile-status -->` skip comment | 👍 reaction (no review object); 👀 while processing |
| Threads             | GraphQL `reviewThreads` (resolvable)    | same                                                |
| Severity            | `alt="P2"` / `badges/p2.svg`            | `![P2 Badge](…/badge/P2-yellow…)`                   |
| Re-review on push   | `triggerOnUpdates:true`                 | yes (confirmed)                                     |
| Status-check toggle | yes                                     | none                                                |

Latency ~6–7 min push→review; inside the 20-min timeout. Docs claim P0/P1-only but
live shows P2 → keep the P0–P3 threshold model.

## Design

New workspace package **`packages/code-review`** (`@shepherdjerred/code-review`) is
the single source of truth; both consumers import it (kills drift).

`ReviewProvider` = `{ id, displayName, authorLogins[], parseSeverity(body),
completion, detectSkip? }`. `CompletionStrategy` = `{kind:"check-run"; namePattern}`
(Greptile) | `{kind:"review-at-head"; cleanSignal:"thumbsup-reaction"}` (Codex).

- **Pure core** (both consumers): descriptors, `isProviderAuthor`, `parseSeverity`,
  `REVIEW_SEVERITIES`, `evaluateGate` (generalized over `reviewState:
reviewing|reviewed|errored`), thread classification, `ReviewSignalEvent` +
  `formatSignalEvent()`.
- **Gate-only I/O** (scripts/): `resolveReviewState(provider, {repo, head, prNumber,
token})` — check-run vs review-at-head+👍, skip detection.

Codex `hasReviewedHead(head)`: (1) latest Codex review `commit_id === head` →
reviewed; (2) else 👍 from connector → reviewed-clean; (3) else waiting (poll to
timeout, backstopped by `@codex review`).

Active provider: `REVIEW_PROVIDER` env (default `codex`); `GREPTILE_*` tuning envs
generalize to `REVIEW_*`. Pipeline sets none today → no CI-var migration.

## Changes by area

| Area           | Change                                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New pkg        | `packages/code-review/` — package.json, tsconfig, `src/{types,severity,gate,signal,providers/{greptile,codex,registry}}.ts` + tests                                                                                                                      |
| CI gate        | rename `scripts/wait-for-greptile.ts` → `wait-for-review.ts`; move Greptile internals into pkg; keep poll loop; import registry; emit signal events; update `scripts/eslint.config.ts:29`                                                                |
| Pipeline       | `.buildkite/pipeline.yml:756-770` — label/key/pod-label → `review-gate`, command → `wait-for-review.ts`, fix `750` comment                                                                                                                               |
| pr-babysit     | `dod.ts` (`isReviewBotAuthor` via registry, `isReviewBot`), `types.ts:122`, `prompt.ts:102`, `evaluate-dod.ts:44` context substring; import from pkg; tests                                                                                              |
| Tests          | replace `buildkite/monorepo/pr/mag-greptile-review` fixtures; add Codex fixtures                                                                                                                                                                         |
| Codex steering | `## Code Review Rules` in root `AGENTS.md`; keep `.greptile/config.json`                                                                                                                                                                                 |
| Observability  | `ReviewSignalEvent`/`formatSignalEvent` in pkg; gate structured logs; `observe-review-signals.ts` collector + workflow + SCHEDULES; `review_*` metrics; S3 `review-signals/`; optional webhook capture; `scripts/probe-review-signal.ts`; Grafana panels |
| Docs           | fix `temporal/AGENTS.md:240`, stale `homelab/src/tofu/README.md:92`; `rulesets.tf` no change                                                                                                                                                             |

## Observability

Two tiers (no Pushgateway → CI logs only; temporal worker owns durable metrics on
`:9465`). Shared `ReviewSignalEvent` schema. Tier 1: gate emits `component:"review-gate"`
JSON per poll + terminal. Tier 2: scheduled `observe-review-signals` collector →
`review_*` Prom metrics + NDJSON to existing `llm-archive` S3 `review-signals/` prefix;
optional webhook real-time capture; wire Codex 👍/👎 into reaction-listener. Grafana:
latency p50/p95, findings×severity, clean-via-reaction rate, stale-reaction rate,
gate timeout.

## Verification

1. `bunx turbo run test --filter=@shepherdjerred/code-review`
2. Gate dry-run vs a real Codex PR (both `REVIEW_PROVIDER` values)
3. `bunx turbo run test --filter=@shepherdjerred/temporal`
4. `bun run verify -- --affected`
5. Live: `review-gate` drives aggregate red→green; screenshot
6. Observability: metrics on `:9465`, NDJSON in S3, dashboard screenshot

## Remaining

- [ ] Observability: `observe-review-signals` collector activity + workflow + `SCHEDULES` entry, `review_*` metrics, S3 `review-signals/` prefix, `scripts/probe-review-signal.ts`, Grafana panels
- [ ] Codex steering (`## Code Review Rules` in root `AGENTS.md`) + docs fixes (`temporal/AGENTS.md`, stale `homelab/src/tofu/README.md`)
- [ ] Gate dry-run against a live Codex PR (both `REVIEW_PROVIDER` values); confirm 👍-reaction clean path with the probe
- [ ] `bun run verify -- --affected` green; open draft PR; attach gate + dashboard screenshots

## Caveats

- 👍 has no SHA → stale after a post-clean push until re-react; backstopped by timeout
  - `@codex review`. Probe confirms real behavior.
- Greptile dormant — keep `.greptile/config.json`; re-enable via `REVIEW_PROVIDER=greptile`.
- One PR for the whole themed change.
