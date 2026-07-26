---
id: log-2026-07-25-mac-ci-nosleep
type: log
status: in-progress
board: false
---

# Mac Mini Buildkite agent — never-sleep fix + doc refresh

Continuation of `plans/2026-07-03_mac-mini-buildkite-agent.md`. User picked this
back up ("we had a plan to add a mac mini buildkite node") and flagged the real
blocker: **the Mini keeps falling asleep**, which is fatal for a CI agent.

## Ground truth (verified live, 2026-07-25)

- The plan's original PR **did merge** (#1386 + follow-up `a499a2149`) — the
  07-03 "open the PR" remaining item is done.
- **`macos` queue exists** — `bk queue list <cluster>` shows it (created
  2026-07-06, `dispatch_paused: false`). The Tofu `buildkite_cluster_queue
"macos"` was applied.
- **No macOS agent is currently connected** — `bk agent list` shows only the
  two Linux `default` agents (liskov, amd64/alpine). Note `bk agent list`
  reports only _currently connected_ agents (per the audit runbook,
  `packages/docs/guides/2026-04-04_homelab-audit-runbook.md:340`), so this
  doesn't establish the Mini has _never_ registered — it's equally consistent
  with a prior registration that dropped off (e.g. slept). Not verified via
  Buildkite audit/event history either way.
- **The CI step regressed out.** `macosSwiftLintStep()` + the `agents.queue`
  field lived in the dynamic generator `scripts/ci/src/steps/per-package.ts`,
  which was wholesale deleted by #1516 (`chore: remove all CI`) when CI was
  replatformed to the static `.buildkite/pipeline.yml`. The macOS step was
  **not** carried over — nothing routes to the `macos` queue today. The only
  surviving `MACOS_CI_ENABLED` reference was a stale echo in `bootstrap.sh`.
- Session ran on `Jerreds-MacBook-Pro`, **not** the Mini — so bootstrap can't be
  run against the Mini from here; the on-Mini steps are handed to the operator.

## Changes (branch `feature/mac-ci-nosleep`)

- `packages/homelab/mac-ci/bootstrap.sh` — new **section 4: power management**.
  `sudo pmset -a sleep 0 disksleep 0 displaysleep 0 powernap 0 womp 1
autorestart 1` — the root-cause fix for the sleep problem. Renumbered the
  agent-start to section 5; replaced the stale `MACOS_CI_ENABLED` final-step
  echo with a pointer to wiring a macos-queue step.
- `packages/homelab/mac-ci/README.md` — removed the stale "CI removed / pending
  teardown" banner (Buildkite is back as a static pipeline); documented the
  `pmset` power layer; rewrote "Activating the first job" to describe adding a
  static-pipeline step (the generator is gone); fixed the teardown note.

## Operator steps to bring the node online (on the Mini)

1. `BUILDKITE_AGENT_TOKEN="$(op read 'op://<vault>/Buildkite Agent Token/<field>')" ./packages/homelab/mac-ci/bootstrap.sh`
   (installs agent + swiftlint + tailscale, applies never-sleep pmset, starts agent).
2. `sudo tailscaled install-system-daemon && sudo tailscale up`.
3. Enable auto-login (System Settings → Users & Groups) for headless reboots.
4. Confirm the agent shows on the `macos` queue: <https://buildkite.com/organizations/sjerred/agents>.

## Deferred (user chose "get the node on Buildkite first")

- Re-wire a macOS SwiftLint (or iOS build / Maestro) step into
  `.buildkite/pipeline.yml` on `agents: { queue: macos }`, `soft_fail: true`,
  gated on `packages/tasks-for-obsidian/ios/**`. Until then the agent is online
  but idle.

## Session Log — 2026-07-25

### Done

- Root-caused the "Mini keeps sleeping" blocker: `bootstrap.sh` never touched
  power management. Added a never-sleep `pmset` section (`sleep 0 disksleep 0
displaysleep 0 powernap 0 womp 1 autorestart 1`).
- Refreshed `mac-ci/README.md` (removed the stale "CI removed / pending
  teardown" banner; documented the pmset layer; rewrote activation for the
  static pipeline; fixed teardown).
- Updated the plan (`plans/2026-07-03_mac-mini-buildkite-agent.md`) Comment Log
  - Remaining with verified current state.
- Draft PR **#1655** (branch `feature/mac-ci-nosleep`, commit `1986b1259`);
  shellcheck + prettier + markdownlint + `verify --affected` all green.

### Remaining

- **Operator (on the Mini):** run `bootstrap.sh` with the 1Password agent token,
  `tailscale up`, enable auto-login, confirm the agent appears on the `macos`
  queue. This is what actually "gets the node on Buildkite" — I can't do it from
  the MacBook.
- Re-wire a macOS step into `.buildkite/pipeline.yml` (deferred by user).

### Caveats

- `pmset` needs sudo; `bootstrap.sh` will prompt when run on the Mini.
- Agent runs as a LaunchAgent (user session) → auto-login is still required for
  unattended reboots even with sleep disabled.
- Prettier gotcha: the root `prettier` npm script is `prettier --check .`, so
  passing a file appends to a whole-repo scan and `bunx prettier` resolves a
  different config than the root binary — check/format single files with
  `./node_modules/.bin/prettier` directly.
