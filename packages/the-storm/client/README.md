# Minecraft preview client

This developer tool controls a rendered Minecraft 26.2 client connected to a
disposable local Paper server. The Fabric mod has its own Gradle build and is
never included in TheStorm.jar. The Bun launcher reuses The Storm's pinned
server harness, creates a separate client game directory, and keeps the
control sockets in a private temporary directory.

Run commands from `packages/the-storm`. Java 25, the repository's Gradle and Bun
pins, Docker, and an available graphical desktop are required. The dedicated
development client uses the offline name `StormPreview` (Gradle property
`previewUsername` overrides it); no launcher account or normal Prism instance is
read or changed. The mc-harness daemon also runs this client against its
sandboxes as `toolkit mc client` (see `packages/mc-harness/README.md`).

## Start a preview

```sh
bun run client preview
bun run client preview --world '/path/to/local/world'
```

The default profile prepares the full gameplay fixtures. `--world` copies the
source world into the disposable server; it never writes back to the source.
Use `--vanilla` for a minimal server with gameplay modules disabled.

The launcher prints the path to `session.json` when the player joins. In a
second terminal, pass that path with `--session`. The session's socket
addresses are valid only while the preview is running. Ctrl-C or the `stop`
command closes this session's client and server. Screenshots, command
transcripts, and logs remain under `.cache/client/<session>/`.

## Inspect and control

```sh
bun run client status --session <session.json>
bun run client viewpoint --session <session.json> --args '{"name":"market"}'
bun run client capture --session <session.json> --args '{"name":"market"}'
bun run client look --session <session.json> --args '{"yaw":180,"pitch":20}'
bun run client input --session <session.json> --args '{"buttons":["forward","jump"],"ticks":20}'
bun run client hotbar --session <session.json> --args '{"slot":0}'
bun run client use --session <session.json>
bun run client attack --session <session.json>
bun run client inventory --session <session.json> --args '{"open":true}'
bun run client close --session <session.json>
bun run client release --session <session.json>
bun run client command --session <session.json> --args '{"text":"arena join settlement"}'
bun run client stop --session <session.json>
```

`status` reports position, orientation, health, hunger, inventory item names and
components, the targeted block or entity, and the current screen and container.
`use` and `attack` operate on the crosshair target through ordinary game APIs.
Commands omit the leading slash and run as the preview player on its local
server.

Input buttons are `forward`, `back`, `left`, `right`, `jump`, `sneak`, `sprint`,
`attack`, and `use`. A request holds them for 1–100 client ticks, then releases
them. Closing its controller connection, opening a screen, dying, or issuing
`release` cancels the input. An overlapping input request is rejected. Hotbar
slots use indices 0–8.

To click a container, first inspect its `containerId`, `stateId`, and `slots`:

```sh
bun run client click --session <session.json> --args '{"containerId":1,"stateId":0,"slot":0,"button":0,"mode":"quick_move"}'
bun run client inventory --session <session.json> --args '{"open":false}'
```

Replace the example IDs with those from the current status. A stale container
or state is rejected. Modes are `pickup` and `quick_move`; mouse buttons are
0 (left) and 1 (right). Screenshot names contain letters, numbers, underscores,
or hyphens, and the completed response gives the PNG path.

`close` dismisses the current screen through its ordinary close action, including
the first-arrival dialog. Named viewpoints live in `tools/client/viewpoints.json`. `tour` captures the
lobby, market, mystery box, and foundry. This tool supplies scripted inputs and
inspection; it does not implement autonomous navigation or a full-match player.

## Record rendered footage

Place a spectator observer at the desired viewpoint in the owned sandbox's
visible windowed preview, close
all screens, and release scripted inputs. Arm the camera before starting the
event to be recorded:

```sh
bun run client video-arm --session <session.json> --args '{"name":"duel-red","frames":900,"fov":70}'
bun run client video-status --session <session.json>
bun run client video-start --session <session.json>
bun run client video-status --session <session.json>
```

Wait for `READY` before `video-start`, then for `COMPLETE` before encoding. The
camera stays at the observer's current position and orientation. Capture hides
the HUD, entity nameplates and below-name scores, and restores the previous HUD,
FOV, view bobbing, camera settings and window size when it finishes. The owned
window is sized using its measured pixel scale so high-DPI displays also render
exactly 1280×720 pixels. Ordinary clients without
a preview session leave these render hooks inactive. Camera control requests
are rejected while a capture owns the observer; `video-cancel` or `release`
cancels it.

The recorder samples actual 1280×720 framebuffer images at 30 fps. A 900-frame
run yields a 30-second clip; the limit is 1800 frames. It fails if a live sampling
slot is missed, the bounded image writer overloads, the camera or world changes,
or a screen or HUD becomes visible. Each original PNG has an index, monotonic
sampling time, observed camera, world tick and SHA-256 in `frames.json`. Names
must be unique: the frame directory and receipt use exclusive creation, and a
cancelled or failed recording remains explicitly incomplete.

```sh
bun run client video-encode --args '{"receipt":"/absolute/path/to/duel-red/frames.json"}'
```

Encoding requires `ffmpeg` and `ffprobe`. It validates every original frame and
sampling slot, checks all hashes before and after encoding, and verifies the
video's dimensions, rate, frame count, duration and lack of audio. It retains
the PNGs and writes `clip.mp4`, an exclusive encoding claim, and a `video.json`
receipt binding the video to the original frame receipt. These are unaccepted
capture artifacts. Binding the first 600 live duel ticks, retaining an early
terminal frame, and assembling the full pilot review schedule belong to the
preference collector.

The language-neutral capture inventory is `src/main/resources/storm-video.json`;
Java record checks and Bun boundary validation enforce it.

## Verify the helper

The pinned Loom build merges the verified Minecraft inputs into a local dependency.
The final archive processor sorts its entries, fixes timestamps, removes ZIP
extras and comments, and stores entries without compression so that macOS and Linux produce
the same checksum. Locks and strict verification metadata include that generated
dependency alongside the upstream artifacts.

Loom 1.17.21's public `addJarProcessor` compatibility hook is deliberately used
because it runs after the built-in processors; the newer processor hook runs
before built-ins that rewrite archive metadata. Check this ordering and API when
upgrading Loom, and change the processor ID when changing the archive recipe.
Refresh the generated dependency lock and checksum only after fresh builds on
both platforms produce identical archives with unchanged file contents.

```sh
bun run check:client
bun run test:client
bun run test:client-native
bun run client preview --vanilla --verify
```

The first two commands run Java quality checks and Java/Bun unit tests.
`test:client-native` uses Fabric's real-client framework to inspect a loaded
world, capture its inventory screen, record an actual frame, and verify
capture cancellation, HUD restoration and rejection of missed sampling slots.
GameTest renders once per 20 Hz tick; the full 900-frame, 30 fps recording check
runs in the ordinary client through `preview --vanilla --verify`, which checks
movement, input cancellation, hotbar selection, barrel interaction, item transfer, stale clicks, melee attacks, and
screenshots and an encoded 30-second recording through the actual socket bridge,
then closes the preview.
`preview --verify` also captures the four Settlement viewpoints.

The wire contract is versioned newline-delimited JSON. Requests contain
`version`, `id`, `action`, and `arguments`; responses repeat the version and ID
with either `ok: true, result` or `ok: false, error`. Java and Bun validate the
shared `protocol-fixtures.json`. Socket I/O runs outside the client tick; game
actions execute on the client thread. The bridge accepts at most 32 pending
requests and 64 KiB per request. Normal clients without the launcher's session
bootstrap leave the mod inactive.
