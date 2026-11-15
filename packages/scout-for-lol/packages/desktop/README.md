# Scout Desktop

(Formerly Scout Client; the crates, the `scout-client` binary and the data
directory keep the old name.)

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

The workspace has six crates:

- `scout-client-core`: LCU access, protocol, outbox, credentials, and
  diagnostics. `desktop_api` holds the Explore REST envelopes the pairing
  flow and the Explore client share.
- `scout-explore-client`: the client for Explore chat, with no UI
  dependency (see "Explore client").
- `scout-client-runtime`: the UI-independent collection runtime (pairing,
  observation, upload, history, Clash, and start-at-login registration).
- `scout-desktop-ipc`: the JSON-lines messages between the supervisor and the
  window process.
- `scout-desktop-ui`: the `gpui-kit` window. It is the only crate that depends
  on `gpui-kit` or GPUI (`gpui-pre`), and only on Windows and macOS:
  - `kit/` is the only module that names `gpui_kit`. It wraps components under
    Scout names (`ScoutButton`, `ScoutToggle`, `StatusRow`, `Page`, `NavItem`,
    `Shell`, `theme()`, and the chat's `Transcript`, `ComposerState` and
    `TranscriptState`), so a gpui-kit API change stays inside it.
  - `view_model` builds plain structs for each status page from the IPC
    `StateSnapshot`, and `chat_model` builds the chat screen from the IPC chat
    parts. Both map every control to the `WindowMessage` it sends.
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
plus diagnostics counters and recent events), `phase` changes, `update` (the
self-update state), the five chat parts (`chat_status`,
`chat_conversations`, `chat_transcript`, `chat_turn`, `chat_images`; see
"Explore chat"), the
diagnostics bundle on request, `show`, and `close`. The window sends its own
`hello`, then `pair`, `disconnect`, `open_url` (http and https only),
`open_log_folder`, `request_diagnostics`, `set_start_at_login`, `set_privacy`,
`chat` (refresh, open, new, send, stop), and `quit`. Decoding is strict: an
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
out. Every capture must leave the last 16 device pixels of each row blank, so a
line that stops wrapping at the window edge fails the test. Set
`SCOUT_DESKTOP_UI_CAPTURE_DIR` to also write one PNG per page.
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

When Scout refuses this build as older than its minimum supported version,
check-in and observation batch answer HTTP 426 with a typed
`client_upgrade_required` body (`ClientUpgradeRequired`, from
`protocol.contract.json`). `BackendError::UpgradeRequired` carries it,
`RuntimeState::upgrade_required` holds the minimum version until a later
check-in or upload succeeds, and `last_error` tells the user to update.
Observations stay in the outbox, and the refusal is recorded as a deferred
warning rather than an error report. Builds released before this type treat the
426 as an ordinary failed request and also keep their outbox.

### Single instance

`InstanceLock::acquire` takes an exclusive lock on `scout-client.lock` in the
per-user data directory (the one holding the outbox) before the collector
starts. A second launch prints that Scout Client is already running and exits
with status 2. The operating system drops the lock when its holder exits, so a
crash never leaves a stale lock. The supervisor holds it; the window process
never takes it, so relaunching a window never contends for it.

Use `--server=http://127.0.0.1:<port>` for a local backend; an explicit server
is also retained in start-at-login registration. Remote origins must use
HTTPS. Without `--server`, the backend is the compiled-in release profile's
(see "Release profiles").

Preview packages' ingestion flag is on for everyone on beta. Production enables the client in Flipt, owner first,
then the owner's server, then everyone. Before the first step every device
route answers `403 scout_client_disabled`; after it, a device whose owner no
step reaches yet is refused as `401 unauthorized`, as in beta.

### Explore client

`scout-explore-client` talks to the authenticated Explore routes under
`/api/scout-client/v1/explore/`, acting as the device's owning Discord user.
Its contract is `data/src/scout-client/desktop-api.contract.json`, with
golden bodies in `data/src/scout-client/desktop-fixtures/`.

- `contract`: `build.rs` generates the route table (`Route`), the contract
  version and header, the stream event names, and each refusal's HTTP status
  from the contract file. Refusal codes are matched against
  `scout_client_core::desktop_api::DesktopApiErrorCode` by name, so a code
  added to or removed from the contract does not compile until the enum
  follows.
