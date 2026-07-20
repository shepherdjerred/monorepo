---
id: plan-2026-07-19-bugsink-triage-followups
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Bugsink Triage Follow-ups: Lockstep Deploys + Bug Fixes

## Context

Today's Bugsink triage session root-caused all 8 open issues (6 distinct causes; full analysis in `packages/docs/logs/2026-07-19_bugsink-open-issues-root-cause.md`). The user dispositioned each item; this plan covers everything actionable that remains:

- **Part A — Scout lockstep stage deploys** (user-confirmed design: prod gets a version pin for the marketing site + SPA; beta stays continuous). Detailed plan already written to `packages/docs/plans/2026-07-19_scout-lockstep-stage-deploys.md`; summarized below.
- **Part B — Two small bug fixes**: streambot interaction double-ack/late-ack (confirmed bug), and the undefined-safe `subscriptionFilterQueues` quick win (defense-in-depth for Part A's rollout window).

Out of scope per user dispositions: bots-down `/app`-vs-`/workspace` outage + userbot token rotation (separate work item), spectator circuit-breaker events (expected signal), OpenAI flagged-prompt (rare), "Load failed" Pinterest-pixel noise (ignore).

## Part B — Quick-fix PR (ship first; independent of Part A)

One small PR, branch off main in a worktree: `fix: error-handling hardening from Bugsink triage` (split into two PRs if preferred at review time — the changes are in unrelated packages).

### B1. Scout: undefined-safe subscription filter helpers

`packages/scout-for-lol/packages/data/src/model/subscription-filter.ts:111` — `subscriptionFilterQueues` guards `spec === null` only; an older backend omitting `filters` crashes the SPA render.

- Change guard to `spec == null` (or explicit `=== null || === undefined`), widen param type to `SubscriptionFilterSpec | null | undefined`.
- Same widening for `summarizeFilters` / `describeSubscriptionFilters` (`packages/app/src/components/subscription-filter-fields.tsx:27` and neighbors) so the types tell the truth.
- Add a unit test: `subscriptionFilterQueues(undefined)` → `[]`.
- Note: repo bans defensive fallbacks for contract violations, but this is a real system boundary (network response from an independently deployed backend version), not a caller-contract bug — the exact case the exception clause covers.

### B2. Streambot: interaction ack hardening

Root cause (session analysis): `packages/streambot/src/discord/command-bot.ts:119` dispatches `void this.safeHandle(interaction)` (no `.catch`); `safeHandle`'s catch block (`command-bot.ts:483-491`) re-acks based on `interaction.replied || interaction.deferred`, which are false when an ack was delivered but the REST call rejected → second `reply()` → 40060 as an unhandled rejection. 10062 = initial defer landing past Discord's 3 s window during event-loop stalls; same catch then re-replies to the dead token.

- Wrap the catch-block ack in its own try/catch: swallow-and-log `DiscordAPIError` codes 40060 and 10062 (tolerable no-ops — the user-facing error message can't be delivered anyway); rethrow anything else.
- Add `.catch()` (log + Sentry capture) to the two fire-and-forget sites: `void this.safeHandle(...)` (`command-bot.ts:119`) and `void handlePaginationClick(...)` (`packages/streambot/src/discord/pagination.ts:66`) so no interaction path can produce an unhandled rejection.
- Do NOT add a global unhandledRejection filter — fix the leaks at the source (repo fail-fast principle).

### B3 (optional, flag at review). Marketing-site Sentry noise filter

User said to ignore the "Load failed" issue itself; this optional one-liner only prevents future noise: broaden `beforeSend` in `packages/scout-for-lol/packages/frontend/src/layouts/Layout.astro:55` (or add `ignoreErrors: [/^TypeError: Load failed$/, /^TypeError: Failed to fetch$/]`) to drop frameless third-party fetch errors. Drop this item if unwanted.

## Part A — Scout lockstep stage deploys (confirmed design)

Full detail with verified file:line anchors, idempotency table, risks: `packages/docs/plans/2026-07-19_scout-lockstep-stage-deploys.md`. Summary:

1. **PR 1 (infra)**: new SeaweedFS bucket `scout-site-releases` + 365d lifecycle in `packages/homelab/src/tofu/seaweedfs/buckets.tf` (copy `public_sjer_red_lifecycle` shape, buckets.tf:148-170). Must land + tofu-apply before PR 2 (SeaweedFS auto-creates buckets on first put → tofu import dance otherwise).
2. **PR 2 (scripts + pipeline + pins + docs)**:
   - Extract `s3SyncStaticSite`/`awsEnv` from `scripts/deploy-site.ts:174-314` → `scripts/lib/s3-static-site.ts`, add `extraExcludes` (protects `.release-version` marker from pass-2 `--delete`).
   - New `scripts/scout-site-release.ts`: `archive` (prod-flavored build → `scout-site-releases/2.0.0-<n>/` + manifest-last), `deploy-beta` (beta flavor → live bucket + marker), `reconcile-prod` (versions.ts pin vs bucket marker; sync from archive only on mismatch; `"unpromoted"` sentinel; fail loudly on missing archive). All with `--dry-run`. Remove both scout entries from the `deploy-site.ts` catalog.
   - New `scripts/promote-scout.ts`: one PR = set `"scout-for-lol-site/prod"` pin + copy the beta image line **verbatim** to prod (images push only `:$GIT_SHA`/`:latest` — the `2.0.0-<n>` tag never exists in GHCR). Guards: pending version-bump PR touching the scout beta line; target older than beta pin requires `--force` (rollback path).
   - `versions.ts`: add site pin `"scout-for-lol-site/prod": "unpromoted"`; **replace the Renovate annotation** on `shepherdjerred/scout-for-lol/prod` (versions.ts:140) with a not-managed comment (Renovate moving the backend alone would break lockstep).
   - `pipeline.yml`: sites step drops scout buckets, gains `archive` + `deploy-beta`; new `scout-prod-reconcile` step (`depends_on: [argocd-sync, sites]`, `concurrency_group: monorepo/site-deploys`) — backend deploys before site, safe transient direction; PR dry-run step rehearses all three subcommands. Re-wires `VITE_SENTRY_RELEASE`/`PUBLIC_SENTRY_RELEASE` (currently read-but-never-set).
   - Docs in the same PR: `packages/scout-for-lol/AGENTS.md` CI/CD section; fix the stale `version-management` skill claim that CI was removed.
3. **First promotion (same day as PR 2)**: `AWS_PROFILE=seaweedfs bun scripts/promote-scout.ts` → review PR (backend 2.0.0-4791 → ~2.0.0-578x) → merge → next build reconciles. Pre-flight: diff backend required env 4791→target vs prod stage wiring (beta-only AI keys `resources/scout/index.ts:173-194` must not be required in prod), confirm Prisma migrations forward-only.

## Sequencing

1. Part B PR (quick fixes) — merges anytime, ideally before the first promotion (B1 protects the rollout window).
2. Part A PR 1 → tofu-apply → Part A PR 2 → first promotion (same day).
3. After fixes deploy: resolve the `filters` and streambot Bugsink issues via the web UI bulk-action form (the canonical API is read-only for issues; resolving before deploy would just re-open as regressions).

## Verification

- **B1**: unit test; `bunx turbo run typecheck test lint --filter=@scout-for-lol/data --filter=@scout-for-lol/app`.
- **B2**: `bunx turbo run typecheck test lint --filter=streambot`; then live-check per the `discord` skill — run a paginated command (`/stream list`) on the real server, click pagination past expiry, confirm no new 40060/10062 events in Bugsink project `streambot` afterward.
- **Part A**: PR dry-run rehearses subcommands; post-merge — beta `curl https://beta.scout-for-lol.com/.release-version` == build version, archive listing shows `<v>/` + `<v>.json`, reconcile logs show sentinel → no-op; post-promotion — `curl https://scout-for-lol.com/.release-version` == promoted version, `kubectl -n scout-prod get deploy` digest == promoted pin, ArgoCD Healthy; rollback drill via `git revert` on a branch.
- Whole-repo: `bun run verify -- --affected` before each push.

## Session Log — 2026-07-19

### Done

- **PR #1564** (`fix/bugsink-triage-hardening`) — Part B: undefined-safe `subscriptionFilterQueues`/`describeSubscriptionFilters`/`summarizeFilters` + unit test; streambot total ack paths (`isStaleInteractionError` in `streambot/src/util/errors.ts`, guarded catch-block ack in `command-bot.ts`, `safePaginationClick` wrapper in `pagination.ts`); marketing-site `ignoreErrors` for frameless network errors (B3, optional — flagged droppable in the PR).
- **PR #1565** (`feat/scout-site-releases-bucket`) — Part A PR 1: `scout-site-releases` bucket + 365d lifecycle in `tofu/seaweedfs/buckets.tf`; `tofu validate`/`fmt` green.
- **PR #1567** (`feat/scout-lockstep-deploys`) — Part A PR 2: `scripts/lib/s3-static-site.ts` (extraction + `extraExcludes`), `scripts/scout-site-release.ts` (archive/deploy-beta/reconcile-prod, all `--dry-run`-capable, smoke-tested), `scripts/promote-scout.ts` (temp-worktree promotion PR flow with guards), `versions.ts` site pin + Renovate-annotation removal on scout prod, pipeline changes (sites step swap, `scout-prod-reconcile` step, PR dry-run rehearsal, Sentry release wiring), scout AGENTS.md + skill fixes (`version-management`, `buildkite-helper` stale "pipeline removed" claims; live `~/.claude/skills` copies synced per chezmoi dual-edit). `bun run verify -- --affected` green.

- **Rework (same day, user feedback):** promotion is now fully CI-driven — commit `00d9612fc` on #1567 adds the `scout promotion PR` step (`promote-scout.ts --ci`) maintaining the standing `scout-promote-pending` PR (opens when beta is ahead via image-line or manifest-gitSha scout-diff gate, closes when caught up). Merging it = promotion; rollback = revert (or operator mode for arbitrary targets). No local runs in the normal path.

### Remaining

- Merge #1564 anytime; merge #1565, wait for tofu-apply, then merge #1567 (strict order for the latter two).
- After one post-#1567 main build: CI opens the standing `scout-promote-pending` PR automatically (promote-scout.ts --ci; reworked 2026-07-19 per user feedback — promotion is now just merging that PR, no local script). First promotion jumps the backend 2.0.0-4791 → current beta; pre-flight before merging it: diff backend required env 4791→target vs prod stage wiring (beta-only AI keys `resources/scout/index.ts:173-194`), confirm Prisma migrations forward-only. Rollback stays operator mode (`promote-scout.ts --version <older> --force`).
- After fixes deploy: resolve the `filters` + streambot Bugsink issues via the web UI (API is read-only for issues).

### Caveats

- Until the first promotion merges, prod site content is frozen at its last pre-#1567 sync (today's skew persists but stops worsening).
- `promote-scout.ts`'s pending-bump guard greps the version-bump PR diff for the beta line; `--allow-pending-bump` overrides deliberately.
- The dotfiles skill edits ship in #1567; `chezmoi apply` on other machines picks them up after merge.

## Remaining

- [ ] Complete and verify the work described in `Bugsink Triage Follow-ups: Lockstep Deploys + Bug Fixes`.
