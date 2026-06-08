# Mario Kart 64 — web controller input never reached the game

## Status

Complete (fix committed; needs image rebuild + redeploy to take effect in prod)

## Symptom

On the Mario Kart 64 web controller page you could load the page and see the
Go-Live stream, but pressing keys / clicking the on-screen buttons did nothing
in-game — and input "didn't work well at all."

## Root cause

The headless N64Wasm host injects per-player input by calling
`neil_send_mobile_controls_player()` **before** `_runMainLoop()` each tick
([n64-emulator.ts](../../discord-plays-mario-kart/packages/backend/src/emulator/n64-emulator.ts) `tick()`).

That function (added by `wasm-src/patches/0001-…patch`) wrote straight into the
core's `neilbuttons[player]` array. But `mainLoopInner()` (in upstream
`mymain.cpp`) calls `resetNeilButtons()` near its **top, every frame**, which
zeroes all of `neilbuttons[*]`. It then re-fills them from keyboard/SDL/gamepad,
and from JS **only when `mobileMode` is on** (via `processMobileControls()`,
which runs _after_ the reset).

Headless runs with `mobileMode = 0` (see `config-txt.ts`) and has no physical
input devices. So the sequence each frame was:

1. host `send()` sets `neilbuttons[p]`
2. host `_runMainLoop()` → `mainLoopInner()` → `resetNeilButtons()` **wipes it**
3. no mobile/keyboard/gamepad path re-fills it
4. `retro_run()` polls all-zero input

→ every button/steer was silently dropped. Frames still rendered (so the stream
looked fine), which is why it presented as "page works, input does nothing."

The patch's own comment ("the core zeroes `neilbuttons[*]` at frame start, then
polls") encoded the wrong mental model — "polls" reads physical devices, not the
JS-set buffer. The reference smoke test (`run.reference.mjs`) never sent input,
so it never caught this.

## Fix

In `wasm-src/patches/0001-mymain-neil-host-exports.patch`:

- `neil_send_mobile_controls_player()` now only **latches** input into a
  persistent file-scope `g_neilHostPads[4]` (survives `resetNeilButtons()`).
- New `applyHostControls()` copies the latch into `neilbuttons[*]`. It is
  inserted into `mainLoopInner()` **after** all resets and **immediately before**
  `retro_run()`, so the core actually polls the host input.
- The host JS API is unchanged (still call `send()` once per tick before
  `_runMainLoop()`); ordering within the frame is now handled in C.

Verified: `bash packages/discord-plays-mario-kart/scripts/build-wasm.sh`
compiles cleanly (emscripten/emsdk:2.0.7) and produces `n64wasm.js`/`.wasm`.

## Session Log — 2026-06-07

### Done

- Root-caused dropped input to `resetNeilButtons()` wiping host-injected
  `neilbuttons[*]` before `retro_run()`.
- Rewrote `neil_send_mobile_controls_player()` to latch + added
  `applyHostControls()` in `wasm-src/patches/0001-mymain-neil-host-exports.patch`.
  Verified the patch applies to the pristine tree and the WASM compiles.
- Updated `wasm-src/PATCHES.md` and the `tick()` comment in
  `packages/backend/src/emulator/n64-emulator.ts` to document the latch model.

### Remaining

- **Deploy:** the WASM is built inside the Dagger image (assets are gitignored,
  not committed). The fix only reaches prod after the image rebuilds and
  redeploys via the normal GitOps flow.
- **In-game verification:** not done here — the MK64 ROM is provided at runtime
  and is not in the repo, so end-to-end "press A advances the menu" was not
  exercised locally. Confirm on the live deployment (P1 first; MK64 only reads
  ports 2–4 in-race).

### Caveats

- The frontend (`packages/frontend/src/app.tsx`) looked correct; the "doesn't
  work well" symptom was the same dropped-input bug seen from the UI side. No
  frontend change was needed.
- `applyHostControls()` runs even when `showOverlay` is true (it's placed after
  the overlay reset). That's intended for headless — the host always drives the
  game — but worth knowing if an overlay/menu mode is added later.

## Session Log — 2026-06-07 (part 2: e2e verification + tests)

### Done

- **Proved the fix end-to-end with the real ROM** (`~/Downloads/Mario Kart 64
(USA).z64`): booting the real `N64Emulator`, holding START on the title screen
  advances to the **GAME SELECT** menu; baseline (no input) stays on the title.
  Baseline is byte-deterministic across runs; START diverges. Earlier "black
  frame" confusion was just boot/transition screens (added luma logging to find
  the title at frame ~1050).
- **Audited + closed the full React→game chain** and added automated coverage:
  - Extracted the browser input mapping to
    [`frontend/src/input-map.ts`](../../discord-plays-mario-kart/packages/frontend/src/input-map.ts)
    (`KEYMAP`/`PADS`/`computeState`) and added
    `frontend/src/input-map.test.ts` (10 tests). Enabled the frontend test
    runner (`"test": "bun test"`) and excluded `*.test.*` from the app tsconfig.
  - Extracted the request dispatch from `index.ts` to
    [`backend/src/webserver/dispatch.ts`](../../discord-plays-mario-kart/packages/backend/src/webserver/dispatch.ts)
    (`handleRequest` + `EmulatorControls`), used by both `index.ts` and tests.
  - Added `backend/src/webserver/dispatch.test.ts`: a **real Socket.IO
    client → createSocket (schema parse) → handleRequest → fake emulator**
    integration test (claim routes input with correct decoded state; seat
    gating; schema rejection; release + disconnect clear input). Added
    `socket.io-client` devDep.
  - Added `backend/src/emulator/constants.test.ts` (BUTTON_ORDER ⇄ ButtonState
    permutation + length === CONTROL_CHARS).
- **Saved the ROM-driven e2e as documented manual scripts**:
  `backend/scripts/e2e-input.ts` (single run + `DUMP_EVERY` PNG dumps) and
  `e2e-input-assert.ts` (baseline vs START, PASS/FAIL). npm scripts:
  `build:wasm`, `e2e:input`, `e2e:input:check`. Documented in the package README
  Testing table.
- Verified: `bun run --filter '*' test` → frontend 10 + backend 12 green;
  eslint clean; backend typecheck clean (mario-kart code).

### Remaining

- **Deploy** still pending (unchanged): WASM builds in the Dagger image; the fix
  reaches prod only after image rebuild + GitOps redeploy.

### Caveats

- The CI test suite covers the whole chain **except** the literal browser
  `addEventListener`/render glue and the actual game pixels — those need a DOM /
  ROM. The game-effect e2e is therefore manual-only (ROM is copyright; the core
  is built in a Dagger stage absent from the test container).
- Local `bun run typecheck` in `backend` reports one error inside the vendored
  `discord-video-stream` source (`Unused '@ts-expect-error'`), unrelated to this
  work — it only appears because that shared lib isn't pre-built in a fresh
  worktree (CI builds it first). Not introduced here.
- `bun install` added `socket.io-client` to the backend; lockfile updated.
