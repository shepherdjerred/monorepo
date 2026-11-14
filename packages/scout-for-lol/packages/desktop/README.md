# Scout Client

Pure-Rust desktop observer for League of Legends. The application is a
background tray process with a small native status, pairing, settings, and
diagnostics window, which runs as a separate child process. The window renders
with `egui` by default; a `gpui-kit` window can be selected instead (see
"Window toolkit"). It reads only the local gameplay endpoints declared in
`scout-client-core::lcu::LcuEndpoint` and persists outbound observations in a
SQLite outbox before delivery. Custom and duel games are recognized from an
exact observed roster; League gameflow then advances the bound game without
asking an organizer to provision a special lobby.

Windows x86-64 is the primary distribution target. macOS is supported for
development and regular use. The Settings page can register the current binary
for per-user start at login on either platform.

```bash
mise exec -- cargo run --package scout-client-app
mise exec -- cargo run --package scout-client-app -- --background
bun run test
bun run lint
```

The workspace has five crates:

- `scout-client-core`: LCU access, protocol, outbox, credentials, and
  diagnostics.
- `scout-client-runtime`: the UI-independent collection runtime (pairing,
  observation, upload, history, Clash, and start-at-login registration).
- `scout-desktop-ipc`: the JSON-lines messages between the supervisor and the
  window process.
- `scout-desktop-ui`: the `gpui-kit` window. It is the only crate that depends
  on `gpui-kit` or GPUI (`gpui-pre`), and only on Windows and macOS:
  - `kit/` is the only module that names `gpui_kit`. It wraps components under
    Scout names (`ScoutButton`, `ScoutToggle`, `StatusRow`, `Page`, `NavItem`,
    `Shell`, `theme()`), so a gpui-kit API change stays inside it.
  - `view_model` builds plain structs for each page from the IPC
    `StateSnapshot`, and maps every control to the `WindowMessage` it sends.
  - `link` decodes supervisor lines and writes commands.
  - `tokens` holds theme constants that `build.rs` generates.

  The view models, link and tokens build on every target, so Linux CI builds
  and tests them without GUI libraries.

- `scout-client-app`: the `scout-client` binary: the supervisor, its tray, and
  the `egui` window.

### Process model

`scout-client` is one executable that runs as two processes:

- The **supervisor** is what a user or start-at-login launches. It holds the
  single-instance lock, owns `ClientRuntime`, and runs the tray. It never opens
  a window or a graphics context.
- The **window** is the same executable started by the supervisor with
  `--window`. It renders the `egui` or `gpui-kit` UI from what the supervisor
  sends and holds no collector, outbox, or lock.

Graphics devices get lost on Windows (sleep/resume, a driver reset, a
hybrid-GPU switch), and that can abort a process outright instead of
unwinding. Keeping collection out of the process that renders means a dead
window loses nothing.

The two talk over the child's stdio, one JSON object per line, tagged by
`type` (`scout-desktop-ipc`). The supervisor sends a `hello` with the protocol
version and whether a tray exists, then `state` snapshots (the runtime state
plus diagnostics counters and recent events), `phase` changes, the diagnostics
bundle on request, `show`, and `close`. The window sends its own `hello`, then
`pair`, `disconnect`, `open_url` (http and https only), `open_log_folder`,
`request_diagnostics`, `set_start_at_login`, and `quit`. Decoding is strict: an
unknown type is a broken contract, and the supervisor treats it as a window
crash. Logging goes to stderr in both processes, because the window's stdout
carries the protocol.

The supervisor reacts to how the window ends:

- **A crash** (non-zero exit, a signal, an unreadable message, or a window
  that stops reading for five seconds) records a `window_crash` diagnostic and
  relaunches the window. After three crashes, each within ten minutes of its
  start, it stops relaunching but keeps collecting; opening the window from
  the tray starts the count over. A protocol-version mismatch (the executable
  was replaced under a running supervisor) is not relaunched.
- **Closing the window** exits the window process cleanly. Collection
  continues, and the tray's "Open Scout" starts a new window. With no tray,
  closing the window quits Scout, since nothing could reopen it.
- **Quit**, from the tray or the Settings page, closes the window, stops the
  collector, and ends the supervisor.

If the supervisor dies, the window sees its stdin close and exits.

`--background` starts the supervisor without a window. Without a working tray
the window opens anyway.

