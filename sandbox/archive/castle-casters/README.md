# Castle Casters

The original Java/GLFW game of Quoridor with a medieval fantasy theme, created
for Harding University's computer science capstone class. The original maps,
pixel artwork, wizard animations, music, engine, and rules library are retained.
The separate [browser prototype](../castle-casters-web-rewrite) is independent.

## Original project and later completion

Jerred Shepherd created the original Castle Casters for his college capstone,
working from January through April with no prior game engine experience.
His project supplied the custom Java/LWJGL engine, rendering and audio systems,
resource loading, map integration, scenes and menus (including How to Play),
Quoridor board and turn rules, pathfinding, unit tests, and initial AI and
multiplayer implementations. The original project was playable but unfinished.
The fantasy presentation and original asset selection also come from that project;
existing asset and license files are retained.

The later completion and cleanup were implemented with OpenAI Codex at Jerred's
direction. That work added:

- A session layer connecting local humans, remote humans, and AI to the existing
  rules, with two- and four-player lobbies, victory, and rematches.
- Bounded AI search with difficulty settings, cancellation, and fixes to search
  evaluation and rule edge cases.
- An authoritative multiplayer transport with validated commands, snapshots,
  LAN discovery, disconnect handling, and automatic rejoining.
- A new desktop UI using the original engine and assets, with move destinations,
  wall previews and rotation, animations, button states, resizing, and the
  original rules re-presented on a How to Play page.
- Native UI automation, additional rule and network tests, desktop packaging
  scripts, and targeted engine lifecycle and asset-loading fixes.

The current playable entrypoint uses the new `game/desktop/` and `session/`
layers. The earlier scenes and networking code remain in the source tree so the
original implementation is still identifiable. This completion builds on
Jerred's original engine, rules library, and presentation; the additions above
are the Codex-assisted work.

## Build and play

Use the repository's Java 25 and Bun toolchain. Maven is pinned in this directory.
Run these commands from `sandbox/archive/castle-casters`:

```sh
mise install maven
mise exec -- mvn package
mise exec -- bun tools/desktop.ts --run
```

`target/castle-casters-1.0.0-SNAPSHOT-jar-with-dependencies.jar` includes assets
and platform natives. On macOS, Java must run with `-XstartOnFirstThread`; the
launcher scripts supply it. Rendering requires OpenGL 4.1 and audio uses OpenAL.

## Players and controls

Choose **Play locally**, **Host multiplayer**, or **Join multiplayer**.
**How to play** restores the original rules page with the current controls;
use **Back to menu** or Escape to return.
The lobby supports two or four seats with any combination of local humans,
remote humans, and AI. Local humans share a keyboard and mouse. Each caster has
a name and a unique element. Click a name to edit; Enter applies it and Escape
cancels. The host controls the player count, grass/desert/winter map, starting
player, and AI difficulty. The default is a local human against Normal AI on
a 9-by-9 grass board with ten walls each.

- Left click a green destination to move, including legal jumps.
- Select **Place wall** or press **W**, then left click a legal wall preview.
- **R** rotates the wall; **V** selects vertical placement.
- Right click places a wall using the selected orientation.
- **M** selects movement; **Escape** cancels wall placement.
- Reach the opposite edge to win. The host can return to the lobby for a rematch.

Moves, jumping, casting, wall arrival, and hover states animate independently
of the authoritative rules. Drawing and input share a logical viewport with
letterboxing, so window resizing and Retina displays keep their coordinates aligned.
The menu's sound button toggles the original music for the current app session.

## Multiplayer

The desktop host listens on TCP port **35567**. Local discovery uses UDP
**35568**; the join screen also accepts a direct hostname or address, optionally
with `:port`. IPv6 with an explicit port uses `[address]:port`. Share a LAN or
Tailscale address; no central service or account is required. Allow these ports
through the host's firewall when connecting across machines.

Remote players may edit their own lobby seat and submit turns for that seat.
The host validates ownership, active player, legal turns, command identity, and
revision before applying a turn. Snapshots contain presentation data rather than
the engine's object graph. TCP messages have versioned JSON and bounded framing.

A lost remote connection pauses play. The running client automatically rejoins
using an in-memory credential. Restarting that client loses the credential.
The host can replace offline seats with AI or end the session. Host departure
ends play for everyone. There is no host migration or persistent room storage.

