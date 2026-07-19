---
id: log-2026-06-13-mk64-harness-and-rom
type: log
status: complete
board: false
---

# MK64 manual harness + ROM persistence (Syncthing)

## Context

The leaderboards work left two gaps: (1) the throwaway tooling that drove the emulator to capture the 1p–4p overlay screenshots was deleted, so the multiplayer menu-nav recipe lived only in chat history; (2) the copyrighted ROM had no documented home (a loose `~/Downloads` file locally, manual `kubectl cp` in prod). This session promoted the tooling into a committed harness and gave the ROM a persistent location.

## Decisions

- **ROM lives in Syncthing**, not committed and not SeaweedFS. The repo is **public** with a 5 MB pre-commit file limit, so even an encrypted ROM is out. SeaweedFS was considered (new buckets are private by default — public exposure is a separate Cloudflare-tunnel route) but Syncthing was chosen since the owner already syncs game saves there. Canonical path: `~/syncthing/Sync/roms/mariokart64.z64`.
- **Harnesses stay manual-only.** CI can't reach Syncthing, so no CI ROM-fetch / smoke gate was added; the unit tests remain the CI gate. The deployed pod keeps its `kubectl cp` (Syncthing is just the documented source).

## What shipped

- `packages/backend/scripts/lib/harness.ts` — `resolveRom` (arg → `MK64_ROM` → Syncthing default, fail-fast), `bootEmulator`, `driveUntil({schedule, until, timeoutFrames, onTick})`, `captureScreenshot` (reuses the stream-overlay primitives on the RGBA screenshot path).
- `packages/backend/scripts/lib/scenarios.ts` — `1p/2p/3p/4p/menu` as data (validated menu-nav recipe). Add a scenario by adding an entry.
- `packages/backend/scripts/e2e-scenario.ts` (`bun run e2e:scenario`) — drive to a scenario, print parsed state, `--shot`/`--names`/`--watch`. Regenerates the 1p–4p screenshots.
- Refactored `e2e-race.ts` (trimmed to the RDRAM-map validator) and `e2e-input.ts` onto the shared lib.
- Docs: README ROM/testing sections + new package `AGENTS.md`. Memory: `reference_mk64_rom_and_harness`.

**Menu-nav gotcha (the load-bearing discovery):** multiplayer character select blocks until _every_ seat presses A. Recipe: tap START to GAME SELECT → press RIGHT (seats−1) to the N-player column → mirror A onto all seats through char/course select into racing.

## Session Log — 2026-06-13

### Done

- Committed the harness lib + scenarios + `e2e-scenario.ts`; refactored `e2e-race.ts`/`e2e-input.ts` (PR #1143, commit `0a1263c9d`).
- Verified end-to-end against the real ROM: 1p–4p all reach `racing` with correct human counts/screen modes; 4p screenshot shows all four names in their quadrants; `--watch` logs `menu → staging → racing`; fail-fast prints the Syncthing path.
- Copied the ROM into `~/syncthing/Sync/roms/mariokart64.z64` (SHA-256 verified vs the `~/Downloads` copy); harness resolves it with no flags.
- Applied `[leaderboard] enabled = true` (+ `db_path`, `overlay_enabled`, `poll_every_n_frames`) to the MK64 Config 1Password item's `config.toml` field, at the owner's explicit request.
- Package gates green: `tsc`, `eslint .`, 83 tests.

### Remaining

- Merge PR #1143 and deploy the new image (owner action).
- After merge: remove the `mk64-leaderboards` worktree + branch.

### Caveats

- **The 1Password config edit is armed against the _old_ image.** The deployed image's config schema is a `z.strictObject` without a `leaderboard` key, so it rejects the new section. The running pod reads config only at startup, so it keeps running — but it will **crashloop on its next restart** until the new (leaderboard-aware, `.prefault({})`) image is deployed. Merge + deploy before the mario-kart pod restarts; to un-arm, strip the `[leaderboard]` block back out of the 1P item.
- CI status was not pursued this session (owner said to ignore it).
- Manual harness is ROM-gated and never runs in CI by design.
