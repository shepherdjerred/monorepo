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

- **Archive consolidation (needs explicit sign-off — deletes history):** carried over from the 2026-05-10 charter and still open — delete `archive/stale/` (7), prune `archive/homelab-audits/` (keep 1 of 9), merge `archive/dagger-migration/` (18) audit + chunk files, merge `archive/on-hold/` (4) Sentinel docs into 1. Not done this session.
- **todos awaiting live verification:** buildkite-pvc-expansion, grafana-trace-log-prod, helm-types-publish, pagerduty-velero-alert-formatting, scout-migration-competition-update-schedule — code merged, runtime gate unrun. Keep until verified on the cluster/prod.
- **44→43 active plans remain** (Not Started / Planned / genuinely In Progress, e.g. the SOTA PR-review-bot phase cluster). Left in `plans/`.

## Caveats

- Status banners on the 11 drift plans preserve the original wording verbatim below the banner; the verdict came from a read-only subagent cross-checking git + live endpoints, not from re-running each plan's full verification.
- "Complete (pending deploy)" plans were archived because their code is merged; operational deploy/verification follow-ups live in `todos/` where they matter (e.g. `sjer-red-mta-sts`).
