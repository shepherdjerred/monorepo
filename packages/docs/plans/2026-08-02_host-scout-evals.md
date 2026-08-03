---
id: plan-2026-08-02-host-scout-evals
type: plan
status: in-progress
board: false
---

# Host the Scout Review Evals app on the homelab

## Context

`@scout-for-lol/evals` (packages/scout-for-lol/packages/evals) is a loopback-only Bun app
(Hono/tRPC + built Vite client + one WAL-mode SQLite file) for rating post-match review
datasets. Hosting it makes rating reachable from any tailnet device and gives the DB a durable,
Velero-backed home. Name everywhere: **`scout-evals`** (image, chart, namespace, tailnet host —
verified no conflicts).

## Decisions (user-confirmed)

| Decision       | Choice                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trust boundary | Tailscale only (TailscaleIngress, no app auth, never Funnel)                                                                                        |
| Durability     | PVC (`ZfsNvmeVolume`, 1 GiB, backup **enabled**)                                                                                                    |
| Image          | Built/pushed by the standard Buildkite bake flow, digest-pinned via commit-back                                                                     |
| Draft flow     | **Remote push over tailnet**: new draft transfer format + `datasets.pushDraft` tRPC mutation + `dataset:push` CLI; materialization/creds stay local |
| Seed data      | Hosted DB starts empty                                                                                                                              |

Draft-push semantics: drafts carry metadata + cases + generations (no ratings); re-push is an
**additive merge** (insert missing case/generation ids, canonical-JSON-verify existing ones,
hard-reject content drift or a finalized target). Reuses `dataset-transfer.ts` sha256 machinery.
Verified: generation `sequence` is `INTEGER PRIMARY KEY AUTOINCREMENT` (migrations.ts:79) so
appended generations order correctly; existing finalized export/import stays untouched.

## Part A — Evals app (packages/scout-for-lol/packages/evals)

- `src/server/index.ts` — add `host` option: `--host` ?? `SCOUT_EVAL_HOSTNAME` env ?? `"127.0.0.1"`; pass to `Bun.serve`. dev.ts/e2e untouched.
- `src/shared/schema.ts` — add `DraftTransferMetadataSchema` (status literal `"draft"`), `DraftTransferCaseSchema` (no ratings), `DatasetDraftTransferPayloadSchema` + checksummed `DatasetDraftTransferSchema`; extract shared case-dedup superRefine helper (file must stay <500 lines).
- `src/server/dataset-transfer.ts` — parameterize checksum helpers; add `createDraftTransfer` / `validateDraftTransfer`.
- NEW `src/server/draft-transfer-store.ts` — `exportDraftFromDatabase` (draft-only snapshot in one transaction) + `pushDraftIntoDatabase` (additive merge per semantics above), mirroring `dataset-transfer-store.ts` structure.
- `src/server/store.ts` — `exportDraft` / `pushDraft` methods; mirror on the in-memory e2e test store.
- `src/server/trpc.ts` — `datasets.pushDraft` mutation (input `DatasetDraftTransferSchema`, output `DatasetSummarySchema`).
- NEW `src/scripts/push-dataset.ts` — open local store, `exportDraft`, `createTRPCClient<AppRouter>` + `httpBatchLink({ url: <server>/trpc })`, `datasets.pushDraft.mutate(...)`. Flags: `--dataset`, `--server` (?? `SCOUT_EVAL_REMOTE_URL`), `--database`.
- `package.json` — `"dataset:push"` script. Docs: `README.md` + workflow table in `packages/scout-for-lol/CLAUDE.md`.
- Tests: NEW `src/server/draft-transfer-store.test.ts` (round-trip, tamper reject, finalized-collision reject, additive re-push, content-drift reject, ratings survive re-push); extend `src/server/dataset-transfer-api.test.ts` with pushDraft over `app.request`.

## Part B — Image + CI

