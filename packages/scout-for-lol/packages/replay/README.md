# @scout-for-lol/replay

Browser replay session ownership, verified rendering-package resources, and the
engine boundary used by Scout. Import `createReplaySession` from the package root.
It accepts a mounted canvas, the original ROFL `ArrayBuffer`, a manifest URL and
its SHA-256, an optional abort signal, and an optional state listener. It resolves
only after the engine presents a decoded replay world.

Native readiness requires ten unique, nonnegative safe participant IDs, five
players on each team, and finite replay timing. Participant ID zero is valid.
Scout's public player also compares the rendered full duration against the
validated container duration at millisecond precision and disposes mismatches.

The returned session provides play, pause, seeking, playback rate, camera,
perspective, resizing, state subscriptions and disposal. Session state comes from
the engine; this package does not synthesize gameplay or advance a second clock.
Engines can expose presentation capabilities to limit the player's perspective,
directed camera, and speed controls. Engines with `panCamera` accept drag
displacements in CSS pixels while in free mode. Selecting free mode again
resets the view to the overview. Engines can also expose zoom steps, a
digest-verified minimap URL, and `moveCameraToMap` for normalized minimap
coordinates. Their `cameraView` places the camera target on the minimap and
reports the zoom limits. Share links carry the replay clock, perspective,
and followed participant.
An engine with recorded score evidence may expose `state.scoreboard` at the
current replay clock. The saved terrain engine uses the latest available player
checkpoint for team kills and participant K/D/A and level. Individual values
are `null` when unavailable. A recorded winner appears only at the final replay
clock and clears when seeking backward.
Engines with verified champion fields can also expose optional `health`,
`resource`, and `gold` on each player. `gold` is the recorded amount currently
held. `resource` describes current and maximum primary ability resource.
When `inventory` is present, it contains the seven playable slots in recorded
order. A `null` slot marks an observed empty slot. Item icons use the replay
resource loader and share the session's disposal lifetime.
Abort and disposal terminate owned workers and release generated resource URLs.
Disposal also drops engine and resource references, so a retained disposed
session does not retain its rendering graph or original replay input. Startup
and abort preserve their original cause even if an engine disposer throws.
An explicit `dispose()` still reports cleanup failures after releasing resources.
`subscribeErrors` reports the first fatal renderer error, including a failure
that arrives before the subscriber attaches. `ReplayRuntimeError` preserves the
original message and `cause`. Native engine factories receive a required
`onError` callback. Startup failures reject creation; later failures dispose the
owned session and notify subscribers. Unsubscribed or disposed owners cannot
receive stale worker failures.

The native package manifest is defined by the domain `replay-support.ts`
contract. Each resource has an explicit path, byte length and digest. Responses
are streamed within those bounds before use. Engine entrypoints are self-contained
bundles exporting `createReplayEngine`, and workers are self-contained module
bundles. Engines receive the verified resource loader instead of global asset
paths. Heavy engine code loads only when playback is requested.

Engine bytes are verified before importing their immutable same-origin URL.
This relies on the published package's immutable storage boundary: native import
performs its own request. It preserves Scout's `script-src 'self'` policy rather
than enabling Blob scripts. Owned module workers may use Blob URLs under the
existing worker policy. Resource and manifest hashes do not establish native
fidelity; native comparison admission remains a separate backend contract.

`@scout-for-lol/replay/research` exposes `createResearchReplaySession` for explicit
local regression use. It mounts the actual extracted 16.21 partial renderer through
a caller-owned first-party lazy import and verifies the selected static root's
hash. That root already closes its resource inventory. Callers supply the original
container duration; an optional decoded window must fit within it. The adapter
checks the renderer's declared coverage and first-frame duration before readiness.
For a whole-container request, reconstruction also counts every original transport
stream and retains the declared integer-millisecond duration separately from the
observed packet end. A tail whose original float timestamp rounds to that same
declared millisecond is retained unchanged; a genuinely later tail rejects. This
is an explicit research window policy, not a recovered native footer-rounding
rule. Partial windows keep their strict requested boundary.
The local demo defaults to a 120-second window while whole-match browser memory
and seeking remain separate acceptance gates. Presentation remains partial, with
free/follow cameras, omniscient preview and no audio. Directed camera and team
vision reject as unavailable. The engine validates its exact selected map and
prepared resource graph before declaring its first frame.
The extracted graph requires the same-origin `/assets/` root; other asset roots
are rejected before renderer or worker allocation.
It cannot qualify a native rendering package or claim current-patch support.