## AI

Search runs in a session-owned worker. Results apply only to their starting
revision, and pause, restart, and shutdown cancel outstanding search. Two-player
search uses iterative alpha-beta with a fixed root perspective; four-player
search uses Max-N. Legal turns have stable ordering and immediate wins take priority.

| Difficulty | Time ceiling | Node ceiling | Two-player depth | Four-player depth |
| ---------- | ------------ | ------------ | ---------------- | ----------------- |
| Easy       | 150 ms       | 1,000        | 1                | 1                 |
| Normal     | 750 ms       | 10,000       | 3                | 2                 |
| Hard       | 2,000 ms     | 50,000       | 6                | 3                 |

The last completed iteration determines the move. Deterministic verification
uses the node ceiling without a wall-clock deadline.

## Verification harness

```sh
mise exec -- mvn test
mise exec -- bun tools/harness.ts --hidden
```

The Java tests cover rules, snapshot validation, bounded AI, terminal positions,
two/four-player real socket sessions, authority, reconnection, and worker cleanup.
The Bun runner launches native GLFW applications, injects input through their
real event handlers, waits for state conditions, advances simulation time, and
captures their OpenGL framebuffers. It exercises local play, jumps, walls,
victory/rematch, a complete single-player game, resized input, all three maps,
a complete four-player network game, rejoin, and host departure.
Omit `--hidden` to watch it; keep the test windows free from manual input.
Evidence and logs are written to `target/harness-artifacts`. `--no-build` reuses
compiled classes for iteration.

`HarnessMain` lives in test sources and is excluded from application JARs.
It binds only to loopback (ports 4188–4191 in the runner) and rejects browser
origins. To run it separately, build the classpath with:

```sh
mise exec -- mvn test-compile dependency:build-classpath -Dmdep.outputFile=target/harness-classpath
```

Launch `com.shepherdjerred.castlecasters.harness.HarnessMain` on the combined
`target/classes`, `target/test-classes`, and dependency classpath. Arguments are
HTTP port, `manual` or `realtime`, and optional `hidden`.

| Endpoint           | Contract                                                            |
| ------------------ | ------------------------------------------------------------------- |
| `GET /state`       | Scene, controls, legal moves, animation state, and session snapshot |
| `GET /frame.png`   | Actual rendered framebuffer as PNG                                  |
| `POST /input`      | `move`, `down`, `up`, `keyDown`, `keyUp`, or `text` event           |
| `POST /scenario`   | Named fixture plus seed                                             |
| `POST /step`       | Advance manual simulation by `seconds` (0–30); wait for `settled`   |
| `POST /disconnect` | Interrupt this remote client while retaining its rejoin credential  |
| `POST /resize`     | Resize the native GLFW window using `width` and `height`            |
| `POST /shutdown`   | Close the app and release owned resources                           |

Fixtures: `menu`, `lobby2`, `lobby4`, `board2`, `board4`, `near-victory`,
`jump`, and `diagonal`. Board fixtures use local seats for input determinism.
HTTP requests queue onto the same thread that owns the GL context and session.
Never enqueue more simulated time while `settled` is false.

Native platform acceptance should also run on each target OS before release.

## Desktop bundles

On **macOS arm64** or **Windows x64**, run:

```sh
mise exec -- bun tools/desktop.ts
```

This runs the tests, assembles the game, and uses `jpackage` to produce a
self-contained desktop image with Java bundled. Each build gets an isolated
directory under `target/desktop` and a ZIP containing the `.app` or Windows
app image. Build on the target OS; `jpackage` does not cross-compile.
The initial bundles are unsigned. This command creates local artifacts and
does not publish them.

## Source boundaries

- `logic/`: persistent board state, validators, turn enactment, goals, and path search.
- `ai/BoundedQuoridorAi.java`: bounded search used by desktop sessions.
- `session/`: controller ownership, lobby/match lifecycle, data-only snapshots,
  Netty transport, and LAN discovery.
- `game/desktop/`: original-art presentation, shared viewport/input mapping,
  sound ownership, and session-facing UI.
- `engine/`: the original GLFW/OpenGL event loop and resource loaders.
- `src/test/.../harness/` and `tools/harness.ts`: development-only automation.

The older scene and networking classes remain as historical source; the desktop
entrypoint uses `GameSession`, `SessionHost`, and `SessionClient`.
