# Scout-for-LoL S3 image retention (30-day GC)

## Status

Partially Complete — code built, tested, and validated against live data; awaiting PR merge + post-deploy one-time reclaim (Phase 3).

## Problem

Scout's SeaweedFS buckets hold **~167 GiB** across two stages; **~83% is generated images** (`.png` + `.svg`) that accumulate forever. The raw JSON (match/timeline/spectator, ~28 GiB) is worth keeping; the images are not needed beyond ~1 month.

| Bucket     |     Total |           png+svg |     json |
| ---------- | --------: | ----------------: | -------: |
| scout-prod | 121.5 GiB | 101.4 GiB (83.5%) | 20.1 GiB |
| scout-beta |  45.3 GiB |  37.2 GiB (82.2%) |  8.1 GiB |

Goal: keep a **rolling 30-day** window of images; retain JSON indefinitely.

## Decision

**Scheduled prune-by-suffix job**, not native S3 lifecycle and not a key restructure.

- Native S3 lifecycle can only filter by **prefix**, not suffix — and images live intermixed with JSON in the same `matchId/` folder, so lifecycle can't target images without moving keys.
- A key restructure (images → `images/` prefix) ripples into the marketing-showcase tooling's sibling-derivation (`imageKey.replace(/\/report\.png$/, "/match.json")`), the `ai-pipeline/final-image.png` write, and still needs a one-time purge of old-path images. Higher blast radius for a pure storage-cost win.
- A suffix-prune job needs **zero app code changes**, keeps the key layout intact, and its **first run reclaims the existing ~130 GiB** automatically.

**Home: Temporal schedule** (`packages/temporal`). Precedent: `bugsink-housekeeping` (destructive maintenance schedule — deletes old events). The report-only rule applies only to the AI `agentTaskWorkflow` subsystem, not to ordinary schedules. Worker already runs in-cluster with SeaweedFS S3 env wired.

### Safety (from code map)

- Images are **never served from S3**: Discord uses in-memory `attachment://` (the `s3://` return is discarded); the marketing site serves bundled files; the frontend review tool + JSON importer/query filter to `.json` and ignore images. Deleting old images breaks no user-facing link.
- Only persisted image key is `ReportRun.imageS3Key` (the `reports/` prefix, **out of scope** — not pruned), and serving reconstructs the key from IDs anyway.

## Scope

- **Prune:** objects under `games/` and `prematch/` whose key ends in `.png` or `.svg` and whose `LastModified` is older than **30 days**, in **both** `scout-prod` and `scout-beta`.
- **Keep untouched:** all `.json`; the `reports/` and `leaderboards/` prefixes (tiny, current-state / DB-referenced); `failed-validations/` (JSON only).
- Objects are write-once, so `LastModified` ≈ the date in the key → 30 days = an accurate ~1-month window.

## Plan

### Phase 0 — Validate load-bearing assumption (before building) — ✅ DONE

- [x] **Credential: worker already has full access.** SeaweedFS runs a single identity `scout` with global `Admin, Read, Write, List, Tagging`. The Temporal worker's `AWS_ACCESS_KEY_ID` (from `temporal-temporal-worker-1p`) maps to that `scout` identity → it already has Write(delete)+Read+List on both `scout-prod` and `scout-beta`. **Phase 2 credential wiring is NOT needed; no deployment change.**
- [x] **Filter logic validated e2e** against live data with the local `seaweedfs` profile (read-only count, cutoff 2026-06-03):
  - Would delete now (png/svg >30d): **38,415 obj / 104.6 GiB** (prod 27,908 / 77.1 GiB; beta 10,507 / 27.5 GiB)
  - Kept recent images (<30d): 13,456 obj / 34.1 GiB — ages out on subsequent runs
  - Kept JSON: 54,510 obj / 28.0 GiB
  - Steady state ≈ 62 GiB (34 GiB rolling images + 28 GiB JSON), down from 167 GiB.

### Phase 1 — Activity + workflow + schedule (`packages/temporal`) — ✅ DONE

