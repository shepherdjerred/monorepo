---
id: main-ci-red-diagnosis
type: log
status: complete
board: false
---

# Why CI is red on `main` — 2026-08-01

Q&A/diagnosis session: "why is CI red on main". Investigated the current `main`
HEAD Buildkite build.

## TL;DR

Current `main` HEAD build **#7574** (commit `9636142a8`, PR #1861 — unrelated
PagerDuty change) has **two real hard failures**, both in main-only lanes:

| Lane             | State  | Root cause                                                                                                                                 |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `release-please` | FAILED | Refiner succeeded, but result parser rejects `"api_error_status": null` — Zod `.optional()` doesn't allow `null`.                          |
| `argocd-sync`    | FAILED | `media` app can't sync: live `shelfbridge-relay` probes are `httpGet`, main wants `tcpSocket` → SMP leaves 2 handlers → apiserver rejects. |

Everything else red is noise: the `waiting_failed` steps (`scout-beta-release`,
`scout-tag-release`, `scout-prod-reconcile`, `tofu-cloudflare`) are just blocked
downstream of the two failures; the `broken` steps (`playwright-e2e-pr`,
`resume-build-pr`, `docker-e2e-pr`, `trivy`, `semgrep`, `review-gate`,
`pr-dryrun`, `images-pr`) are PR-only steps skipped on `main`, and
`trivy`/`semgrep` are soft-fail anyway. **`verify` PASSED on #7574** — the
`verify` failures on #7571–#7573 were on superseded commits.

## Failure 1 — `release-please`

Log shows the Claude CHANGELOG refiner **ran to completion** (Opus, committed the
refinement to release PR #1904 at `bd647196d`, `is_error:false`,
`subtype:"success"`). The lane then threw:

```
error: Claude release refiner exited 0 without a valid non-error JSON result
    at runReleaseRefiner (scripts/lib/release-refiner.ts:405:17)
```

Root cause is a schema bug in `scripts/lib/release-refiner.ts`:

```ts
const ClaudeResultSchema = z
  .object({
    is_error: z.boolean(),
    api_error_status: z.number().optional(), // <-- rejects null
    result: z.string().optional(),
  })
  .loose();
```

The CLI's success result includes `"api_error_status": null`. Zod
`z.number().optional()` accepts `number | undefined` but **not `null`**, so
`ClaudeResultSchema.safeParse` fails → `parseClaudeResult()` returns `null` →
the `parsed === null` branch throws. The refinement itself was fine; this is a
post-success validation regression (CLI now emits `api_error_status: null` in
success payloads).

**Fix (one line):** `api_error_status: z.number().nullish()` (accepts
`number | null | undefined`).

## Failure 2 — `argocd-sync`

The `media` ArgoCD app sync failed:

```
Sync operation Failed for media: ... error when patching "/dev/shm/...":
Deployment.apps "media-qbittorrent" is invalid: [
  spec.template.spec.containers[1].livenessProbe.tcpSocket: Forbidden: may not specify more than 1 handler type,
  ...readinessProbe.tcpSocket: Forbidden...,
  ...startupProbe.tcpSocket: Forbidden... ]
```

`containers[1]` = **`shelfbridge-relay`** (order: `[0] gluetun`, `[1]
shelfbridge-relay`, `[2] qbittorrent`, `[3] qbittorrent-exporter`).

Verified it is **not a codegen bug** — synthesizing the exact probes from
`qbittorrent.ts` produces `tcpSocket`-only handlers (one per probe). The error
is on a **patch of the live object**. Confirmed against the live cluster
(`admin@torvalds`, `kubectl -n media get deploy media-qbittorrent`):

- **Live** `shelfbridge-relay`: `liveness/readiness/startupProbe` = `httpGet`
- **Main** (`qbittorrent.ts`): all three = `Probe.fromTcpSocket({ port: 8404 })`

