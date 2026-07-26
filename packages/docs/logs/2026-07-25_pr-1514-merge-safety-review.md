---
id: pr-1514-merge-safety-review
type: log
status: in-progress
board: false
verification: human
disposition: active
---

# Driving PR #1514 (scout S3-canonical drop) gate — beta done, prod blocked

Question that started it: is <https://github.com/shepherdjerred/monorepo/pull/1514>
safe to merge? → became "drive the beta+prod completeness/parity gate to green."

PR #1514 (PR-B) adds an **irreversible 7-table `DROP TABLE` migration** that scout
**auto-applies on deploy** (`prisma migrate deploy`). Gated on: S3 must hold 100% of
the raw match/prematch JSON (0 gaps) on **beta AND prod** before the drop. Two-PR
split (PR-A #1512 merged 2026-07-19) exists so the gate can read `Stored*.rawJson`
while the tables still exist.

## Deploy model recap (scout)

- **Beta** = continuous; every green main build auto-bumps the
  `shepherdjerred/scout-for-lol/beta` pin (`packages/homelab/src/cdk8s/src/versions.ts`)
  via version-commit-back.
- **Prod** = promotion-gated; promotion = bumping the `.../prod` pin to a minted
  `2.0.0-<n>` tag@digest (Renovate PR merge, or manual pin edit). Prod auto-applies
  migrations on deploy.
- Cluster: single node `torvalds`, kube context `admin@torvalds`. Scout DB is a
  **rollback-journal SQLite** (`/data/db.sqlite`) on RWO ZFS PVC `scout-storage-claim`.

## Gate mechanics

Two scripts in `packages/scout-for-lol/packages/backend/scripts/` (added by PR-A,
**deleted by PR-B**), run via `kubectl exec` in the backend pod (needs `DATABASE_URL`,
`S3_BUCKET_NAME`, `AWS_*`):

- `backfill-report-store-to-s3.ts [--dry-run]` — completeness gate; HEADs each
  `StoredMatch`/`StoredPrematch`/`StoredMatchTimeline` S3 key, uploads `rawJson` if
  missing. Matches+prematch must reach **0 gaps** (exit 1 otherwise). Read-only in `--dry-run`.
- `report-lake-rebuild-parity.ts` — rebuilds the lake from SQLite AND from S3, DuckDB
  `EXCEPT` content diff. Asserts strict equality both directions.

## BETA — GATE PASSED ✅

Live beta DB (rollback-journal, 4.26 GB, continuous ingest) → reads time out under
write-lock contention (P1008/P2010; even the app's own `metrics-usage` was timing out).
Fix: **froze ingest** — disabled ArgoCD auto-sync on the `scout-beta` Application
(`automated:{}` → `null`; restored after), scaled `scout-beta-scout-backend` to 0, ran
the gate in a throwaway **gate pod** (`scout-beta-gate`, cloned from the deployment pod
template, command `sleep infinity`, mounts the PVC). Clean shutdown → no journal →
consistent DB, queries instant.

- Counts: StoredMatch **5803**, StoredPrematch **3337**, StoredMatchTimeline **4966**.
- Completeness dry-run: **139 gaps** (128 matches + 11 prematch, all pre-S3-era; 0
  unrecoverable). Ran backfill **live** → uploaded 128+11 (+1 timeline). Re-run dry-run:
  **✅ 0 gaps**.
- Parity: strict-equality "failed" but **benignly** — `sqliteOnly = 0` for matches AND
  prematch (S3 reproduces 100% of SQLite content). All S3-only rows are **post-cutover
  matches** (PR-A made ingest S3-only on the 2026-07-19 cutover; `StoredMatch` newest =
  `NA1_5604746747`; every S3-only sample matchId is numerically newer). **S3 is a clean
  superset ⇒ dropping beta's tables loses nothing.** The parity gate can't strictly pass
  post-cutover — its dual-write premise was retired by PR-A itself; the load-bearing
  property (nothing in SQLite missing from S3) holds.
- **Beta restored**: gate pod deleted, backend scaled to 1, ArgoCD auto-sync re-enabled,
  backend Ready + ingesting. (Restore delayed ~7 min by the Kyverno incident below.)

## PROD — BLOCKED (S3 fix not built yet)

- Prod **has PR-A**: `GIT_SHA cc46611ce` (45 commits past PR-A). Cut over to S3-only
  ingest ~**2026-07-24T23:28** (newest `StoredMatch` write; ~22h idle since). Counts:
  StoredMatch **16824**, StoredPrematch **9235**. Some rows have `gameCreationAt` = epoch
  0 (1970) — key-derivation still consistent with the live write path.
- **LIVE PROD INCIDENT (known to owner, fix in flight): intermittent
  `SignatureDoesNotMatch` on S3 match.json writes.** 30 failures vs 2 successes in a 2000-line
  window; ≥6 distinct matches; `EUW1_7929766809` (118 KB) failed ≥3× across polls. PR-A's
  cursor-gating works ("NOT advancing cursor; will retry") so no silent loss, but prod
  match ingestion is largely **stalled**. Beta build (6088) shows 0 — but that's low
  sample, not a fix (beta build has no S3 storage change vs prod).
- **The S3 fix = PR #1633** ("fix(bugsink): remediate Scout writes…", commit `b5d9deb79`,
  merged 2026-07-25 19:40) — only post-PR-A change to `s3-helpers.ts`.
- **No promotable image contains #1633 yet.** Latest built/pinned tag = `2.0.0-6088`
  (`d27c2fb06` = #1627, merged 17:35) — PRE-fix. Latest main build **#6174 (#1639 CI
  overhaul) FAILED** 22:49; **owner is getting main green**. Until main is green and a
  post-#1633 build mints a tag, there is nothing fix-inclusive to promote prod to.
  (Promoting prod to 6088 now would NOT fix the signature bug.)

## Two footguns if PR-1514 merges before prod is gated

1. Merging #1514 to `main` **arms the prod drop**: the next prod promotion — including
   the one to pick up the #1633 S3 fix — carries the drop migration too, dropping prod's
   tables with the prod gate never run.
2. #1514 **deletes the gate scripts** from `main`, so only a **pre-1514 prod build** can
   run the prod gate. Run the prod gate from a pre-1514 prod pod before any prod promotion.

## Safe order to finish

1. (owner) main green → post-#1633 build mints a fix-inclusive `2.0.0-<n>` tag.
2. Promote prod to that (pre-1514) tag → prod gets the S3 fix; confirm signature errors
   gone + ingestion catches up.
3. Run prod completeness backfill against **live prod** (no freeze needed — `StoredMatch`
   is frozen; only lock-contention, handle with retries) → **0 gaps**.
4. Rebase + un-draft + merge #1514 → beta deploys, drops 7 tables → **validate beta**:
   tables gone + reports/competition leaderboards still render from S3.
5. Promote prod again (post-1514) → prod drops. (Prod gate from step 3 must predate this.)

## Kyverno incident (separate, pre-existing)

`kyverno-admission-controller` was `CrashLoopBackOff` (261 restarts/6d17h), exiting
cleanly (exit 0, graceful shutdown ~every 30–70s — likely liveness/lease, not OOM; node
healthy at 25% CPU). Its `validate.kyverno.svc-fail` webhook is **fail-closed**, so during
down-windows it blocked all pod create/delete cluster-wide — delayed beta's restore ~7 min.
**PR #1641 ("remove kyverno") merged 22:44** today, so this is being addressed.

## Session Log — 2026-07-25

### Done

- Confirmed PR-A (#1512) deployed to **beta** (2.0.0-6088) and **prod** (GIT_SHA cc46611ce).
- **Beta gate PASSED**: 139 gaps found → backfilled live → 0 gaps confirmed; parity shows
  S3 is a content-identical superset (`sqliteOnly=0`). Beta safe to drop.
- Beta fully restored (backend Ready, ArgoCD auto-sync re-enabled, gate pod removed).
- Diagnosed the live prod `SignatureDoesNotMatch` ingest incident and identified its fix
  (PR #1633) + that no built tag contains it yet.
- No prod changes made; PR #1514 left draft/unmerged.

### Remaining

- (owner) Get main green so a post-#1633 build mints a fix-inclusive scout tag.
- Promote prod to that tag; verify S3 signature errors clear + ingestion catches up.
- Run prod completeness gate against live prod → 0 gaps.
- Rebase/un-draft/merge #1514 → validate beta post-drop → promote prod (drop) last.

### Caveats

- Merging #1514 arms the prod drop for the next promotion AND deletes the gate scripts —
  gate prod from a **pre-1514** pod BEFORE promoting prod post-1514.
- Parity gate cannot strictly pass post-cutover (S3 legitimately a superset); the real
  safety property is `sqliteOnly=0` + 0 completeness gaps. Owner accepted this for beta.
- Prod backfill PUTs will keep failing until the #1633 S3 fix is on prod — run the prod
  gate only after prod has the fix.
- Beta's 0 signature errors is low-sample, not proof beta is immune to the S3 bug.

## Workflow Friction

- Running the gate against the hot rollback-journal SQLite is impractical (reads time
  out under live ingest). The gate scripts' header says "run via kubectl exec into the
  backend pod" but omit that you must **quiesce ingest** (freeze via ArgoCD auto-sync
  disable + scale to 0 + a sleep gate pod) to get a consistent, contention-free read.
  Worth adding to the scout AGENTS.md / gate script docstrings.
- The gate pod delete + backend restore were blocked ~7 min by the fail-closed Kyverno
  webhook during a down-window — a cluster-wide hazard for any pod op. (Being removed in #1641.)
