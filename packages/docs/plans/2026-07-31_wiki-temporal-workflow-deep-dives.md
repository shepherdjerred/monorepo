---
id: plan-2026-07-31-wiki-temporal-workflow-deep-dives
type: plan
status: in-progress
board: false
---

# Wiki: per-workflow deep dives for the Temporal section

## Context

PR #1869 (draft, in flight) added the wiki's first section: a general overview
of `packages/temporal` (overview, schedules, agent-tasks, events pages).
Jerred now wants a deep dive into each individual workflow (~33 of them).
Decisions already made with the user via AskUserQuestion:

- **Hybrid layout** — family pages for small workflows + dedicated pages for
  the big ones (PR review pipeline, PR babysit; agent-task runner already has
  `/temporal/agent-tasks/`, which gets deepened instead of duplicated).
- **Intent + flow depth** — per workflow: purpose, trigger, step-by-step flow,
  external systems, key guardrails, the why (~15–30 lines each). Fast-drifting
  mechanics (retry tuning, exact timeouts) stay in code/AGENTS.md.

Three Explore agents deep-read every workflow implementation; their verified
facts are condensed in the Appendix below and are the content source for the
pages.

## Course correction (2026-07-31, mid-implementation)

Main moved between exploration and writing: **#1863 removed the entire PR
review/summary/reaction-listener/babysit bot** (~120 files, its Redis,
dashboards, three task queues), keeping only the merge-conflict check,
Buildkite cancel, review-signal collector, webhook ingress, and the CI
review gate. #1864 split claude/codex agent-task schema dialects; #1865
moved `runAt` deferral to Temporal `startDelay` and added an hourly
`agent-task-timeout-watch` schedule. Caught by URL liveness checks (the
pr-review/pr-babysit source links 404'd on main).

Consequences applied:

- Dropped the planned `pr-review.md` and `pr-babysit.md` dedicated pages.
- `pr-bots.md` covers the three surviving workflows + a short note on the
  removed fleet (linking #1863).
- Inventory table updated (removed rows; added `agent-task-timeout-watch`).
- Overview pages from PR #1869 corrected in THIS branch (queues seven→four,
  PR-bot lists, "no pollers"): #1869 merges with a brief staleness window
  that the stacked PR closes immediately.
- agent-tasks.md gains startDelay + timeout-watch + schema-dialect notes.

## Page inventory

New directory `packages/docs/wiki/src/content/docs/temporal/workflows/`:

| Page                     | Covers                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.md`               | Inventory table: every workflow → section link, trigger, queue, LLM-or-deterministic, output (PR / auto-merge / email / metrics / actuation)     |
| `repo-upkeep.md`         | Shared bot-clone→PR pattern (described once) + fetcher, deps-summary, readme-refresh, llm-catalog-refresh, homelab-crd-imports, pokeemerald-data |
| `scout.md`               | data-dragon (version-check + weekly), season-refresh, showcase-refresh, queue-windows, image-gc                                                  |
| `glitter.md`             | corpus daily + operator variants (inventory/backfill/overlap), context-refresh                                                                   |
| `homelab-maintenance.md` | zfs-maintenance, bugsink-housekeeping, velero-orphan-audit, dns-audit, golink-sync                                                               |
| `home-automation.md`     | Event wiring + presence/debounce model (once) + good-morning ×3, vacuum, welcome-home, leaving-home, reconcile-lock, good-night                  |
| `pr-bots.md`             | Webhook ingress cross-cutting + pr-summary, merge-conflict check, buildkite-cancel, reaction listener, observe-review-signals                    |
| `pr-review.md`           | Dedicated: the 5-specialist × 3-pass review pipeline                                                                                             |
| `pr-babysit.md`          | Dedicated: the durable get-this-green loop                                                                                                       |

Edits to existing pages (from PR #1869):

- `temporal/agent-tasks.md` — add a short "Under the hood" section (provider
  commands, env scoping, content-hash workflow ids, follow-up semantics).
- `temporal/index.md` + `temporal/events.md` + `temporal/schedules.md` — add
  cross-links to the new workflow pages (each family page becomes the "where
  to look next" target).
- `astro.config.ts` — nested sidebar group `Workflows` inside the `Temporal`
  group (Starlight supports nested `items`).

Diagrams (Mermaid, accTitle/accDescr required): pr-review pipeline stages;
pr-babysit assess→decide→act loop; repo-upkeep shared clone→drift→PR flow;
home-automation presence-edge → reconcile-lock signal flow. Other pages stay
prose+lists.

Public-data hygiene (same bar as #1869): no tailnet FQDNs, no 1Password item
IDs, no secrets/tokens; `sjer.red` hostnames and GitHub paths are fine. The
HA report's device/entity specifics (lock, presence persons) are fine to
describe generically ("both residents"), but omit personal names in page
prose where avoidable — use "the two tracked people".

## Execution

1. Reuse the existing worktree `.claude/worktrees/wiki-temporal-surfaces`
   (holds PR #1869's branch). Stack a second branch on top with
   `git-spice branch create feature/wiki-temporal-workflows` so the deep-dive
   PR depends on the overview PR (#1869), per the repo's git-spice stack
   model.
   No — new session, new log: the original investigation
   (committed on the new branch).
2. Write the 9 new pages + 4 edits per the Appendix facts. Follow
   `wiki/AGENTS.md`: frontmatter title+description, no H1, lead with the
   answer, absolute wiki routes, link exact GitHub sources.
3. Liveness-check every GitHub URL written (batch curl → 200).
4. Verify from `packages/docs/wiki/`: `bun run typecheck && bun run test &&
bun run build && bun run test:e2e`.
5. Screenshots (existing scratchpad `shoot-wiki.ts` script, extended to the
   new routes) at 1280px; mobile for one representative page. Upload via
   `toolkit pr asset`.
6. `git-spice stack submit --draft --fill` to open the stacked draft PR;

## Verification

- All four wiki checks green (typecheck/test/build/e2e).
- Rendered screenshots reviewed at desktop + mobile — diagrams legible
  without zooming (rework any squeezed diagram to TD, as in #1869).
- Batch URL liveness check output shows all 200s.
- Hygiene grep over new pages: no `ts.net`, no `1password`/item-id patterns,
  no tokens.

---

## Appendix — verified per-workflow facts (from three deep-read agents)

### Shared patterns (describe once on repo-upkeep.md)

- **Bot-clone + GitHub App PR pattern** (`src/activities/bot-clone.ts`,
  `src/lib/github-app-token.ts`, `openSeasonRefreshPr`): temp clone (depth-1;
  blobless full-history when cog needs commit dates) → short-lived GitHub App
  installation token (RS256 JWT, 9-min TTL, bot attribution) → `bun install
--frozen-lockfile --ignore-scripts` with per-run cache (`--ignore-scripts`
  is load-bearing: root `prepare` arming lefthook broke bot commits weekly
  Jun–Jul 2026) → regenerate → drift via `git status --porcelain` on exact
  generated paths (prettier-normalize → steady state nets to no-diff) →
  `disarmGitHooks` → commit → `--force-with-lease` push → find-or-create PR
  (idempotent). Heartbeats + try/finally cleanup. `rehearse-bot-clone.ts`
  canary runs in `bun run verify`.
- **`claude -p` subprocess pattern**: strips API keys from child env, uses
  `CLAUDE_CODE_OAUTH_TOKEN` (bills subscription); traces `gen_ai` span with
  cost BEFORE exit-code check so failed paid runs are still traced.

### Repo upkeep

- **fetcher** — mirror Better Skill Capped manifest Firestore→S3; `0 5 * * *`;
  fetch+upload in ONE activity (Temporal 2 MiB payload cap); always overwrites.
- **deps-summary** — weekly email of homelab `versions.ts` bumps; `0 9 * * 1`;
  git-log parse keyed on renovate annotations → GitHub release notes →
  gpt-5.6-sol summary → Postal. No PR.
- **readme-refresh** — cog-regen README project tables; `0 8 * * 1`; blobless
  full history (cog sorts by first-commit date); cached `_summary.md` → no
  Codex calls steady-state. Replaced a Buildkite script.
- **llm-catalog-refresh** — cross-check `llm-models/catalog.json` vs
  models.dev + LiteLLM; `0 9 * * 1`; deterministic sync script; its stdout
  report becomes the PR body.
- **homelab-crd-imports** — regen cdk8s CRD imports from LIVE cluster;
  `30 5 * * *`; read-only CRD ClusterRole; exists because CRD drift comes from
  ArgoCD-synced operator bumps that no repo PR touches (CI can't see it).
- **pokeemerald-data** — regen species/map tables from pinned upstream SHA;
  `30 4 * * *`; opens the regen PR the morning after Renovate pin bumps
  (hosted Renovate can't run generators).

### Scout

- **data-dragon** — version-check `0 6 * * 0-5` / weekly-refresh `0 6 * * 6`;
  fast version compare, skip metric if current; else 90-min activity
  downloads ~3500 assets + regenerates snapshots. Image-only diffs suppressed
  (Riot CDN bytes nondeterministic → email, no PR). **Auto-merges**
  (`gh pr merge --auto --merge`).
- **season-refresh** — `0 7 * * 1`; the one agentic upkeep job: `claude -p`
  (claude-opus-5, maxTurns 40, WebSearch) researches season dates (no
  machine-readable feed), strict allowlist of editable files, sentinel
  NO_DRIFT/DRIFTED but real drift computed from `git status`; human-reviewed
  PR, never auto-merged.
- **showcase-refresh** — `0 10 * * 1`; regen marketing PNGs from scout-prod
  S3; `generatedAt`-only diffs suppressed (no churn PRs).
- **queue-windows** — `45 6 * * *`; propose queue-window edits from 21 days of
  match volume; **conditional auto-merge**: open/reopen edits (additive,
  reversible) auto-merge; any `close` disables auto-merge for human
  confirmation; one fixed proposal branch reused; stale PR closed if drift
  vanishes; warnings-only → email.
- **image-gc** — `0 4 * * *`; prune >30-day PNGs/SVGs in scout buckets
  (S3 lifecycle can't filter by suffix); fetches showcase exemption manifest
  first and **refuses to prune if that fetch fails** (a GC once ate 60% of
  showcase sources, 2026-07-19).

### Glitter

- **corpus** — daily `15 4 * * *`, own queue, created PAUSED pending operator
  approval; durable Discord capture: content-addressed immutable S3 pages
  (sha256), global 1 req/s Discord limit via S3 CAS lease; 7-day overlap per
  daily run, full re-backfill after 6 overlaps to bound drift; operator
  variants (inventory → approve → backfill) via `glitter:operate`; dual
  backward+forward traversal verified against each other.
- **context-refresh** — `0 11 * * 1`, own queue, PAUSED; two-stage OpenAI
  (gpt-5.6-luna extract → gpt-5.6-sol synthesize) style cards +
  evidence-cited relationships; **hard cost cap** (`maxEstimatedCostUsd: 10`,
  non-retryable on exhaustion); S3-cached generations so retries don't
  re-pay; full clone validation + changed-path allowlist; never auto-merged.

### Homelab maintenance

- **zfs-maintenance** — Sun 03:00; kubectl exec into the zpool-collector
  DaemonSet (prometheus ns): autotrim on + scrub both pools, skips scrub if
  one is already running; scoped exec Role.
- **bugsink-housekeeping** — daily 03:00; exec into bugsink pod: delete
  events >180d + three vacuums; kubectl (not client WS exec) because Bun
  rejects the WS exec path.
- **velero-orphan-audit** — daily 03:30 (staggered post-backup);
  **detection-only**: lists live Backup CRs, `zfs list` via exec on each
  openebs node, orphan = snapshot with no matching backup; Prometheus gauges
  - runbook pointer. Auto-prune explicitly declined 2026-06-06 (destructive
    automation on backups too risky) — see
    `packages/docs/decisions/2026-05-05_velero-orphan-snapshot-prevention.md`.
- **dns-audit** — daily 06:00; SPF/DMARC/MX checks over hardcoded email +
  parked domain lists via `node:dns`; results to logs/Loki only.
- **golink-sync** — daily 05:00; expected `go/` links derived from Tailscale
  ingresses (ClusterRole read); reconciles create/update/delete but only
  links owned by the worker's tag identity — user-curated links untouched;
  20s fetch timeout lesson from a tailnet ACL outage.

### Home automation

- **Wiring**: worker holds an HA websocket; `ios.action_fired` → good-night;
  `person.*` `state_changed` → signal reconcile-lock first, then edge-route
  welcome-home (arrival) / leaving-home (last departure). Attribute-only GPS
  churn ignored.
- **Presence model**: 90s settle window. Edge workflows: id bucketed by 90s
  tumbling window (REJECT_DUPLICATE) + sleep-90s-and-recheck (exit
  `debounced` on a blip). `shouldLock` = pure "nobody in home zone".
- **good-morning ×3** (preheat/wake/get-up; weekday+weekend schedule pairs;
  CATCHUP_TIGHT): preheat 2h15m before wake heats the bathroom floor only if
  indoor ≤20°C or outdoor ≤15°C (Open-Meteo — HA has no weather integration),
  holds via 13 presence-checked 15-min chunks, aborts early if house empties;
  wake re-asserts heat as fallback, notification + bedroom music + dim scene,
  unconditional thermostat-off after 60m (recovers a failed preheat clear);
  get-up bright scene + joins bathroom speaker. **Why 3 schedules not one
  workflow with sleeps**: independent wall-clock firing, per-phase pausability
  in the UI, tight catchup semantics per phase, wake works standalone.
- **vacuum-if-not-home** — 9am/12pm/5pm; only when everyone away; starts
  idle/docked units, throws non-retryable on anomalous state (can't misreport
  "all active"); concurrent 3-min verify (sequential would blow the timeout).
- **welcome-home** — 90s debounce; first arrival: notify + dock running
  vacuums; every arrival: living-room scene + entry lights if after sunset.
  Lock deliberately NOT actuated here.
- **leaving-home** — last departure; notify, all lights off + per-light
  verify, start vacuums; 20-min timeout (verify overran the 10-min default).
- **reconcile-lock** — the one audible side effect owned by a singleton
  reconciler: every presence edge `signalWithStart`s workflow id
  `reconcile-lock`; a rolling 90s quiet-window (each edge restarts the wait)
  then reads LIVE occupancy + lock state and actuates only if
  current ≠ desired. Replaced edge-triggered lock/unlock workflows that
  could audibly unlock-then-lock on a single flap. No bias direction —
  desired state is a pure function of settled live state.
- **good-night** — iOS shortcut, one per day (daykey id); dim scene if light
  on, sleep playlist with gentle 9-step volume ramp; no presence guard
  (explicit user action).

### PR bots (family page)

- Cross-cutting: HMAC-verified webhook ingress :9466; per-queue workers so a
  slow LLM stage can't head-of-line-block; GitHub App tokens everywhere.
- **pr-summary** — cheap claude-haiku-4-5 SDK stream, ≤$0.10 target, marker
  comment, own queue; commitSha-keyed id REJECT_DUPLICATE.
- **merge-conflict check** — push-to-main → all open PRs; PR events → one PR;
  local bare-workdir `git merge-tree --write-tree` (never GitHub `mergeable`);
  posts required `ci/merge-conflict` status; TERMINATE_EXISTING so newer push
  supersedes.
- **buildkite-cancel** — PR closed → cancel active builds on head branch;
  4xx benign, 5xx retried; bot PRs deliberately included (Renovate churn).
- **reaction-listener** — boot-started singleton, 96×15-min iterations then
  continue-as-new; ingests 👎 (weight 1.0) + closed-without-fix (0.5) into
  the Redis dismissal store the review pipeline dedupes against.
- **observe-review-signals** — cron `0 */6`; snapshots review-provider state
  for ~30 recent PRs using the SAME `@shepherdjerred/code-review` model as
  the CI review-gate; NDJSON to S3 keyed by Temporal run id (retry
  overwrites); metrics only after upload.

### pr-review.md (dedicated)

5 specialists × 3 passes: correctness/security/perf on claude-opus-5 (high
effort), convention/deps on claude-sonnet-5 (medium). Stages: lifecycle
status → bootstrap (file list, AGENTS.md hierarchy, tree-sitter workdir; skip

> 200 files) → deterministic signals (versions.ts image-tag HEAD checks) ∥
> specialist fan-out → consensus (site-key clustering `path|line/7`; keep iff
> ≥2/3 passes in one specialist OR ≥2 specialist kinds OR verifier-backed
> ≥0.9) → empirical verify (each finding declares a verifier —
> typecheck/eslint/grep/test/container-image; contradicted → dropped, verifier
> error → kept unverified: never hide a bug) → embedding dedupe vs dismissed
> findings (Redis + Voyage, fails open) → post (inline review; gated by
> `PR_REVIEW_POST_ENABLED`, default OFF → dry-run) → metrics/track. Id includes
> commitSha, REJECT_DUPLICATE. Prompt-caching: frozen system block +
> per-(specialist,pass) file permutation. Stops fan-out on provider-limit
> errors. The why: consensus + empirical verification are the false-positive
> reducers; deterministic signals catch what LLMs can't (registry HEAD checks).

### pr-babysit.md (dedicated)

One durable workflow per PR (`signalWithStart` + USE_EXISTING), started by
commenting `@temporal-worker …` (authz by owner-association; silent ignore
otherwise; fork PRs refused). Loop: deterministic DoD assess (gh pr checks
with soft-failure allowlist, real local `git merge-tree`, unresolved review
threads ≥P3; fails closed if required contexts unknowable) → decide
(done/wait/act/standdown/closed) → act = one mutating `claude -p` iteration
(edits+commits locally; the activity pushes — origin is the only durable
handoff; agent self-report advisory only) → wait on webhook signals
(ciCompleted, branchPushed, reviewActivity, mainAdvanced, guidance, stop) —
no polling. Guidance question blocks up to 24h. continue-as-new every 20
iterations carrying budget state. Budget: 12 iterations / 360 min / $20 /
stuck-signature standdown after 3 repeats / max 3 consecutive failures.
Subprocess env is an allowlist; `ANTHROPIC_API_KEY` never forwarded
(prompt-injection exfiltration defense). `PR_BABYSIT_ENABLED` default off.

### agent-tasks.md additions

Provider commands: claude `-p --output-format stream-json --json-schema …
--allowed-tools Bash,Read,Grep,Glob,WebFetch --model claude-opus-5` (result
from `structured_output`); codex `exec --sandbox read-only --json
--output-schema … --model gpt-5.6-sol`. Env scoping: `GH_TOKEN` = fresh
installation token; `GITHUB_APP_*` stripped; claude gets OAuth token, no API
key. One-off id = title + content-hash (REJECT_DUPLICATE + FAIL). Follow-up:
one report-only task max; `cancelCron` pauses (never deletes) and only with
`allowSelfCancel`. gen_ai span before exit-code check.