`tray-icon` needs a running platform event loop: a message loop on the
creating thread on Windows, and the main thread's run loop on macOS. Neither
needs a window, so the supervisor runs a windowless `winit` event loop on its
main thread for the tray (as an accessory app on macOS, so it has no Dock icon)
and supervises on another thread. On Linux the KSNI backend runs its own D-Bus
thread.

### Window toolkit

The supervisor launches the `gpui-kit` window when `SCOUT_DESKTOP_UI=gpui` is
set or `--ui=gpui` is passed; the flag wins over the variable. Otherwise it
launches the `egui` window. Any other value is refused at startup with exit
status 2, and so is `gpui` on Linux, where the window is not built.

```bash
mise exec -- cargo run --package scout-client-app -- --ui=gpui
SCOUT_DESKTOP_UI=gpui mise exec -- cargo run --package scout-client-app
```

Choosing a toolkit picks which process starts. That is bootstrap, not product
behaviour, so it is an environment variable or flag rather than a feature flag.
Both windows render the same IPC state and send the same commands. The
supervisor passes `--window --ui=<toolkit>` to the child explicitly, so the
child never depends on the environment it inherits. Crash detection,
relaunch, close, and quit treat both windows the same way. Start-at-login
registration does not record the toolkit, so a login start opens `egui`.

The `gpui-kit` window uses the system UI font and the platform monospace font.
Beaufort, Spiegel, and Berkeley Mono are not bundled until their licensing is
decided.

#### Theme tokens

`scout-desktop-ui/build.rs` reads the design system's language-neutral
`design-system/tokens/themes.json` and its `themes.schema.json`. It emits one
`ThemeTokens` constant per theme, and the window uses `modern-dark`. The build
fails if a color or shape token the window uses is missing from a theme, is no
longer required by the schema, or is not in the schema's color format. The
token list is `USED_COLORS` and `USED_LENGTHS` in `src/token_source.rs`.

#### Pinning and upgrades

`gpui-kit` pins a pre-1.0 GPUI snapshot (`gpui-pre`) to an exact version and
releases weekly. Both are exact `=` pins in `[workspace.dependencies]`, along
with `gpui-pre-platform`. Renovate groups them into one PR with automerge off.

- Each upgrade is its own PR, with no other change.
- The `kit/` module absorbs API changes.
- Before it merges, an upgrade is built and run on Windows: open each page,
  toggle start at login, and resize the window. Windows reports for GPUI
  describe black strips while resizing and a black first frame on Intel
  integrated graphics. GPUI also aborts after five failed GPU device-loss
  recoveries, which the supervisor's relaunch absorbs.

`tests/gpui_boundary.rs` reads `cargo metadata` and fails if any other crate
declares a GPUI dependency, or if this crate's GPUI dependencies lose their
Windows-and-macOS target gate.

#### Build prerequisites

