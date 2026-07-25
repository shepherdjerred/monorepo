---
id: guide-2026-07-19-followup-verification-handoff
type: guide
status: complete
board: false
---

# Follow-up Status & Verification Handoff — 2026-07-19

## Purpose

Handoff for (a) the next agent session and (b) the human operator's verification
pass. The last 60 days of work were enumerated and every follow-up item was
**verified against `origin/main` @ `11b12b465` (2026-07-19), GitHub PR state, npm,
and the live tree** by five parallel checker agents. Doc `Status:` fields were
deliberately distrusted — many were stale (listed in §7).

Companion log (how this was produced): `packages/docs/logs/2026-07-19_60d-retrospective-qa.md`.

Key distinction used throughout: **merged ≠ verified**. "Shipped-unverified" means
the code is on main but no live/prod/human verification is recorded anywhere.

---

## 1. 🔴 Urgent: main CI has never gone green since the replatform

- Last fully-passed main Buildkite build: **5492** (2026-07-12, Dagger era).
- Recent main builds **5789 / 5781 / 5777 / 5773 all failed**; **5802** was running
  on HEAD as of this writing.
- The argocd sync fail-fast fix (PR **#1559**, `6134541d7`) is merged but has
  **never been observed passing** the `tofu apply (cloudflare, after tunnel gate)`
  step. Root cause history: `logs/2026-07-18_ci-green-verify-hardening.md` (orphaned
  seaweedfs TunnelBinding deleted operationally 2026-07-19; prune policy decision
  tracked in `todos/argocd-apps-prune-policy.md`).
- **First action for any session: check the latest main build; drive it green.**

## 2. 🟡 Shipped-but-unverified — the verification checklist

Each row: what shipped, and the concrete verification that has never been recorded.
"Agent" = an agent can drive it; "Operator" = requires the human (prod mutation,
console, physical presence).

| #   | Item                                                | Shipped as                                                              | Outstanding verification                                                                                                                                                                                 | Who                                  |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Turbo remote cache                                  | PR #1526 (merged 2026-07-17)                                            | Prove a REMOTE cache hit: dev double-run + a Buildkite turbo summary showing `REMOTE`. Todo `turbo-cache-rollout` item 2. Optional: `remoteCache.signature` (item 3, currently absent from `turbo.json`) | Agent                                |
| 2   | Cloudflare tofu-apply / argocd fail-fast            | PR #1559                                                                | One green main build (see §1)                                                                                                                                                                            | Agent                                |
| 3   | Streambot F1 stutter fix (`readrate_initial_burst`) | PR #1542 (merged 2026-07-19, verified on test pod only)                 | On the DEPLOYED pod: Avengers @ 1:41 replay, `nodejs_eventloop_lag_p99` check, confirm `-readrate_initial_burst 2.5` in live ffmpeg args                                                                 | Agent + operator eyeballs            |
| 4   | PR babysitter live                                  | Flag `PR_BABYSIT_ENABLED="true"` since PR #1342; heartbeat fix PR #1374 | A recorded live `prBabysitWorkflow` iteration completing (>60s) in prod, e.g. on a throwaway PR. Todo `babysit-phase4-live-retest` (its "flag still false" premise is stale)                             | Agent                                |
| 5   | Scout weekly reports fix                            | PR #1429 (merged 2026-07-11)                                            | Confirm prod `COMMON_DENOMINATOR` weekly reports now show real run history; resolve the related PagerDuty item. Todo `scout-report-backends-verify`                                                      | Agent (read) + operator (PD)         |
| 6   | Scout S3 image GC                                   | PR #1376                                                                | One-time reclaim of ~105–130 GiB was never run (dryRun → real DeleteObjects; note: DeleteObjects against SeaweedFS never exercised). Plan `2026-07-03_scout-s3-image-retention.md` Phase 3               | Operator-approved agent run          |
| 7   | Scout S3-canonical PR-A                             | PR #1512 (merged 2026-07-19T17:50)                                      | Run the beta+prod completeness gate (0 gaps both) — this is what un-drafts PR #1514 (PR-B 7-table drop, currently DRAFT "DO NOT MERGE")                                                                  | Agent (gate) + operator (merge call) |
| 8   | LLM observability                                   | PR #1403 (merged 2026-07-05)                                            | Post-merge Tempo checks: `gen_ai.system="claude_code_cli"` spans after a scheduled task; birmel envelope                                                                                                 | Agent                                |
| 9   | mk64 span propagation                               | PR #1449 (merged 2026-07-12)                                            | Tempo: mk64 spans parent correctly; `streamFfmpeg*` flow visible. Todo `dpc-tracing-context-propagation-check`                                                                                           | Agent                                |
| 10  | dpp goal-mode tracing                               | commit `f36643fed`                                                      | Tempo `pokemon.goal.*` spans + fresh S3 archives after a real goal run. Todo `dpp-goal-trace-post-deploy-verify`                                                                                         | Agent                                |
| 11  | Grafana "Logs for this span"                        | Tempo `tracesToLogsV2` wiring confirmed correct                         | The actual prod click-path (was 0-data when last tried, 2026-06-28). Todo `grafana-trace-log-prod-verification`                                                                                          | Operator (or agent via browser)      |
| 12  | Xcode Cloud alerts                                  | PR #1455 (code + 1P field/snapshot done)                                | App Store Connect webhook registration (external console) — no evidence either way. Plan `2026-07-11_xcode-cloud-alerts.md`                                                                              | Operator                             |
| 13  | Velero PD alert formatting                          | PR #1381 (+helm-template test)                                          | Needs a real velero PagerDuty incident to fire post-fix; none has. Todo `pagerduty-velero-alert-formatting`                                                                                              | Wait/observe                         |
| 14  | Prisma 7 SQLite affinity                            | Migration + regression test on main                                     | Inspect prod `Competition` rows. Todo `scout-prod-prisma-7-affinity`                                                                                                                                     | Operator (prod DB read)              |
| 15  | Orphan `_hydr0o_` guild                             | Bugsink issue resolved                                                  | Delete prod DB rows for guild `1345142904942760018`. Todo `scout-orphan-guild-prod-cleanup`                                                                                                              | Operator (prod mutation)             |
| 16  | Seerr quota fix backups                             | Fix verified by user 2026-07-18                                         | Optional: delete `*.pre-quota-fix` (+ `db.sqlite3.pre-migration`) from `/app/config/db/` on `seerr-pvc`                                                                                                  | Operator                             |

## 3. ✅ Done and live-verified (no action)

- CI parity go-live — PR #1549: required check `buildkite/monorepo/pr` active in
  `packages/homelab/src/tofu/github/rulesets.tf:64` (verified live 2026-07-18);
  Greptile gate decided = **blocking** (`.buildkite/pipeline.yml:354-365`);
  `feature/ci-parity` clause removed.
- HA custom components pinned — PR #1456 + follow-ups; pod recorded healthy
  (`logs/2026-07-11_k8s-pod-triage-...`). Only the multi-day eufy auto-dismiss watch remains.
- Seerr TV request quota fix — user-confirmed working 2026-07-18.
- Tailnet ACLs — PR #1045 (`tofu/tailscale/acl.tf`) + runbook
  `guides/2026-06-06_tailscale-acls-runbook.md`.

## 4. 🔵 In progress (real open work)

- **Scout reporting editor** — PR #1513 OPEN (`feature/scout-reporting-editor`).
- **Scout PR-B fact-table drop** — PR #1514 DRAFT, correctly gated (see §2 row 7).
  Also subsumes `scout-timeline-pvc-growth`.
- **torvalds control-plane restart churn** — partial fix PR #1547 (kyverno webhook
  namespaceSelector excludes + admission sizing). Open: lease-timeout RCA,
  leaseDuration raises, ZFS txg-stall hypothesis, memory overcommit.