- NEW `packages/scout-for-lol/packages/evals/Dockerfile` (repo-root context, modeled on `packages/tasknotes-server/Dockerfile`): `prod-deps` (manifest-only COPY, `bun install --frozen-lockfile --production --filter '@scout-for-lol/evals'`) → **`build`** (dev-deps install + `vite build` → `dist/client`) → `runtime` (prod-deps tree + evals sources + built `dist/client`; `WORKDIR /app/packages/scout-for-lol/packages/evals` so cwd-relative `./dist/client` serving works; `CMD ["bun", "src/server/index.ts"]`; EXPOSE 7341) → `smoke` (uid 1000, `smoke-app-in-image.ts`) → empty `image` stage. Verified: server/client import graph never touches `@scout-for-lol/data` (materialization-only) — the 82 MB data package stays out of the image.
- `.buildkite/scripts/image-targets.ts` — `"scout-evals": "@scout-for-lol/evals"`.
- `.buildkite/scripts/migration-core.ts` — add to `applicationTargets`.
- `docker-bake.hcl` — `scout-evals` target block + `group "app"`.
- `.buildkite/scripts/smoke-app-in-image.ts` — `scout-evals` entry (boot with `SCOUT_EVAL_DATABASE_PATH=/tmp/...`, poll for `Scout review evals:` ready line — also proves uid-1000 WAL DB creation).
- `packages/homelab/src/cdk8s/src/versions.ts` — pin key `"shepherdjerred/scout-evals"` with placeholder `0.0.0@sha256:<64 zeros>` + `// not managed by renovate`; first main build's commit-back lane PRs the real tag@digest.
- Evals `package.json`: `docker:build` + `smoke` scripts; NEW `scripts/smoke.ts` (clone tasknotes'). Turbo needs no changes.
- Fix `.buildkite` test fixtures that enumerate targets (`select-image-targets.test.ts`, `bake-images.test.ts`, `application-image-inputs.test.ts`, `ci-lane-coverage.test.ts` — failures will name each spot).

## Part C — Homelab (packages/homelab/src/cdk8s)

- NEW `src/cdk8s-charts/scout-evals.ts` — Chart + Namespace `scout-evals`, NetworkPolicies (ingress from `tailscale` ns + prometheus:7341; egress DNS only — server makes no outbound calls).
- NEW `src/resources/scout-evals.ts` — `createScoutEvalsDeployment`: replicas 1, `DeploymentStrategy.recreate()` (RWO PVC + single-writer SQLite), `fsGroup: 1000`; container via `withCommonProps` — image from versions pin, port 7341, env `SCOUT_EVAL_HOSTNAME=0.0.0.0` + `SCOUT_EVAL_DATABASE_PATH=/data/scout-review-evals.sqlite`, securityContext user/group 1000 + `ensureNonRoot`, resources 50m/500m CPU + 128Mi/512Mi mem, startup/liveness/readiness probes on `/health`; `ZfsNvmeVolume` "scout-evals-data" (1 GiB) mounted at `/data`; Service; `TailscaleIngress { host: "scout-evals", probePath: "/health" }`. No secrets.
- `src/backup-policy/pvc-backup-policy.json` — `scout-evals/scout-evals-data` **enabled** ("human ratings live only here"; name must match construct id or synth throws).
- NEW `helm/scout-evals/Chart.yaml` (clone tasknotes template).
- NEW `src/resources/argo-applications/scout-evals.ts` + wire into `src/cdk8s-charts/apps.ts`.
- `src/setup-charts.ts` — `createScoutEvalsChart(app)` before `createServiceProbesChart`.

## PR strategy

Worktree + one native gh-stack, two layers (real sequencing reason: ArgoCD must not deploy the
placeholder pin):

1. **Layer 1: Parts A + B** — app changes, Dockerfile, CI wiring, placeholder pin. On merge,
   main builds/pushes the image and commit-back auto-PRs the real tag@digest.
2. **Layer 2: Part C** — homelab chart + ArgoCD app. Merge after the commit-back pin lands.

## Verification

Local:

- `bunx turbo run typecheck test lint --filter=@scout-for-lol/evals`; `bunx turbo run test:e2e --filter=@scout-for-lol/evals`.
- Draft-push loop against a second local server: `SCOUT_EVAL_DATABASE_PATH=/tmp/remote.sqlite bun run start -- --port 7345`; `dataset:push --dataset <id> --server http://127.0.0.1:7345`; extend draft via materialize spec `datasetId`, re-push, confirm additive merge + surviving ratings in the 7345 UI.
- Image: `bun run --filter=@scout-for-lol/evals docker:build` + `bunx turbo run smoke --filter=@scout-for-lol/evals`; sanity-check image size (no data package).
- `cd .buildkite && bun test` (target-enumeration fixtures); `cd packages/homelab/src/cdk8s && bun run build && bun run test` (helm render, backup policy, resources checks pick the chart up automatically).

On-cluster (after layer 2 merges):

- Commit-back PR pinned real digest; ArgoCD `scout-evals` Healthy; pod Running, PVC Bound.
- Tailnet: `curl https://scout-evals.<tailnet>.ts.net/health` → `{"status":"ok"}`; UI loads; DB empty. Confirm unreachable off-tailnet.
- E2E: push a real draft over the tailnet, rate a case in the hosted UI, re-push an extended draft, confirm merge.
- Confirm next Velero run includes the PVC.

## Risks

- `.buildkite` fixture edits not fully enumerated — test failures will name them.
- `readOnlyRootFilesystem: false` initially (Bun may write under `$HOME`); tightening is a follow-up.
- Large drafts ship as one JSON POST — fine on tailnet; chunking only if ever needed.
- No app auth by design: anyone on the tailnet can rate/push. Accepted.

## Session Log — 2026-08-03

### Done

- Layer 1 (PR #1955, `feature/host-scout-evals`): shipped the app + image layer.
  - Hosted-mode app support: additive draft transfer over the tailnet
    (`src/server/dataset-transfer.ts`, `src/server/draft-transfer-store.ts` and
    tests, `src/scripts/push-dataset.ts`, schema and store wiring), documented in
    `packages/scout-for-lol/packages/evals/README.md` ("Push A Draft To The
    Hosted Instance").
  - Image build: `packages/scout-for-lol/packages/evals/Dockerfile`, smoke
    (`scripts/smoke.ts`, `.buildkite/scripts/smoke-app-in-image.ts`),
    `docker-bake.hcl`, `.dockerignore`, and image-target wiring
    (`scout-evals` in `.buildkite/scripts/image-targets.ts`).
  - Placeholder image pin in `packages/homelab/src/cdk8s/src/versions.ts`
    (commit-back replaces it with the real tag@digest after merge).
- CI selector correctness: `.buildkite/scripts/select-image-targets.ts` now
  rebuilds `scout-evals` when `packages/scout-for-lol/tsconfig.base.json`
  changes (the evals Dockerfile copies that file and its runtime tsconfig
  extends it), with the assertion updated in `select-image-targets.test.ts`.

### Remaining

- Layer 2 (PR #1956, `feature/scout-evals-homelab`, stacked on this): homelab
  chart + ArgoCD app + `TailscaleIngress`. Merge after this PR's commit-back
  pin lands. The human-facing wiki page for the hosted service and its tailnet
  trust boundary belongs with that layer, where the deployment actually exists.
- On-cluster verification (post layer-2 merge): ArgoCD `scout-evals` Healthy,
  PVC Bound, tailnet health check, off-tailnet unreachable, Velero includes the
  PVC. See the Verification section above.

### Caveats

- `readOnlyRootFilesystem: false` initially (Bun may write under `$HOME`);
  tightening is a follow-up.
- No app auth by design: anyone on the tailnet can rate/push. Accepted.
- Draft transfers are additive merges that reject drift/checksum mismatch;
  server-authored ratings always survive re-pushes.