| OS      | Needed for the `gpui-kit` window                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS   | macOS 15 or later and Xcode. The Metal shaders compile when the window starts (`gpui-pre-platform`'s `runtime_shaders`), so the separate Metal Toolchain download is not needed. |
| Windows | Windows 10 or later, the MSVC toolchain, and CMake. Build on Windows: cross-compiling from another OS fails looking for `fxc.exe`, the DirectX shader compiler.                  |
| Linux   | Nothing. The window is not built, and the rest of the workspace needs no GUI libraries.                                                                                          |

`tests/render_pages.rs` drives the real window offscreen on macOS with GPUI's
Metal renderer. It feeds supervisor messages in as IPC lines, clicks the
navigation and the start-at-login checkbox, and checks the commands that come
out. Set `SCOUT_DESKTOP_UI_CAPTURE_DIR` to also write one PNG per page.
Windows has no headless GPUI renderer, so the Windows check stays manual.

### Runtime layout

`ClientRuntime` (`scout-client-runtime/src/runtime.rs`) owns the collector
thread and the command channel. The collector is split by concern under
`runtime/`:

- `collector`: the two-second tick loop and its `ObservationTickContext`.
- `pairing`: `handle_command`, `poll_pairing`, and `disconnect`.
- `upload`: `upload_pending` and `apply_observation_receipt`.
- `gameflow`: one gameflow pass (`collect_once`, `collect_match_state`) and the
  lobby binding it carries.
- `profile`, `history`, `clash`, `collection`: the independent, budgeted
  workers and the schedule that drives them.
- `replay`: replay scanning, offers, and upload.
- `observe`: `ObservationSlot` and the `enqueue_*` functions that turn endpoint
  reads into outbox entries.
- `state`: `RuntimeState`, `GameflowPhase`, and the helpers that publish them.
- `paths`: the data directory, outbox file names, and log directory.

Tests live beside the code they cover.

### Published state

The collector publishes through `tokio::sync::watch` channels, not a lock the UI
polls. `ClientRuntime::state()` returns a `watch::Receiver<RuntimeState>` holding
the latest snapshot; `egui` reads it with `borrow()` each frame.
`ClientRuntime::gameflow_phase()` returns a `watch::Receiver<GameflowPhase>`
that wakes only when the phase changes, for a future overlay or coach. A League
label this build does not know arrives as `GameflowPhase::Unrecognized`, and
`Disconnected` means no signed-in League client.

### Single instance

`InstanceLock::acquire` takes an exclusive lock on `scout-client.lock` in the
per-user data directory (the one holding the outbox) before the collector
starts. A second launch prints that Scout Client is already running and exits
with status 2. The operating system drops the lock when its holder exits, so a
crash never leaves a stale lock. The supervisor holds it; the window process
never takes it, so relaunching a window never contends for it.

Preview packages target `https://beta.scout-for-lol.com`, where the ingestion
flag is rolled out. Use `--server=http://127.0.0.1:<port>` for a local backend;
an explicit server is also retained in start-at-login registration. Remote
origins must use HTTPS. `bun run package` builds the platform-native installer
from the workspace metadata and pinned repository toolchain.

The Riot lockfile credential stays local and is redacted by construction. The
client is not an arbitrary LCU proxy and does not collect chat, friends, social,
store, or purchase data. Device credentials use the OS credential store. Raw
observations survive transient network failures in the local SQLite outbox.

The League client puts chat credentials in payloads the client does collect —
`multiUserChatPassword` and `mucJwtDto` in end-of-game blocks, a chat room
password in champion select, a lobby password in a custom game's session.
`ObservationEnvelope::new` removes every key whose name contains one of the
shared contract's `credentialKeyFragments` (`protocol.contract.json`), at any
depth, so none is queued, persisted, or sent. Fragments are specific
(`accesstoken`, not `token`) because champion mastery's `tokensEarned` is
gameplay data.
Clash capture includes check-in, invitations, tournament state, rewards, and
history; mastery capture preserves the client's season-milestone fields.

History, profile and Clash collection use independent workers, outside the
gameflow/end-screen loop. Their scheduling cadences are 30, 60 and 10 seconds;
a running pass finishes before another starts. Account switches clear each
worker's deduplication cache. Started gameflow sessions also emit a heartbeat
every 30 seconds, so unchanged rosters remain fresh on the server.

Clash overview and entity reads have separate 20-second budgets. Reads rotate
between passes so an unavailable endpoint cannot starve the rest. The entity
pass follows observed roster, bracket and tournament references, including
opponents and invited rosters. The player's roster retains its primary
resource name; additional entities use `resource:id`, so they cannot replace
one another. Each failed endpoint records a diagnostic and leaves the other
reads eligible.
The field names those IDs come from are the best available description of the
League client's Clash payloads, written before a Clash window could confirm
them. A name that never appears reads nothing. Every ID is parsed to its own
shape before it reaches a path, as a game ID is.

## Player identity

Every player ID the client reads is a League-client UUID, not the Riot API
PUUID the server stores, and the client sends it unchanged. The server
translates it; the backend README ("Scout Client player identity") describes
how. The client only has to keep reporting the account profile, whose
`gameName#tagLine` is what lets the server resolve its own player.

## Finished games

The match-history list holds only the local player for each game, so a
finished game's post-game bundle carries the full game instead:
`/lol-match-history/v1/games/{gameId}`, with every participant and their stats,
plus `/game-timelines/{gameId}`, its per-minute frames and objective events.
Both exist for games Riot's API never returns — customs of any size, Arena,
ARAM Mayhem — which is what lets the server treat such a game as it would a
Riot one. The game ID in each path is parsed from a League-client payload as a
positive integer (`GameId`); `LcuResource` is the only way a path takes a
variable segment.

The history worker scans the newest page and one overlapping older page per
pass, checkpointed by signed-in account. An exhausted scan restarts daily.
Gameflow, EOG, Clash and local replay references also persist game hints, so a
game need not appear in the newest history page to be recovered. Full game
reads must agree with the requested ID, platform and observer before becoming
qualified recovery work.

The first history-list snapshot carries any validated witnessed completion,
using the same observer, platform and timing checks as the full result. A
background history scan therefore cannot label an already witnessed live
completion as historical before the enriched result arrives. Unwitnessed
history retains its historical provenance; server eligibility is permanent.

Malformed history pages defer their scan checkpoint while already discovered
games continue recovering. A validated full game is cached in SQLite before
enqueueing its result, so a crash or enqueue failure can retry the captured
bytes even if the LCU endpoint later stops serving the game.

Result and timeline collection have separate durable checkpoints. Full history
is sent even without EOG or timing; a list row remains discovery evidence.
Missing artifacts retry with bounded backoff and no attempt cutoff. Recovery
checks four due games per pass and preserves progress across restart. A failed
game does not prevent the others from being collected. The backend can retain
a normalized scoreboard even when these fragments cannot form a complete
Match-V5 document. After pairing, the approval page links to recovered games.

Existing local replay files are offered independently. Temporary server
deferrals remain retryable, with backoff up to one hour. An outbox migration
reoffers files older builds abandoned for missing evidence. Permanent server
validation rejections remain terminal. The client does not download replays.

## Which games get reported

A game that ends while the client is running gets a report: the full one when
the end-of-game stats block, timing and history agree, otherwise at least the
end-of-game scoreboard. A game the client did not see stays history-only, and a
post-game block seen more than 15 minutes late is treated as historical.

The gameflow transition out of `InProgress` is recorded as an end witness, so a
game whose stats block never appears (League closed, endpoint late) still has an
end time. The earliest observation wins. Closing League is not a transition.

The collection tick skips missed ticks (`MissedTickBehavior::Delay`) instead of
bursting them after sleep or resume. Unresolved game hints retry with the same
escalating backoff as game recovery, 5 seconds per attempt up to 5 minutes.
Once a game's result and timeline are checkpointed, its pending end-of-game and
timing rows are deleted.

## Lobby and game identity

LCU exposes a lobby's `partyId` while the lobby exists and a real `gameId` only
once the game is in progress, and the in-progress session carries no lobby
identity — the two facts never appear in the same payload, and no field is
shared between them. The lobby is also the only place the complete roster
appears, including bots and custom teams that Riot's spectator API omits.

A process watching the transition is therefore the only party that can tie the
two together. The client remembers the current lobby, claims it for the next
game that starts, and stamps the result onto the envelope's `lobbyId` for
observations whose own payload has none. Both halves live in the SQLite outbox,
so the join survives a restart between champion select and the game. When the
join is recorded the client sends the in-game session once more, stamped: the
first copy left before the join existed, and an unchanged session is not
otherwise resent, so without it the server would not learn the game's lobby
until post-game — after prematch needed it. The backend README describes how
prematch uses it.

Each game records one outcome, which the first attempt decides: a game's roster
cannot change identity partway through. "No lobby was observed" is recorded as
such rather than retried, since a client that started mid-game will never see
the lobby that is already gone. A remembered lobby stops being eligible after
fifteen minutes, because a stale key would attach one game's roster to another,
which is worse than having no key at all.

Transient lobby joins, EOG fragments and timing are scoped to the signed-in
observer. Upgrading preserves older unqualified rows in separate SQLite tables;
they cannot be attributed safely and do not participate in new joins. History
recovery itself is keyed by observer, platform and game ID. EOG enrichment must
also agree with the full game's creation time and any stated platform.

## Diagnostics

The release binary is a GUI-subsystem process with no console, so it writes
rotating JSONL to `logs/` under its per-user data directory
(`%LOCALAPPDATA%\Scout\Scout Client\data` on Windows). Files roll at 25 MiB and
are kept for seven days. The Diagnostics page shows recent events and counters,
opens that folder, and copies a shareable bundle.

Records carry an allow-list — level, category, operation, outcome, HTTP status,
duration, size, and a bounded `detail` — so a credential, PUUID or filesystem
path is not representable in one rather than merely filtered out of it. Adding
a field is the only way to widen what a record can hold.

The window renders with glow. On Windows both of egui's renderers panic when
the GPU context is lost: glow when sleep/resume, a driver reset or a display
change invalidates it, and wgpu when it can no longer write a buffer, which
happened within a minute on a hybrid-GPU machine. So the window is not trusted
to stay up, and it runs in its own process (see "Process model"). Diagnostics
live in the supervisor, which records each window crash as `window_crash`.

Errors and crashes are also reported to Bugsink once a DSN is configured in
`scout_client_core::reporting`; until then the reporter is not installed and
everything stays on the machine. Only `Error` and `Critical` records are sent,
and they are the same allow-listed records, so nothing leaves that the local log
does not already hold.