ArgoCD sync uses a strategic-merge apply, which **adds** the new `tcpSocket`
handler without **removing** the old `httpGet`, leaving two handlers per probe →
apiserver forbids it. This is the classic "you can't change a probe handler type
via apply/SMP" trap. Introduced by #1841 (ShelfBridge webseed relay): an earlier
iteration used `httpGet /health` on port 8404 (the HAProxy `monitor-uri /health`
frontend), got deployed, and the final commit switched to `tcpSocket` — but the
live object kept `httpGet`. A code change alone won't heal it; the live object
must be **replaced**.

**Fix (operator action):** force ArgoCD to replace the resource — sync `media`
with `Replace=true`, or `kubectl -n media delete deploy media-qbittorrent` and
let ArgoCD recreate it cleanly. Optionally add a `Replace=true` sync option /
server-side-apply so future probe-handler changes don't wedge the same way.

## Evidence

- Build #7574: <https://buildkite.com/sjerred/monorepo/builds/7574>
- Failing jobs: `argocd-sync` (`019fc01e-ec47-…`), `release-please` (`019fc01e-ec4b-…`)
- `scripts/lib/release-refiner.ts:12` (schema), `:403` (throw site)
- `packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts:303-365` (shelfbridge-relay probes)

## Session Log — 2026-08-01

### Done

- Diagnosed both hard failures on current `main` HEAD (build #7574).
- `release-please`: root-caused to `api_error_status: null` vs
  `z.number().optional()` in `scripts/lib/release-refiner.ts`.
- `argocd-sync`: root-caused to a probe-handler-type change
  (`httpGet` → `tcpSocket`) on `shelfbridge-relay` that SMP can't heal;
  confirmed synth output is clean and live object still has `httpGet`.

### Remaining

- Apply the `release-refiner.ts` one-line fix (`.nullish()`) — not yet done
  (diagnosis-only session).
- Replace the live `media-qbittorrent` Deployment (operator action) so the
  `media` app can sync — not yet done.

### Caveats

- No code changed and nothing deployed this session; both fixes are proposed,
  not applied.
- The `media` app will keep failing every `argocd-sync` that runs until the live
  Deployment is force-replaced, regardless of the source being correct.

## Resolution — 2026-08-02

Long-term fix designed and implemented in a follow-up (plan-mode) session; see
`packages/docs/plans/2026-08-02_main-ci-red-longterm-fix.md`.

- **`release-please` — fixed in code.** `scripts/lib/release-refiner.ts`
  `api_error_status` changed from `z.number().optional()` to `z.number().nullish()`,
  and the `claudeSuccess` test fixture now includes `api_error_status: null` (the
  omission is what let the regression ship green), plus a dedicated regression test.
  Verified: reverting the schema to `.optional()` makes the suite fail with the exact
  production error; `.nullish()` → 15/15 pass. Shipped on branch
  `fix/release-refiner-api-error-null`.
- **`argocd-sync` — one-time operator remediation (no code change). DONE 2026-08-02.**
  Ran `argocd app sync media --replace`, which dropped the orphaned `httpGet` handler:
  the running `media-qbittorrent` `shelfbridge-relay` container now has `tcpSocket`
  probes on all three (pod `…-79fb68c467-5g5nc`, `4/4 Running`), and a subsequent normal
  `argocd app sync media` (CI's strategy, no `--replace`) returned `Synced`/`Healthy`/
  `Succeeded` — so the next main `argocd-sync` will pass.
  - **Lesson:** the app-level `--replace` also `kubectl replace`d every bound PVC in the
    `media` chart; those replaces were **rejected** (`spec is immutable after creation`,
    because the desired manifest carries `VolumeName: ""`) and so were **no-ops** — every
    PVC stayed `Bound` to its original volume, no data loss — but they left the `--replace`
    operation in a `Failed` state. Scope the replace next time:
    `argocd app sync media --replace --resource apps:Deployment:media-qbittorrent`.
- **Durable docs.** `argocd-app-patterns` skill gained a "mutually-exclusive field
  changes / probe handler swaps" section; `packages/docs/todos/argocd-synth-live-drift-gate.md`
  tracks the deferred idea of a source-vs-live drift gate that would catch this class
  before it wedges a sync.
