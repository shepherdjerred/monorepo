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

## Session Log — 2026-07-26

### Done

- Preserved the exact pre-bootstrap AC power settings before applying the
  always-on profile and added `packages/homelab/mac-ci/restore-power.sh` to
  restore all six changed settings during teardown.

### Remaining

- Run bootstrap and the restore procedure on the physical Mac Mini when it is
  available; neither action can be exercised from this Linux/macOS development
  checkout.

### Caveats

- The restoration script intentionally fails if the saved pre-bootstrap profile
  is absent or malformed rather than guessing system defaults.

## Session Log — 2026-07-26 (Codex review-gate cycle)

### Done

- Addressed 3 P2 Codex findings on PR #1655 at head `2d471e330`:
  - `plans/2026-07-03_mac-mini-buildkite-agent.md` Comment Log/Remaining —
    softened "no macOS agent has ever connected" to "not currently connected"
    (matches the wording already fixed in the README/this log).
  - `mac-ci/README.md` "Activating the first job" — the `if_changed.include`
    example now carries the same global CI/toolchain closure as the
    `playwright-e2e-pr` step (`.buildkite/**`, `.mise.toml`, `bun.lock`,
    `bunfig.toml`, `package.json`, `patches/**`, `turbo.json`) alongside the
    iOS path, so a change to the macOS step itself would still run it.
  - `mac-ci/README.md` same section — pointed at
    `packages/tasks-for-obsidian`'s existing `lint:swift` script (scoped to
    `ios/TasksForObsidian ios/TasksWidget`) instead of a bare
    `swiftlint --strict`, which run from the repo root would also lint the
    155 unrelated Swift files under `sandbox/archive`.
- A prior round of 4 P2/P1 findings (teardown restore scope, `if_changed` vs
  `if:`, per-step required-status pitfall, agent-history inference) had
  already been fixed in `fc5759a71`/`2d471e330`; their threads were stale
  (`isOutdated: true`) and resolved with justification rather than re-fixed.
- Codex's review-at-head signal was flaky on this PR: the first `@codex
review` nudge comment got no 👀 reaction and no review landed for 4.5h
  across two pushes; a second nudge got an immediate 👀 and a review within
  minutes.

- Round 3 (head `251575e`) found 2 more genuine P2s, both fixed:
  - `mac-ci/README.md` — broadened the `if_changed.include` example from
    `packages/tasks-for-obsidian/ios/**` to `packages/tasks-for-obsidian/**`,
    since the `lint:swift` task it would run is defined/configured in
    `package.json`/`turbo.json` at the package root, outside `ios/`.
  - `bootstrap.sh` + `restore-power.sh` — switched `pmset -a` (all power
    sources) to `pmset -c` (charger/AC profile only) in both directions, so
    a Mini with a separately-managed UPS Power profile doesn't get its UPS
    settings silently overwritten by AC-profile values on restore.
  - A round-2 thread (README:100 `if_changed` closure) was left unresolved
    after being fixed in commit `251575e` — resolved retroactively this
    round with a reference to that commit.

- Round 4 (head `18e1624ac`) found 2 more genuine P2s, both fixed:
  - `plans/2026-07-03_mac-mini-buildkite-agent.md` — the "Remaining" item
    still said the macOS step should gate on `.../ios/**`; brought it in
    line with the README's already-fixed `packages/tasks-for-obsidian/**`
    scope.
  - `mac-ci/README.md` — the recommended `lint:swift` package script can't
    actually run on a freshly bootstrapped Mini: `bootstrap.sh` installs
    `swiftlint` but not `bun`. Replaced with a `cd`-scoped raw `swiftlint`
    invocation that only needs what's already installed.

### Remaining

- Push this commit, confirm Codex re-reviews clean at the new head, and
  confirm the `robot-face-review-gate` required check goes green.
- Fleet controller escalated a review-gate bug independently: `pmset`-fix
  round's 👍 signal can't bind to head due to a `fetchHeadPushedAt` null on
  fast-forward; final green is blocked on that decision, not on this PR's docs.

### Caveats

- If Codex drops a future re-review trigger again, re-post `@codex review`
  and confirm the 👀 reaction before assuming the gate will unblock.
- Resolve GitHub review threads immediately after fixing them in the same
  cycle — round 2 left one thread unresolved despite the fix landing, which
  cost an extra round-trip to clean up.
