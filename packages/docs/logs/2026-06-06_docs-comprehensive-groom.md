# Comprehensive docs groom — 2026-06-06

## Status

Complete

## Context

Full groom of `packages/docs/`: triage all 90 plans, archive completed+shipped work, fix the stale `index.md`, audit todos and the stable doc categories for staleness/dead links, and verify the todo-marker invariant.

## What was done

### Plans: 90 → 43

- **Archived 35 plans marked `Status: Complete`** to `archive/completed/` (`git mv`, history preserved). Verified a sample against `origin/main` (e.g. pagerduty-alert-denoise PR #1033, cancel-buildkite-builds-on-pr-close, headless-pokeemerald PR #1042, xstate-skill commit `fc97e704f`) — all genuinely merged, including the same-day "Complete (pending deploy/CI/smoke)" ones.
- **Found + archived 11 status-drift plans** — marked `In Progress` / `Partially Complete` but with all plan-scoped work verifiably merged to `main` (confirmed via git history + live checks, e.g. `beta.scout-for-lol.com` and `sjer.red/rss.xml` both returning 200). Each got a `## Status` banner flipping it to **Complete** with the original tracking notes preserved, then `git mv` to `archive/completed/`. These were: bk-dagger-git-url-refactor, main-ci-five-hard-failures, auto-refine-release-please-changelogs, temporal-health-fixes, renovate-481-fixes-and-ci-gap, scout-season-refresh, fix-sjer-red-rss-head-405, scout-app-s3-caddy-migration, temporal-workflow-remediation, birmel-openclaw-capabilities, cooklang-rich-preview-manifest-and-release.
- **Archived the docs-grooming charter plan** (`2026-05-10_docs-grooming-plans-logs-split.md`) — its core deliverable (the `plans/`/`logs/` split) shipped 2026-05-10 and is now codified in AGENTS.md.
- `archive/completed/` grew 20 → 67.

### index.md

- **Plans + Logs sections converted to directory-only links** per the root-CLAUDE.md rule ("do not individually index `plans/`/`logs/`/`todos/`"). The old hand-maintained Plans list was stale (missing ~25 plans) and the "Logs" section linked to `plans/` files that had already been moved — 14 dead links total, all now resolved.
- Added the missing guide entry (`2026-05-22_temporal-post-deploy-quality-checklist.md`).
- Refreshed archive subdir counts (`completed` → 66 at index-write time, now 67; `superseded` → 9).

### Audits (read-only subagents)

- **todos/ (11 files):** all frontmatter valid; filenames match `id:`. No file safely deletable — the five `waiting-on-verification` items are runtime acceptance gates (live cluster/prod), and `large-file-cleanup` + `sjer-red-mta-sts` are genuinely open. Left as-is.
- **guides / decisions / architecture / patterns:** zero broken markdown links; nothing genuinely stale (point-in-time records correctly preserved).
- **Whole-tree link check:** 0 dead markdown links in live docs after the rewrite.

### Verification

- `bun scripts/check-todos.ts` → 0 source markers, 11 doc files, all OK.
- `bunx prettier --check` on all changed docs → clean.
- `bunx markdownlint-cli2` on index + samples → 0 errors (`archive/**` is excluded from lint).

## Remaining / for user decision

- **Archive consolidation — RESOLVED, declined.** The 2026-05-10 charter's deferred idea (delete `archive/stale/`, prune `archive/homelab-audits/`, merge `archive/dagger-migration/` + `archive/on-hold/`) was raised to the user on 2026-06-06 and **declined** — keep the archive intact, honoring the "Archive, don't delete" principle. No further action; future grooms should not re-raise this.
- **todos awaiting live verification:** buildkite-pvc-expansion, grafana-trace-log-prod, helm-types-publish, pagerduty-velero-alert-formatting, scout-migration-competition-update-schedule — code merged, runtime gate unrun. Keep until verified on the cluster/prod.
- **44→43 active plans remain** (Not Started / Planned / genuinely In Progress, e.g. the SOTA PR-review-bot phase cluster). Left in `plans/`.

## Caveats

- Status banners on the 11 drift plans preserve the original wording verbatim below the banner; the verdict came from a read-only subagent cross-checking git + live endpoints, not from re-running each plan's full verification.
- "Complete (pending deploy)" plans were archived because their code is merged; operational deploy/verification follow-ups live in `todos/` where they matter (e.g. `sjer-red-mta-sts`).

## Pass 2 — staleness + consolidation + doc updates (2026-06-06)

Fanned out four read-only audit agents (guides staleness, active-plan obsolescence, consolidation candidates, accuracy/coverage), then executed.

### Plans: 43 → 22

- **Archived 20 more ALREADY-DONE plans** (status drift — shipped to `main` but marked In Progress / Partially Complete; verified via merged PRs e.g. #779, #781, and code on disk) to `archive/completed/` with a banner. Includes the **entire PR-review-bot cluster** (sota + phase-8/10/11 + emit-site-wiring + usefulness-gap-close) — all phase code shipped but the bot is **operationally disabled** (`PR_BOT_ENABLED=false`, commit `3be420074`); re-enable/rate-limit tracked in `todos/pr-review-agent-rate-limit-saturation.md`. Plus the scout competition/rank/marketing/data cluster, github-app-pr-automation, birmel-tool-reliability, bugsink cleanups, temporal-quality-failure-fixes, pagerduty-remediation, trmnl-dashboard-correctness.
- **Archived 1 obsolete plan** → `archive/stale/`: `2026-05-24_temporal-24h-failure-remediation` (one-shot image pin long superseded).
- `archive/completed/` 67 → 87; `archive/stale/` 7 → 8.

### Consolidation

- The flagged PR-review-bot cluster did not need a `plans/pr-review-bot/` subdir after all — every phase had shipped, so the right move was archiving, not regrouping. Same for the scout competition/rank cluster. No active doc was merged; the rest of the tree is already at the right granularity.

### Staleness / accuracy edits (in place)

- **Guides:** `2026-03-08_dotfiles-update` (PAGERDUTY_TOKEN is live, not deleted; corrected secret list + line refs; GH_TOKEN→BUILDKITE_API_TOKEN); `2026-05-05_velero-orphan-snapshot-remediation` (fixed alert names → `VeleroOrphanLocalSnapshots`/`VeleroOrphanLocalBytesExcessive`/`ZFSDatasetSnapshotCountExcessive`, metric `_total` suffixes, removed non-existent R2 alert/metric claims); `2026-04-06_is-commit-deployed` (removed deleted `collect-digests.sh` row).
- **Stable docs:** `architecture/monorepo-structure` (`tools`→`toolkit`); `architecture/release-push-inventory` (7 app images, 27 charts incl. streambot/trmnl, corrected static-sites table, verified-date bump); `patterns/eslint-config` (stale 6700/6893 → per-category `.quality-baseline.json` model); `index.md` archive counts.
- **Active plans (stale-content notes / strikes):** `renovate-blocked-majors` (struck TypeScript 6 — landed); `accelerated-ci-release-please` (dropped archived clauderon); `ci-quality-hardening` + `dagger-ci-infra-fixes` (added stale-content notes — steps moved to `.dagger/src/quality.ts`, clauderon Rust bugs now obsolete).
- **Root `AGENTS.md` structure block:** removed archived `bun-decompile`, added the ~12 missing current packages (home-assistant, llm-observability, monarch, temporal, tasknotes-\*, stocks-sjer-red, trmnl-dashboard, cooklang-\*, leetcode, terraform-provider-asuswrt).

### New coverage docs (architecture)

- `architecture/2026-06-06_temporal-worker-and-scheduler.md` — worker topology, schedules, agent-task scheduler + `/agent-tasks` API, event bridge. Drafted by a code-reading agent, verified.
- `architecture/2026-06-06_scout-web-ui-and-serving.md` — marketing + SPA surfaces, merged bucket build, prod/beta fan-out, caddy-s3proxy routing. Both added to `index.md`.

### Pass-2 remaining

- **Coverage gaps left (med/low):** Discord-Plays-Pokemon headless rewrite, `llm-observability` package, `streambot` ops — flagged by the audit but not written this pass (lower priority; offer outstanding).
- Active plans now 22: genuine Not Started / Planned / In-Progress work (bedrock-waker, ci-reporting/security, opentofu, scout-branded-types, monarch-match-rate, polyrepo-link-audit, tailscale, firmware-runbook, mysa-cap, homekit-vacuum, shared-glitter, move-scripts, etc.).

### Pass-2 verification

- 0 dead markdown links in live docs; `check-todos` clean; prettier + markdownlint clean on all changed/new docs.
