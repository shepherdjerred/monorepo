# Arcade

One Discord application hosts game sessions through a dedicated streaming-account
pool. Games share authentication, voice admission, account leases, media transport,
and persistence. Each game owns its runtime adapter and browser presentation.

| Game            | Runtime                      | Controls                          | Statistics                                            |
| --------------- | ---------------------------- | --------------------------------- | ----------------------------------------------------- |
| Mario Kart 64   | SpaghettiKart native decomp  | Four N64 ports                    | Race history, placements, course records              |
| Pokémon Emerald | Existing decomp WASM runtime | Shared commands and bounded goals | Party, progress, milestones                           |
| Mario Kart Wii  | WebCompiled WASM/WebGPU      | Four GameCube ports               | Race history, placements, vehicles, course records    |
| Smash Melee     | OpenSmash decomp WASM/WebGPU | Four GameCube ports               | Match history, placements, KOs, falls, self-destructs |
| Smash Brawl     | Patched headless Dolphin/EGL | Four GameCube ports               | Match history, placements, KOs, falls, self-destructs |

The server owns controller seats. A seat belongs to a signed-in browser socket
in the session's voice channel; leaving voice or disconnecting clears its input.
Players receive a separate browser feed. Spectators watch Discord Go-Live.
Public room pages and statistics remain readable after a session stops.

There is one save writer per server and game, one session per voice channel,
and at most two sessions overall. Wii, Melee, and Brawl share one heavy-session
slot. A new session snapshots the game's save entries before starting.
Only the starter or a server moderator can stop a session.

Results freeze Discord attribution at the start of a race or match. Completed
results are deduplicated by round ID; CPU players, aborted rounds, team fights,
and kart battles do not enter detailed standings. Unobserved values are nullable.
Brawl's live clock and score are unavailable rather than inferred from KOs.

## Package APIs

`GameServerModule` in `packages/backend/src/games/module.ts` defines runtime,
input, save, screenshot, and telemetry behavior. `GameClientModule` in
`packages/frontend/src/games/module.ts` defines the game's browser panels.
The common package owns catalog, input, telemetry, statistics, and wire schemas.
Add a game to the server registry and client registry together.

Native producers send bounded RGBA, stereo PCM, and validated telemetry over
the private ARCD bridge. `runtimes/wire.json` generates the TypeScript and C++
definitions. WASM runs in owned headless Chromium profiles; Dolphin renders
through surfaceless EGL. Neither requires a desktop or display server.
Shutdown flushes game state and waits for media teardown before returning the
streaming account to the pool.

## Contributor commands

Run from the repository root:

```sh
bun install --frozen-lockfile
bunx turbo run generate
bunx turbo run build typecheck test lint --filter='@arcade/*' --filter=@shepherdjerred/arcade
docker buildx bake arcade --set '*.platform=linux/amd64'
```

`config.example.toml` describes non-secret configuration. `ARCADE_CONFIG_PATH`
selects that file; Discord OAuth credentials and existing game credentials use
the established secret bootstrap. Rollout and account ownership default off.

Private WASM builds use `runtimes/prepare-assets.py --help`. The script accepts
a dedicated clean checkout of the pinned upstream, an Emscripten SDK, and an
operator-owned dump. Melee uses NTSC-U 1.02; Wii uses clean PAL RMCP01 because
that upstream translator targets PAL addresses. Brawl requires RSBE01 revision 2.
Build outputs and disc dumps stay outside Git and container images.

Assets live under `runtimeAssets/{mk64,emerald,mkwii,melee,brawl}`. MK64 expects
`rom.z64`, Emerald expects `pokeemerald.wasm`, and newer games require the
preparation script's checksum manifest. Saves live under
`stateRoot/<game>/<guild>`. The database is separate from saves.

The homelab chart runs one controller. The legacy MK64 and Emerald deployments
stay at zero replicas with their original claims retained for rollback. The
existing Mario Kart edge forwards public and tailnet requests to Arcade, keeping
the registered Discord OAuth callback. The old Pokébot addresses redirect to that
canonical origin. Flipt controls session and game rollout.
Account handover and rollback use the wiki's Arcade migration guide. Source tests
do not replace real-game controller, audio/video, latency, and concurrent-session acceptance.

ROM-gated media acceptance can run without Discord accounts:

```sh
bun packages/arcade/packages/backend/src/runtime/probe.ts --game melee --assets /private/arcade/assets --output /private/arcade/probe --seconds 30
```

The probe writes a screenshot and bounded observations. It exercises the raw
runtime bridge; full broadcast, statistics, and controller acceptance require
the active Arcade application in the beta environment.