- `model`: strict serde types (`deny_unknown_fields`) for transcript
  messages, traces, query results, match and loadout cards, and every
  `runs/stream` event. Fields the Zod schemas default are defaulted here too.
  A chart snapshot is carried without interpretation beyond its kind, title
  and sparkline flag, because the window shows the PNG the server renders
  from it.
- `ExploreClient`: one typed method per Explore route. It reads the device
  credential from the operating-system store, sends
  `X-Scout-Desktop-Contract` on every request, and maps every refusal to
  `ExploreClientError::Refused` with a `Recovery` (pair again, sign in on
  the web, update the app, feature off, retry later, and so on). A 426 is
  `UpgradeRequired`; a refusal at a status the contract does not give it is
  `Unexpected`.
- `stream`: `ExploreClient::follow_run` reads the SSE stream on its own HTTP
  client (5-second connect timeout, 30-second idle read timeout, no total
  timeout). Every response starts with a complete snapshot, so a lost
  connection, an idle timeout or a corrupt frame reconnects with jittered
  backoff from 0.5 to 15 seconds without duplicating state. It stops on
  `done`; a 404 asks `runs/outcome` how the run ended; 401 and
  `scope_required` end in `RePairRequired`, a 426 in `UpgradeRequired`, and
  other permanent refusals such as `feature_disabled` in `Refused`. Frames
  that stay corrupt across three fresh connections fail loudly.
- `reducer`: a pure port of the web's turn reducer
  (`app/src/lib/explore/explore-turn-state.ts` and
  `explore-run-completion.ts`), plus `TurnView` for the error, outcome, title
  and quota the web keeps in its page hook. Both suites run the sequences in
  `desktop-fixtures/explore-turn-reducer.json`.

- `session`: one desktop chat session as pure state (availability, the
  conversation list, the open transcript, the `TurnView` in flight, the card
  art catalog, and where each picture stands), projected onto the window's
  IPC chat parts.
- `visuals`: an answer's chart, table and cards as the window draws them.
  A chart whose kind is in the contract's `nativeVisualizationKinds` (table,
  list, leaderboard, headline number; the same kinds Discord draws as text)
  becomes formatted rows; any other chart is the PNG `explore/visualization`
  renders with `visualizationSnapshotToImage`, the renderer Discord posts.
  Every chart, card and icon carries an accessible name, and a chart's
  values are its accessible description.
- `data_dragon`: card art URLs at the Data Dragon version `explore/assets`
  names; the build pins none. Champion and rune ids resolve through that
  version's `champion.json` and `runesReforged.json`.
- `asset_cache`: a disk cache keyed by URL in `explore-cache/` under the data
  directory, capped at 64 MiB and trimmed least recently used first, with use
  kept in each file's modification time.
- `relay`: `ChatRelay`, the supervisor's task that runs the client against a
  session and publishes the parts. It also fetches every picture the open
  transcript names into the cache: charts one at a time with the device
  credential, card art from `ddragon.leagueoflegends.com` (the only host it
  fetches art from) six at a time. A picture that failed is asked for again
  the next time its conversation is opened.

The REST and stream tests run against a scripted loopback HTTP server in
`crates/scout-explore-client/tests/http`. With the `golden` feature,
`scout_explore_client::golden` plays the golden stream through a session, so
the window's view-model and render tests start from the contract's frames.

### Explore chat