`@scout-for-lol/replay/scene` renders normalized participant frames supplied by a
caller. Use `parseReplaySceneTrace` to validate the arena dimensions, timeline,
participant references, and per-frame visibility, then pass the trace and a
mounted canvas to `createReplaySceneSession`. Seeking displays the last recorded
frame at or before the requested time by default. Pass `sampling: "exact"` for
discrete observations. The renderer draws actors only at recorded timestamps in
that mode and clears the markers between observations. Supply a decoded
`background` image if it covers the full trace rectangle in the same coordinate
system. The session draws it beneath the actors with the same view transform.
Callers with decoded movement can supply `sampleFrame(timeSeconds)` to return a
frame at the session clock. The session applies perspective and follow to those
sampled actors.
The caller owns the image's lifetime. The Scout app's Storybook exercises this
session through the shared player with a synthetic trace. To render the same
sampled clock through another canvas renderer, supply a `presentation` with
draw, resize, and dispose methods. The session passes the visible actors and
the ID of any visible focus target, and owns the renderer's disposal. ROFL
decoding and public playback readiness still use the verified rendering-package
contract.

`@scout-for-lol/replay/observations` reads recorded combat and lifecycle facts
for the observed 16.23 build and protocol pairs. Pass the original ROFL
`ArrayBuffer` and a caller-owned decompressor to `decodeReplayObservations`.
The result keeps recorded clocks, participant bindings, and unresolved
identities. Optional channels report unavailable evidence as `null`.
`createReplayObservationActorSampler` uses verified level and return evidence to
sample player state at an exact replay time, including cumulative K/D/A for
bound actors. `createReplayObservationKdaTimeline` projects the same verified
combat data to stable scoreboard slots and integer-millisecond checkpoints.
It works independently of level and return evidence and leaves unresolved
players’ K/D/A unavailable. The caller owns worker execution and presentation.
`createReplayObservationEliminations` pairs opposing participants within a
single recorded combat clock. It emits a pair only when that side has one
unique killer, one unique victim, and both participants are bound to the roster.
Native scene readiness continues to use the verified rendering-package contract.

`@scout-for-lol/replay/packets` provides the recorded packet reader for the
observed 16.23 build and protocol pairs. `createReplayPacketReader` builds a
keyframe index from the original ROFL `ArrayBuffer` and a caller-owned
decompressor. `read(timeSeconds, { signal })` selects the last recorded keyframe
at or before the request, then yields its snapshot and ordered gameplay packets
through that time. The seek range ends at the validated replay footer duration.
Keep the original buffer attached and unchanged for the reader’s lifetime and
treat yielded payload views as read-only. Cancellation is checked between packet
reads. Packet payload interpretation and scene readiness remain the engine’s
responsibility.

Use `prepareReplayForSeek` from `@scout-for-lol/replay/prepare` when the same
player needs both observations and indexed seeks. It builds the packet reader
and observations in one traversal of the original bytes. `readTurretState`
uses the collected snapshot bits and corroborated loss times without expanding
another chunk. The result contains only turrets with verified loss records.
Each row includes the selected keyframe’s observed state and the requested
time’s state from the loss history. Missing and tied snapshot markers stay
unknown. Geometry belongs to the scene engine.

Run `bun run test`, `bun run typecheck` and `bun run lint` from this workspace.
The lifecycle tests use controlled engine adapters; actual rendering requires
the exact research source and prepared assets and separate browser verification.