- **Tasks-for-Obsidian e2e** — Maestro harness landed (7 flows, PR #1388) but
  local-macOS-only, no CI, not yet agent-runnable.
- **`agentTaskWorkflow` (homelab-audit-daily)** — still broken; no fix commits since
  todo filed 2026-06-28 (`claude -p` exit-1 unaddressed). Todo `active`.
- **CI speed** — core shipped (see §7); explicitly-deferred items remain by design
  (end-state builder spikes, pod-smokes, retry-on-exit-1).

## 5. ⚪ Not started (verified unchanged since filed)

PagerDuty triage's four fixes from `logs/2026-07-19_pagerduty-alert-triage.md`
(qBittorrent.conf `"%I"` quoting; pokemon/mario-kart manifest `/workspace`→`/app`
paths; pipeline artifact glob + deploy-site index.html guard + bucket restore;
service-probes Application) · PagerDuty→Alertmanager migration (prometheus.ts still
pagerduty_configs) · CI capacity implementation (node "liskov" being physically
assembled; registry pull-through cache + Kueue bump unstarted) · Mac Mini BK agent
(deferred) · twisted bump for Locke 805/Zaahen 904 (still ^1.73.0→1.81.0, ids absent)
· Mastra report-query tracing (bare `new Agent` at report-query-agent.ts:88) ·
Arena/ARAM rank labels (bug confirmed at `weekly-update.ts:274-282`) · MK64 worker
thread (fps gate measurement never run) · MK64/Pokemon web-controller auth
(hardcoded identity at dispatch.ts:118) · Pokemon docs site · **NPM publish of
@shepherdjerred/discord-video-stream + discord-stream-lifecycle (both still
`private: true`, npm 404)** · karma rich leaderboards · Birmel test buildout ·
Greptile outside-diff (github.ts:181 diff-anchored only) · PR-review rate-limit +
tree-sitter hardening (zero work since filed) · LLM cost rollup · Temporal Grafana
golden signals · ArgoCD apps prune policy decision · relay key drift check · qbit
H&R `--all` sweep (act-only-if-observed) · litter-robot (physical) · HomeKit refresh
follow-ups (physical/console) · firmware runbook (awaiting approval) · streambot
subtitles-midstream / sports / play-history.

## 6. 🟠 Blocked

**Valid blockers:** velero-plugin-for-aws pin (upstream #299 unreleased; renovate
`<1.14.1` guard in place) · protobufjs v8 (`@temporalio/proto` 1.20.3 still pins
^7.6.4; root override load-bearing) · bun-types undici patch (1.3.14 still lacks
undici-types) · HA econet reauth (upstream Rheem cert, home-assistant/core#172228)
· HomeKit Secure Video (needs Apple device on Seattle LAN) · RN 0.85 context-menu
chain (no compatible upstream release; patch still wired) · torvalds duplicate
TS_AUTHKEY (live-only machine config, gitignored patch).

**Stale blockers — likely actionable now:**

- `todos/overseerr-prune-after-migration.md` — "blocked on PR #1385" but #1385
  MERGED 2026-07-04 and Overseerr is gone from the media tree. Reclassify + do the prune.
- `todos/vite-env-bazel-comment-cleanup.md` — blocker cites `scripts/setup.ts`,
  deleted in the bun-workspace migration (PR #1517). Re-evaluate; edit likely doable.

## 7. 📄 Doc rot — stale Status fields to groom

Mark Complete + `git mv` to `archive/completed/` (work verifiably shipped):

| Doc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reality                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `plans/2026-07-03_scout-subscription-filters.md` ("never PR'd")                                                                                                                                                                                                                                                                                                                                                                                                                                   | Shipped PR #1383, merged 2026-07-03                            |
| `plans/2026-07-11_scout-mute-groups.md` ("In Progress")                                                                                                                                                                                                                                                                                                                                                                                                                                           | Shipped PR #1457, merged 2026-07-11                            |
| `plans/2026-06-28_scout-whatsnew-auto.md` ("PR pending")                                                                                                                                                                                                                                                                                                                                                                                                                                          | Shipped PR #1354                                               |
| `plans/2026-07-03_tasknotes-first-in-class.md` ("P0 in review; P2 next")                                                                                                                                                                                                                                                                                                                                                                                                                          | ALL phases merged: #1388/#1379/#1390/#1391/#1394/#1510 + #1504 |
| `plans/2026-07-03_streambot-game-bot-transition-logging.md` ("In Progress")                                                                                                                                                                                                                                                                                                                                                                                                                       | Shipped PR #1378, merged 2026-07-03                            |
| Update in place (partially stale): `plans/2026-07-18_ci-speed.md` (items 1–5 shipped via #1541/#1544/#1546/#1547/#1548; deferred items remain) · `plans/2026-06-06_homelab-security-hardening.md` (tailnet ACL Remaining shipped via #1045; console/secret steps + PR-1 merge status still open) · `plans/2026-07-11_xcode-cloud-alerts.md` (operator steps 1–2 done, webhook registration open) · `todos/babysit-phase4-live-retest.md` (premise "flag still false" wrong — flag ON since #1342) |                                                                |

**Skills actively misleading (higher priority than doc grooming):** the
`buildkite-helper` skill (chezmoi source `packages/dotfiles/dot_agents/skills/`)
claims "pipeline was removed 2026-07… nothing runs on commit/push/PR; verification
is manual" — **false**; static `.buildkite/pipeline.yml` + required check are live.
The `pr-monitor` / `pr-workflow-automation` skill descriptions carry the same false
"no CI" claim. Rewrite for the static-pipeline reality (remember dual-edit rule:
chezmoi source + live copy).

## 8. 🧹 Worktree cleanup (19 of 26)

From the main checkout: `git worktree remove .claude/worktrees/<name>` + delete branch.

- **Merged PRs (17):** bk-log-secret-hardening(#1539), ci-5656-fixes(#1538),
  ci-gap-fixes(#1549), ci-verify-hardening(#1559), fix-backend-generate(#1551),
  fix-helm-test-timeout(#1553), fix-main-ci(#1534), fix-main-verify(#1523),
  pr-1408-workspace(#1408), pr-1511-lefthook(#1511), pr-1512-s3-engine(#1512),
  pr-1515-scoutql(#1515), pr-1557-data-dragon(#1557), remove-recall(#1540),
  rip-setup(#1517), streambot-pipeline-depth(#1542), turbo-cache-rollout(#1526)
- **Closed PRs (2):** pr-1506-readme(#1506), pr-conflict-log(#1522)
- **KEEP:** pr-1389-asuswrt(#1389), pr-1513-reporting-editor(#1513),
  pr-1514-s3-drop(#1514), pr-924-report-designs(#924), resume-pdf-artifact(#1560),
  ci-speed (unpushed local work on `fix/lint-generate-edge`)
- Note: branches are squash-merged, so `--merged`/ahead-counts lie; judge by PR state.

## 9. Suggested order for the next session

1. Drive main green (§1) — unblocks §2 rows 1–2 and general confidence.
2. Fix the misleading skills + groom the stale docs (§7) — cheap, stops active harm.
3. Agent-drivable verifications (§2 rows 1, 4, 5, 7, 8, 9, 10) — record each result
   in the corresponding todo and resolve it (delete doc) when confirmed.
4. Stale-blocker items (§6) — Overseerr prune, vite-env cleanup.
5. Worktree sweep (§8).
6. Present the operator-only list (§2 rows 3, 6, 11, 12, 14, 15, 16) to the human
   with exact commands/links.