Chat is the main screen of the `gpui-kit` window: a conversation sidebar (New
chat, then the owner's conversations), with the four status pages in a
secondary "Status" section under it. The `egui` window has no chat page.

The Explore client runs in the **supervisor**, not the window. The supervisor
already holds the device credential for uploads, and the window renders on
the GPU and can be lost with it, so the bearer never enters the window
process. Only when the `gpui-kit` window is selected does the supervisor
start a `ChatRelay`; it asks Scout nothing until a window opens. The window
sends `chat` commands and renders five parts, each sent only when it changes,
so a streamed answer re-sends only the in-flight turn and a picture landing
re-sends only `chat_images` (`ChatParts::changes_since`). The parts carry no
bearer, query text or raw tool payloads; cards cross as their rendered
projection, and pictures as paths to files in the supervisor's cache.

Screens follow the relay's availability:

- **Not approved** (no credential, or a credential paired without the
  `explore` scope): "Approve chat on the web". Pairing uses `pairings/v2`,
  which asks the approver for uploads and chat together and returns a match
  code the window shows beside the approval link. A device paired before chat
  approves once more this way.
- **Turned off** (`feature_disabled`): "Chat is turned off".
- **Too old** (426 or `contract_unsupported`): "Update Scout Desktop", with
  the updater's status; the supervisor also triggers an update check.
- **Sign in again**, **no Scout server**, and **unavailable** say what
  happened and offer "Try again".
- **Ready**: the transcript is a virtual list (`MessageScroller`) that follows
  the newest row. Answers render as Markdown with the text view's
  `stream_fade`, which reduced motion turns off; each answer lists its tool
  steps as summary rows, then its chart or table, match cards (queue,
  length, score, and each team's champions, Riot IDs and KDA) and loadout
  cards (champion, final items, summoner spells and runes). A chart shows
  "Drawing the chart…" in a fixed-height frame until its PNG lands, or the
  refusal's message if Scout would not draw it. A dropped stream shows
  "Reconnecting…" in the header until the next frame. The composer sends on
  Return or Send; Stop appears while a run can be stopped.

Keyboard order is the composer, Send, Stop, then the sidebar (New chat, each
conversation, the status pages); a focused sidebar entry takes Return or
Space like a click. The focus ring is the theme's `focus` token.

Not in the window yet: native interactive charts, attachments, edit,
regenerate and version switching, share links, the model picker and the
@-mention picker.

## Release profiles

The product ships as two builds that differ only by a compiled-in profile,
`release-profiles/stable.json` or `release-profiles/beta.json`.
`scout-client-core/build.rs` validates both on every build (schema, channel
matching the file name, a bare HTTPS backend origin, a reverse-DNS identifier,
and no field shared between the two that must be distinct) and generates
`scout_client_core::profile::{STABLE, BETA}` plus the one this binary carries,
`ReleaseProfile::compiled()`. `SCOUT_DESKTOP_PROFILE=stable|beta` picks it at
build time; an unset variable, which is every development build, is **beta**.
Any other value fails the build.

| Field               | Stable                      | Beta                             |
| ------------------- | --------------------------- | -------------------------------- |
| Product name        | Scout Desktop               | Scout Desktop Beta               |
| Installed binary    | `scout-client`              | `scout-client-beta`              |
| Backend             | `https://scout-for-lol.com` | `https://beta.scout-for-lol.com` |
| Identifier          | `com.scout-for-lol.client`  | `com.scout-for-lol.client.beta`  |
| Keyring service     | `com.scout-for-lol.client`  | `com.scout-for-lol.client.beta`  |
| Data directory      | `Scout Client` (unchanged)  | `Scout Desktop Beta`             |
| Start-at-login name | `Scout Client` (unchanged)  | `Scout Desktop Beta`             |

Stable keeps the identifier, keyring service, data directory and binary name
the client has always had, so a user who already paired and has an outbox keeps
both (credentials and the outbox are scoped to the backend origin, so a stable
build pairs once with production). Beta has its own identifier, keyring entry
and data directory, so it installs and runs beside stable. The profile feeds
the credential store, the data directory, the start-at-login registration, the
window title, the tray tooltip, the default backend and the Windows version
resource. `--server=` still overrides the backend for development.

Error reports follow the backend: `reporting_environment` maps the beta origin
to `beta`, a loopback origin to `development`, and everything else to
`production`.

### Building an installer

`packaging/stable.json` and `packaging/beta.json` are the `cargo packager`
configs, and `tests/packaging.rs` fails if either disagrees with its profile.
Install formats are NSIS on Windows (`installMode = "currentUser"`, so no
elevation) and DMG on macOS. Icons come from the design system's
`app-icon-512.png`; regenerate the committed `assets/icon.ico` and
`assets/icon.icns` with `bun run icons` (macOS, uses `sips` and `iconutil`).
Windows also gets an embedded version resource (icon, product name, file
version) from `winresource` in `scout-client-app/build.rs`.

```bash
bun run package:stable   # SCOUT_DESKTOP_PROFILE=stable, dist/stable/
bun run package:beta     # SCOUT_DESKTOP_PROFILE=beta,   dist/beta/
```

The DMG step lays out its window with Finder AppleScript. From a session
without Finder automation access (SSH, an agent), it fails with `AppleEvent
timed out`; set `CI=true` so create-dmg skips that step (the image is the same,
minus its icon placement). Always package through these scripts: the profile is chosen by the environment
variable the script sets, and the config only names the installer. Build on
the platform the format targets. These scripts produce unsigned installers;
operating-system code signing (Authenticode, notarization) is not part of
them yet, and update signing is a separate step in "Releasing an update".

### Self-update

A packaged build keeps itself current. The supervisor (never the window, and
never the tray's event loop) runs the updater from `scout-client-app/src/updater/`
on its own tokio runtime.

**What it does**

1. Thirty seconds after start, and then every six hours (`UpdateConfig`, typed
   config in `updater/policy.rs`; the client cannot reach the backend's Flipt),
   it fetches `https://download.scout-for-lol.com/<channel>.json` for the
   compiled-in profile's channel. The manifest is validated against the shared
   contract (below) and must name the same channel.
2. A release strictly newer than the running build is downloaded in the
   background to `<data dir>/updates/<version>/`. The size, SHA-256 and
   signature are checked and the file is renamed into place only if all three
   pass. A release at or below the running version is never offered, so the
   channel cannot downgrade a build, and redirects are never followed.
3. A verified update waits. It installs in two ways: when the user quits Scout
   (after the collector has stopped cleanly, with no restart), or when the
   window has been closed for ten minutes with no game phase in the way (the
   installer then starts the new version). A required update, where the
   running build is below the manifest's `minimumVersion`, skips the ten
   minutes. The installer is verified once more immediately before it runs.
4. The installer is the `cargo packager` NSIS installer, run passively (`/P
/NS`, plus `/R` for an idle install) and detached, so it outlives the
   supervisor that started it.

**It never interrupts a live game.** An install, whether on quit or at idle,
starts only while the gameflow phase is `Disconnected`, `None` or `Lobby`
(`policy::install_allowed`, an allow-list over `RuntimeState`'s typed phase).
Matchmaking, ready check, champion select, loading, a game, a reconnect, every
end-of-game phase and any phase this build does not know all defer it. The
phase is rechecked at the moment of installing, and a deferred update stays
staged for the next opportunity.

**HTTP 426.** The supervisor watches `RuntimeState::upgrade_required`. The
moment the backend starts refusing this build it checks the channel at once
instead of waiting for the interval, so a required release is downloaded as
soon as the backend demands it.

**Window.** The supervisor sends `SupervisorMessage::Update` over the IPC link
whenever the update state changes (`UpdateSnapshot`: a status, the version and
whether it is required, never a URL or path), and both windows show it as an
"Updates" row on the Overview page. Failures are recorded in diagnostics
(`update_check`, `update_download`, `update_install`).

**Telemetry.** `update_applied` is sent by the first run of a new version
(`SettingsStore::note_run_version`) through the same usage-data gate as every
other event, so an opted-out user sends nothing.

**Where it does not run.** A development build (no `SCOUT_DESKTOP_PROFILE`), a
build started with `--server=`, and any platform other than Windows x86-64
(macOS DMG and Linux builds have no installer the updater can run) never update.
`ReleaseProfile::is_packaged()` is what separates a packaged build.

**Mechanism.** `cargo packager` signs installers with minisign
(`cargo packager signer`), and the client verifies that signature with
`minisign-verify` against the channel's public key compiled in from
`release-profiles/<channel>.json` (`update_public_key`). Two keys, one per
channel, so a leaked beta key cannot ship stable. The channel manifest is
transport metadata only; the signature is the trust root, so a tampered
manifest or bucket cannot install anything. The `cargo-packager-updater` crate
is not used: its last release was 0.2.3 on 2025-07-21, it pulls a second
`reqwest` (0.12) and `dirs` major version, its own manifest format has no
SHA-256, size, minimum version or release notes, and its download-and-install
flow cannot express the game-phase gate. The Glitter Boys launcher's
Ed25519 manifest envelope was not reused either, because it needs its own
signing tool and key format where `cargo packager` already writes the
signatures this client verifies. The `Updater` trait in `updater/mod.rs` is the
seam; `HttpUpdater` is the one implementation.

**Manifest contract.** `data/src/scout-client/desktop-update-manifest.contract.json`
is the language-neutral source of truth, with
`desktop-update-manifest.schema.ts` (Zod), `desktop-update-manifest.fixtures.json`
and `updater/manifest.rs` (serde plus the rules JSON cannot express) validating
the same file. It holds the channel, the version, the `minimumVersion`, a UTC
`publishedAt`, the release notes, and per platform artifact the URL, SHA-256,
size, minisign signature and format. Artifact URLs must be exactly
`https://download.scout-for-lol.com/releases/<version>/<file>`.

**Keys.** The minisign private keys and their passwords are in 1Password, in
the `Homelab` vault, item `Scout Desktop release`, fields
`stable-update-signing-key`, `stable-update-signing-password`,
`beta-update-signing-key` and `beta-update-signing-password` (the matching
`*-update-public-key` fields hold the public halves). They were generated with
`cargo packager signer generate` and never touched a file in the repository.
Only the public keys are committed. Rotating a key is a roll-forward: publish
a release signed with the old key whose profile carries the new public key,
then sign the following releases with the new key. A build that never receives
that bridge release cannot verify later ones, so rotate before retiring a key.

### Releasing an update

Releases are manual and operator-run. Nothing in CI or Delivery runs these
steps, and the publication script is never run against the live bucket by a
pull request.

1. Set the workspace `version` in `Cargo.toml` above the live channel's, and
   write release notes to a file.
2. On the Windows host, `bun run release:package:stable` (or `:beta`) builds
   the installer with that channel's profile and signs it. The channel's
   signing key and password are resolved from 1Password for that process only
   (`release-signing.<channel>.env` holds locators, never values). Output:
   `dist/<channel>/` with the installer and its `.sig`.
3. Preview without credentials:
   `bun run release:publish:stable -- --notes-file notes.md --dry-run`
   verifies the signature with the channel's public key and prints the
   manifest it would publish.
4. Publish: `bun run release:publish:stable -- --notes-file notes.md
[--minimum-version X.Y.Z]`. The script, in order:
   - refuses an installer that the channel's public key does not verify;
   - reads the live manifest and refuses to publish a version that is not
     newer, or a `minimumVersion` below the live one (never downgrade);
   - uploads `releases/<version>/<installer>` and its `.sig` as immutable
     objects (`Cache-Control: public, max-age=31536000, immutable`, created
     with `If-None-Match: *`; identical bytes already there are a no-op so an
     interrupted run can be retried, different bytes are refused);
   - reads both back from `https://download.scout-for-lol.com`;
   - only then replaces `<channel>.json` (`Cache-Control: no-cache`) under an
     `If-Match` ETag precondition, so a concurrent publisher is refused, and
     reads it back from the public host. Until that last write no client can
     see the release.
5. Raise the backend's minimum version in Flipt only after the release is
   public, when the old builds must update.

Rollback is roll-forward: publish a newer version that contains the fix. A
channel never serves an older version than a client has.

Release objects live in the `scout-desktop` SeaweedFS bucket behind
`download.scout-for-lol.com` (declared in `packages/homelab`; the bucket and
host must be applied by Delivery before the first publication, or the readback
step fails).

### Renaming Scout Client to Scout Desktop

cargo-packager's NSIS template keys the install directory, the uninstall
entry and the process kill on the product name and the binary name, not on the
identifier. A "Scout Desktop" installer therefore does not recognise an
installed "Scout Client" as its own predecessor. `packaging/stable.json` uses
cargo-packager's supported `nsis.preinstallSection` hook to add a section that
runs before the install section. It reads the old
`...\Uninstall\Scout Client` registry entry and, when present, silently runs
that uninstaller (`/S _?=<dir>`, which waits for it) and removes the leftovers.
The silent uninstaller never ticks "delete app data", so the data directory,
outbox and credentials stay. The binary name is unchanged, so the installer's
running-process check also closes a running Scout Client. The beta installer
has no such hook: it never replaced anything.

The hook is NSIS script and has not been run on Windows in CI; verify it on
the Windows build machine with an old "Scout Client" installed before the first
public release.

Beta installs beside stable because nothing NSIS keys on is shared: the product
name (install directory and uninstall entry) and the binary name (running-process
kill and shortcuts) both differ. The cargo binary is always `scout-client`;
`scripts/prepare-package.ts`, the packager's `beforePackagingCommand`, builds
with the channel's profile and stages the copy as `scout-client-beta` for beta.
The supervisor relaunches its window through `current_exe`, so it needs no
knowledge of the name.

On macOS the DMG carries `Scout Desktop.app` and there is no uninstaller; a
user drags the old "Scout Client" app to the Trash. Its login item is named
"Scout Client" and the stable build keeps that name, so it is replaced rather
than duplicated.

The Riot lockfile credential stays local and is redacted by construction. The
client is not an arbitrary LCU proxy and does not collect chat, friends, social,
store, or purchase data. Device credentials use the OS credential store. Raw
observations survive transient network failures in the local SQLite outbox.
Chat's card art comes from Riot's public Data Dragon CDN without a credential
or any identifier beyond the request itself; charts come from Scout with the
device credential. Both are cached in the data directory.

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

Errors, crashes and product events leave the machine only as described in
"Error reports and usage data", and only while the user has not opted out.

## Error reports and usage data

Two settings, **Send error reports** and **Send usage data**, are on by default
and appear on the Settings page of both the egui and the gpui window. They are
stored in `settings.json` in the per-user data directory, beside the outbox but
not inside it: the outbox file is scoped to a backend and device and is
recreated on pairing, which must not reset a privacy choice. A missing file is
both on; a file that cannot be read turns both off and records a
`load_settings` diagnostic, because a damaged file must never send what the user
turned off.

**Where "off" is enforced.** A checkbox only flips a `SendGate`
(`scout_client_core::settings`); each sending layer checks its own gate and
refuses to send while it is closed, so no UI path is needed for the opt-out to
hold:

- Error reports: `BugsinkSink` checks the gate, and the SDK's `before_send` hook
  checks it again for every event, including panics the SDK captures itself.
- Usage data: `UsageReporter::report` checks the gate immediately before the
  network call, and the backend method it calls is crate-private, so nothing
  else can send an event. Events are not retried.

The supervisor owns the settings. The window process starts its own error
reporter with the stored choice and then follows the `privacy` field of every
snapshot, so an opt-out reaches both processes without a restart.

**Error reports** go to the public "Scout desktop client" Bugsink project
(`BUGSINK_DSN` in `scout_client_core::reporting`, compiled into the binary: a
Sentry DSN only authorises submitting events, like the one in
`packages/tasks-for-obsidian/App.tsx`). Both processes initialise reporting,
tagged `process=supervisor` or `process=window`. Only `Error` and `Critical`
diagnostics are sent, and a window abort that cannot report itself is reported
by the supervisor as a `window_crash` at `Critical` level. Every outgoing event
passes `scrub_event`: free text is redacted of paths, Riot IDs and long opaque
tokens; user, request, server name, breadcrumbs, extra data, modules, threads,
debug images, source file paths, local variables, panic payload text and every
tag outside an allow-list are removed. Debug builds do not report.

**Usage data** is a closed set of events, `app_started`, `device_paired`,
`post_game_reported`, `update_applied` and `window_crashed`. Each carries only
the app version and bounded enum properties (`platform`, and for
`window_crashed` a `cause` and an `outcome`). The client never contacts PostHog:
it posts each event to `POST /api/scout-client/v1/desktop/events` as the paired
device, and the backend validates it strictly, rate-limits it per device, and
forwards it under a one-way digest of the device owner's identity (never the
Discord ID, device ID or any gameplay value). Events wait for the first
check-in, so an unpaired client sends nothing. `update_applied` is noticed by
comparing the running version with the one recorded in `settings.json`.

The contract is `data/src/scout-client/desktop-events.contract.json` with
`desktop-events.fixtures.json`; the Zod schema
(`desktop-events.schema.ts`) and the serde types (`telemetry.rs`) each have
tests that fail when they drift from it. Adding an event or a property means
changing the contract, both implementations, the backend forwarder and the
privacy policy together.

What is never sent through either channel: Riot IDs, PUUIDs, Discord IDs,
file paths, tokens or credentials, League chat, replay contents, and
gameplay observations. Gameplay observations and replays are a separate,
paired-account upload that these two settings do not control; disconnecting
the device stops it.