- [x] Added `@aws-sdk/client-s3@^3.1001.0` to `packages/temporal/package.json` (matches scout backend; temporal's hand-rolled SigV4 `src/shared/s3.ts` is PUT-only, so the SDK is the lower-risk choice for list+delete).
- [x] `src/activities/scout-image-gc.ts` — `pruneScoutImages({ retentionDays, dryRun })`: per bucket × prefix, paginate `ListObjectsV2`, filter via pure `isPrunableImage` (suffix ∈ {.png,.svg} ∧ `LastModified < cutoff`), `DeleteObjects` in batches of 1000, per-page heartbeat. Returns per-bucket + totals. `dryRun` counts but issues no deletes. Fails fast on missing `S3_ENDPOINT`/creds. Client uses `forcePathStyle: true` + explicit env creds.
- [x] `src/activities/scout-image-gc.test.ts` — 8 unit tests on the predicate (png/svg/ai-pipeline pruned, json + recent + boundary + undefined kept, custom suffixes).
- [x] `src/workflows/scout-image-gc.ts` — thin workflow (`import type` only, so aws-sdk stays out of the deterministic bundle); exported from `workflows/index.ts`; activity spread into `activities/index.ts`.
- [x] Registered `scout-image-gc-daily` in `register-schedules.ts`: `cron "0 4 * * *"` (PT, after the 03:00 bugsink/zfs window), `TASK_QUEUES.DEFAULT`, `overlap: SKIP`, `workflowExecutionTimeout: 65m` (fits the activity's full 3 × `startToClose: 20m` retry budget + backoff, so a slow-but-failing first attempt can't starve retries), `args: [{ retentionDays: 30, dryRun: false }]`. Added workflow to the `WORKFLOWS_WITHOUT_LONG_SLEEPS` allow-list in `register-schedules.test.ts`.

**Verification (all green):** typecheck 0 errors; eslint clean; new unit test 8/8; full `src/activities` 255/255; `src/schedules` + `src/workflows` 59/59; workflow bundle compiles (2.50 MB, no aws-sdk in sandbox).

**End-to-end validation against live data (Phase 0 oracle cross-check):** ran the real `@aws-sdk` `ListObjectsV2` pagination + the activity's exported `isPrunableImage` against live SeaweedFS (dry-run, no deletes). Result **38,415 objects / 104.6 GiB**, an exact match to the independent `aws-cli` count (prod 27,908/77.1 GiB, beta 10,507/27.5 GiB). The list+filter path is proven; only `DeleteObjects` against SeaweedFS remains, gated behind the Phase 3 dry-run.

### Phase 2 — Credential wiring — ❌ NOT NEEDED

Phase 0 showed the worker's existing `scout` identity already has Admin on both buckets. No `OnePasswordItem` or `worker.ts` change.

### Phase 3 — Deploy + one-time reclaim

- [ ] Ship via GitOps (ArgoCD). After the worker picks up the new schedule, **trigger the workflow once manually with `dryRun: true`**, eyeball the counts/bytes, then trigger once with `dryRun: false` to reclaim the ~130 GiB immediately (rather than waiting for the nightly run).
- [ ] Confirm reclaim via `aws s3 ls --summarize` and SeaweedFS volume count (target: well under the 360-`maxVolumes` cap; scout currently ~167 slots — `seaweedfs.ts` comment).

## Session Log — 2026-07-03

### Done

- Analysis: scout SeaweedFS usage 167 GiB (prod 121.5 / beta 45.3); ~83% is png+svg. Confirmed images are never served from S3 (Discord `attachment://`, bundled site, JSON-only readers) so pruning is safe.
- Chose scheduled prune-by-suffix over native lifecycle / key-restructure; home = Temporal schedule (precedent `bugsink-housekeeping`).
- Phase 0: validated worker's `scout` identity has Admin on both buckets (no cred wiring needed) + validated filter against live data.
- Phase 1: built activity + workflow + schedule + tests (files under `packages/temporal/src/...`), added `@aws-sdk/client-s3` dep. All local checks green; end-to-end list+filter cross-checked against the aws-cli oracle (exact 38,415 / 104.6 GiB).
- Branch `feature/scout-s3-image-gc`.

### Remaining

- Open PR, get CI green, merge (deploys the schedule via GitOps/ArgoCD on the Temporal worker).
- **Phase 3 (post-merge):** trigger `runScoutImageGcWorkflow` once with `dryRun: true`, eyeball counts, then once with `dryRun: false` to reclaim ~105 GiB immediately (don't wait for the 04:00 nightly). Verify via `aws s3 ls --summarize` + SeaweedFS volume count. SeaweedFS volume GC is async (`garbageThreshold: 0.3`) so disk frees after its own pass.

### Caveats

- `DeleteObjects` against SeaweedFS is the one path not yet exercised — the dry-run trigger is the gate before the real run.
- Retention 30 days ⇒ steady state ~62 GiB (34 GiB rolling images + 28 GiB JSON). The <30d images (34 GiB) age out over subsequent nightly runs, not on the first run.
- `reports/` and `leaderboards/` images are intentionally NOT pruned (tiny, DB-referenced / current-state).

## Risks / caveats

- **Irreversible deletion.** Mitigated by dry-run-first on the initial run and the fact that images aren't served from S3.
- SeaweedFS volume GC is async (`garbageThreshold: 0.3`) — disk space frees after its own GC pass, not instantly on delete.
- First run lists ~110k objects across two buckets; ensure the activity paginates and the workflow timeout covers it.
- **Marketing-showcase interaction (found 2026-07-19).** The showcase manifest
  (`packages/scout-for-lol/showcase/marketing-showcase.manifest.json`)
  references specific `report.png`/`loading-screen.png` keys that the
  `scout-showcase-refresh-weekly` job re-reads indefinitely; a month of GC had
  pruned ~60% of them (rare queue types never produce replacements). Fixed by
  a showcase exemption in `scout-image-gc.ts`: the activity fetches the
  manifest from `main` before pruning and never deletes a referenced key
  (fails loudly if the manifest can't be fetched). The pruned sources were
  restored byte-identically from the committed showcase PNGs (the generator
  copies S3 bytes verbatim for `s3-image` entries).
