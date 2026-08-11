---
id: plan-2026-08-02-main-ci-red-longterm-fix
type: plan
status: in-progress
board: false
---

# Long-term fix: main CI red (release-please + argocd-sync)

Mirror of the approved plan-mode plan. Diagnosis: prior analysis.

## Context

`main` HEAD (Buildkite #7574) was red on two independent, main-only lanes. Durable fixes, not band-aids:

1. **`release-please`** — the Claude CHANGELOG refiner completed successfully (committed the
   refinement to release PR #1904), but the result parser rejected valid CLI output.
   `ClaudeResultSchema` (`scripts/lib/release-refiner.ts`) typed
   `api_error_status: z.number().optional()`; the CLI's success payload includes
   `"api_error_status": null`, which `.optional()` rejects → `parseClaudeResult()` returns null →
   the exit-0 branch throws. A test fixture that omitted the field let it ship green.
2. **`argocd-sync`** — the `media` app can't sync because the live `media-qbittorrent`
   `shelfbridge-relay` container has `httpGet` probes while main synthesizes `tcpSocket`.
   ArgoCD's default strategic-merge apply adds the new handler without removing the old →
   apiserver rejects (`may not specify more than 1 handler type`). Source is already correct;
   only the live object is wedged, so no code change can heal it — the live object must be replaced.

Decisions (confirmed with user): ArgoCD fix = **one-time operator replace** (no permanent code
annotation); scope = **two fixes + durable docs** (do not build the drift gate now).

## Part 1 — release-please schema fix (code)

- `scripts/lib/release-refiner.ts`: `api_error_status: z.number().nullish()` (was `.optional()`).
  It is read only in `isClaudeQuotaExhaustion`, which early-returns on `exitCode === 0`, so
  `.nullish()` preserves the `=== 429` quota check while accepting the new `null`.
- `scripts/lib/release-refiner.test.ts`: `claudeSuccess` fixture now carries `api_error_status: null`
  (matching the real CLI contract), plus a dedicated fixture-independent regression test.
- Left `result: z.string().optional()` unchanged — a null result on a claimed success _should_ fail.
- Sibling parsers (`packages/temporal/src/shared/claude-result.ts`, `llm-observability`) don't
  declare a typed `api_error_status`; no change needed.

## Part 2 — argocd-sync one-time operator remediation (no code)

Force-replace the live Deployment so the orphaned `httpGet` is dropped:

```bash
argocd app sync media --replace
# fallback (selfHeal:false → must resync): kubectl -n media delete deploy media-qbittorrent && argocd app sync media
```

`media` has no `Replace` syncOption and `argocd.ts sync()` can't pass `--replace`, so
**`argocd-sync` stays red on every main build — including after the Part 1 PR merges — until this
one-time replace runs.** Verify: `shelfbridge-relay` probes are `tcpSocket`-only and `media` is
Synced/Healthy.

## Part 3 — durable docs

- `argocd-app-patterns` skill: added a "mutually-exclusive field changes (probe handler swaps)"
  section — SMP can't drop the orphaned handler; remediate with a one-time `--replace`; per-resource
  `Replace=true` for resources that change handlers often (never app-level on charts with bound PVCs).
- Completed prior analysis with the resolution.
- Filed `todos/argocd-synth-live-drift-gate.md` for the deferred source-vs-live drift gate.

## Deliverables

- **One PR** (`fix/release-refiner-api-error-null`): Part 1 code + Part 3 docs. `release-please` and
  `argocd-sync` are main-only lanes, so the PR build validates on `verify`; the release fix is proven
  on the post-merge main build.
- **Separate operator action**: Part 2 `argocd app sync media --replace` (live cluster; independent).

## Verification

- Part 1: `bun test scripts/lib/release-refiner.test.ts` (15/15; reverting to `.optional()` fails with
  the exact production error) + `bunx turbo run typecheck lint --filter=@shepherdjerred/root-scripts`.
- Part 2: `kubectl -n media get deploy media-qbittorrent` shows tcpSocket-only; `argocd app get media`
  Synced/Healthy; next main `argocd-sync` green.
- Part 3: `bun run check-todos` + markdownlint clean.

## Remaining

- [ ] Merge PR #1920 (Part 1 + Part 3).
- [x] Operator: force-replaced the live `media-qbittorrent` (2026-08-02) — probes
      now `tcpSocket`-only, `media` Synced/Healthy under normal sync. Scope future
      replaces with `--resource apps:Deployment:media-qbittorrent` (app-level
      `--replace` harmlessly fails the bound-PVC replaces and reports the op Failed).
- [ ] Confirm the post-merge main build is green on both lanes.
