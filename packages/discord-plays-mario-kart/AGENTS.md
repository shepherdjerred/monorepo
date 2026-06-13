# discord-plays-mario-kart — agent notes

Headless MK64 (N64Wasm: parallel-n64 + angrylion) streamed to Discord; up to 4
people drive seats P1–P4 from a React web UI over Socket.IO. See `README.md` for
the architecture; this file is the quick orientation for agents.

## The ROM (not in the repo)

The MK64 ROM is **copyrighted** and the repo is **public** with a 5 MB
per-file pre-commit limit, so it is never committed (not even encrypted). The
canonical copy lives in Syncthing at **`~/syncthing/Sync/roms/mariokart64.z64`**
(replicated across the owner's machines). Everything that needs it resolves the
path the same way (`resolveRom()` in `packages/backend/scripts/lib/harness.ts`):

1. explicit `--rom <path>` / first positional arg
2. `MK64_ROM` env var
3. the Syncthing default above

Production gets the ROM via a one-time `kubectl cp` onto the ROM PVC (README →
One-time provisioning); the deployed pod does not fetch it.

## Test harness (`packages/backend/scripts/`)

Manual, ROM-gated (never CI). The unit tests (`*.test.ts`, run in CI) remain the
automated gate; these harnesses are for driving the real game.

- **`e2e-scenario.ts`** (`bun run e2e:scenario`) — drive the game to a named
  scenario and optionally screenshot it. `bun run e2e:scenario` with no args
  lists scenarios (`menu`, `1p`–`4p`). Flags: `--rom`, `--shot out.png`,
  `--names a,b,c,d`, `--watch` (log state transitions). This regenerates the
  1p–4p leaderboard overlay screenshots.
- **`e2e-race.ts`** (`bun run e2e:race`) — stream raw RDRAM globals while the
  attract demo / `start-mash` runs; the tool for validating the `mk64-memory.ts`
  address map.
- **`e2e-input.ts`** / **`e2e-input-assert.ts`** — prove a web keypress reaches
  the game (frame-hash diff).
- **`lib/harness.ts`** — reusable primitives: `resolveRom`, `bootEmulator`
  (sprint mode, deterministic per-tick), `driveUntil({schedule, until,
timeoutFrames, onTick})`, `captureScreenshot({path, names, screenMode})`.
- **`lib/scenarios.ts`** — scenarios as data (input schedules + reach
  predicates). **Add a scenario by adding an entry here.**

**Menu-nav gotcha:** multiplayer character select blocks until _every_ seat
presses A — the schedules mirror A onto all N controllers. Drive into a race by:
tap START to the GAME SELECT menu → press RIGHT (seats−1) times to pick the
N-player column → mirror A on all seats through char/course select into racing.

## Conventions

- Bun only; strict TS; no `as` casts; no `.then/.catch` (use async/await); Bun
  APIs over `node:fs`; `max-params` ≤ 4 (bundle into an opts object).
- Scenario screenshots: white-on-black labels are channel-symmetric, so the
  stream-overlay primitives (`src/overlay/`) render correctly on the RGBA
  screenshot path too — `captureScreenshot` reuses them directly.
