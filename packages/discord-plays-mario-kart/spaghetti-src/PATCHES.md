# SpaghettiKart patches

`upstream.json` pins [HarbourMasters/SpaghettiKart](https://github.com/HarbourMasters/SpaghettiKart),
the native PC port of the Mario Kart 64 decompilation. The upstream tree is not
committed. `scripts/build-spaghetti.ts` clones the pinned commit and its
`libultraship` and `torch` submodules into `.cache/spaghetti/src/`, then applies
these patches with `patch -p1`, in order.

The first two patches let a host process drive the game headlessly over a
Unix socket. They replace the wasm emulator's input, frame, audio and RAM-read
surfaces. Without `--host-socket`, the game behaves exactly like upstream. The
last two make the game's own save writes crash-safe.

SpaghettiKart has no license file, while libultraship and Torch are MIT. This
repo vendors only the pin and these patches, never the upstream source.

## 0001-libultraship-host-capture

Changes to the engine library (`libultraship/`):

- `Interpreter::SetFrameCapture` hands each drawn game frame to the host as
  BGRA, top row first. The frame is read from the game framebuffer right after
  the game's display list runs and before ImGui draws, so menus and overlays
  never reach the stream. `forceOffscreen` renders into that framebuffer even
  when it matches the window, so capture never depends on a visible window.
- `GfxRenderingAPI::ReadFramebufferBGRA8` is implemented for OpenGL only. It
  skips the row flip for framebuffers that are already rendered Y-inverted.
- CVar `gHostBridge.Unpaced` disables the backend's wall-clock frame sleep, so
  a lockstep host sets the pace.
- CVar `gHostBridge.HiddenWindow` creates the SDL window hidden.
- CVar `gHostBridge.FixedSchedule` keeps the frame pacer on a fixed schedule.
  Upstream re-bases each deadline on the actual wake time and forgives only
  1 ms of oversleep. In a VM that drift cut 30 fps to about 27.

## 0002-host-bridge

Changes to the game (`src/`):

- `src/port/HostBridge.{h,cpp}` holds the wire protocol and its
  implementation. `HostBridge.h` is the format reference. Messages are
  little-endian `u32 type, u32 length, payload`:
  - Host to game: `INPUT` (sequence number plus four pads), `STEP`, `RESET`,
    `QUIT`, `RUN_PACED`.
  - Game to host: `HELLO`, `FRAME` (one per draw), `AUDIO` (s16 stereo at
    26 800 Hz), `STATE` (one per game frame).
- `HostBridge_ConfigureEngine` forces the settings the bridge needs, before the
  window exists: OpenGL, 640×480, no HiDPI scaling, the null audio device, no
  vsync, the chosen output fps (30 or 60, with the port's interpolation), skip
  to the title screen, and no MSAA or internal scaling.
- `read_controllers()` latches the host's newest input into all four pads and,
  in lockstep, first waits for a `STEP`. The host owns all four ports:
  `gControllerBits` reports four controllers, so the 2–4P menus are selectable.
- After each game frame, the bridge sends a `STATE` record. It carries the
  same fields the backend's RDRAM reader takes from the wasm core: gamestate,
  race state, menu, screen mode, player count, mode, course, and per-player
  flags, rank, character, timer and race-complete.
- Audio is sized to the nominal 26 800 Hz per game frame, not the playback
  device's fill level, so it tracks game time in both paced and lockstep mode.
- `RESET` reuses upstream's `CM_RequestReset` (the in-game reset).

## 0003-libultraship-durable-eeprom

`libultra/os_eeprom.cpp` writes `default.sav` (the 4 Kbit EEPROM: cups,
records, settings) through a sibling temp file that is fsynced and renamed over
the target, then fsyncs the directory. Upstream reopened the file with `wb`,
so a crash mid-write left it truncated and the game reinitialized the save. A
partial write into an existing save that cannot be read whole now fails
instead of zero-filling the rest, and out-of-range addresses are rejected.

## 0004-durable-controller-pak

`src/port/pak.cpp` (controller-pak ghosts) writes the header and pak files the
same atomic way. Upstream reopened them with `w+b` for every write, which
truncated the shared header (wiping every other file's entry) and zeroed the
rest of a pak file around a partial write. Writes now update only their own
range of the existing file.

## Regenerating

Edit the files in `.cache/spaghetti/src/` and rebuild with
`bun run build:spaghetti`, then export the patches from the package directory:

```bash
C=.cache/spaghetti/src
EEPROM=src/libultraship/libultra/os_eeprom.cpp
git -C $C/libultraship diff --src-prefix=a/libultraship/ --dst-prefix=b/libultraship/ \
  -- . ":!$EEPROM" > spaghetti-src/patches/0001-libultraship-host-capture.patch
git -C $C add -N src/port/HostBridge.h src/port/HostBridge.cpp
git -C $C diff -- src ':!src/port/pak.cpp' > spaghetti-src/patches/0002-host-bridge.patch
git -C $C/libultraship diff --src-prefix=a/libultraship/ --dst-prefix=b/libultraship/ \
  -- "$EEPROM" > spaghetti-src/patches/0003-libultraship-durable-eeprom.patch
git -C $C diff -- src/port/pak.cpp > spaghetti-src/patches/0004-durable-controller-pak.patch
```

Rerunning `build:spaghetti` resets the checkout to the pin and reapplies the
exported patches, which proves they apply cleanly.
