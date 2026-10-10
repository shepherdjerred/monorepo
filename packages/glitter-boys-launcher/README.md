# Glitter Boys launcher

Native Windows x64 game installer and launcher, built with Rust and
egui/eframe, the same GUI stack as Scout Desktop. It manages fresh installations
of MW2/IW4x, Black Ops/Plutonium, Black Ops II/Plutonium, and Black Ops III/BOIII.
Apple silicon macOS uses the separate website guides.

## Development

From the repository root:

```sh
bun run --cwd packages/glitter-boys-launcher dev
bunx turbo run build typecheck test lint --filter=@shepherdjerred/glitter-boys-launcher
```

`crates/launcher-app` owns the native UI. The core scheduler owns the install queue. `crates/launcher-core`
owns the reviewed catalog, downloads, archive reader, installation receipts, and
client adapters. Game files are not included in the executable or repository.

The default game library is `%LOCALAPPDATA%\GlitterBoys\Games`. A selected alternate
parent gets a `GlitterBoys` child directory. Launcher preferences, its process
lock, and downloaded client bootstrap programs stay under
`%LOCALAPPDATA%\GlitterBoys`. A persisted queue resumes only when the user chooses
Resume; restarting the application does not silently start large downloads.

For an isolated acceptance run, pass `--data-dir <absolute-directory>` to keep
settings, logs, client files, and the process lock in a separate profile. Its
`settings.json` uses the same versioned format as a normal profile. Pass
`--resume` explicitly to start its saved queue when the window opens. Without
that option, queued installs remain paused. Choose a fresh library path in the
test profile to preserve the normal installations.

## Installation contract

`catalog.json` is a versioned, bundled data contract deserialized with unknown
fields rejected. Each artifact has an HTTPS URL, exact length, and SHA-256 hash.
Game identifiers select fixed Rust adapters; catalog entries cannot add commands
or scripts. Update the catalog only after independently measuring the archive
and validating its layout. A changed download fails its size or checksum check.

Downloads live in a content-addressed cache on the game drive. HTTP range
responses must start at the saved byte offset and match the full expected size.
A server ignoring Range replaces the partial file instead of appending. A
checksum failure discards that damaged partial; a network failure preserves it.

ZIP extraction uses the Rust ZIP reader, including Deflate64. Numbered BO3 parts
are one seekable stream, so setup does not create an additional concatenated
118 GB archive. Installation validates the complete archive directory before
writing, rejects Windows path aliases, duplicates, traversal and links, checks
expanded sizes and entry CRCs, and writes into a new staging directory. A receipt
and atomic directory rename expose the installation only after verification.
Extraction uses up to four workers with independent archive readers, schedules
larger files first, and aggregates byte progress. Each entry retains its CRC and
length checks. Pause and errors join every worker before staging is cleaned up.
Existing destination directories are refused; Steam installations and saves are
not imported or overwritten. Only the exact verified cache files owned by a
successful installation are removed.

Play reads the typed `prerequisites.json` contract and checks runtime family,
architecture, registration where applicable, and DLL versions. It runs an included
installer only for a missing or outdated requirement, checks its Microsoft
signature before elevation, and detects again after setup. A receipt never
replaces detection. Cancellation, reboot requirements, and failed post-checks
remain visible. A game can still need its official client login or update.

The coordinator admits games against remaining disk capacity, shares verified
client downloads, and runs at most two download/hash tasks, one extraction pool
(up to four workers), and one client-finalization task. IW4x client extraction
shares the extraction slot. Each game can pause or fail independently. Pausing
retains downloads; interrupted extraction restarts in a fresh staging directory.
Closing waits for active writers to stop. Queue mutations stay on the coordinator.

Each card shows a friendly current step and time-left estimate. Details holds
elapsed time, recent throughput, file sizes, and the underlying operation. Elapsed time includes task-slot waits, excludes pauses, and resets when the
launcher restarts. Parallel archive downloads contribute to one combined download
total and speed. Checking files and unpacking have separate speed samples; their
ETAs do not include later stages or client setup. Estimates appear after a short
warmup and clear after five seconds without progress. Timing is local UI state.

The library distinguishes new installs from paused queue entries using scheduler
snapshots, not stale UI settings. Settings owns the game location, reporting
preference, and updates; Help owns report export and advanced tools. Expected
recovery actions use typed `ActionRequired` errors and `Problem` messages, with
raw error details retained for copying. Successful launch indicates client handoff,
not proof that a game process or multiplayer session is running.

## Client adapters

- **IW4x:** installs the pinned official launcher, runs `--skip-launch` to update
  a new installation, then starts that launcher for Play.
- **Plutonium:** sets only `t5Path` or `t6Path` while its client is closed,
  preserves unrelated configuration, runs the official updater with
  `-update-only`, and opens the fixed `plutonium://play/` link for the selected
  game and mode. Login remains in the official launcher. The application never
  extracts or replays account tokens, and diagnostics exclude that configuration.
- **BOIII:** installs the pinned official client and uses its normal `-launch`
  entry point, retaining upstream update and compatibility checks. MP/Zombies
  selection is in the game's menu. The archive's legacy bypass batch is never run.

Plutonium's protocol is documented in its
[official changelog](https://plutonium.pw/docs/changelog/#r600) and
[staff support answer](https://forum.plutonium.pw/topic/45450/can-i-start-a-game-directly-skipping-the-game-selection-screen).

## Validation

Tests use small generated ZIPs and loopback HTTP fixtures. They cover partial
responses, ignored and malformed ranges, interrupted downloads, pause/restart,
checksum failure, split-archive reads, CRC errors, Windows path aliases,
symlinks, duplicate entries, preserved destination contents, and exclusive locks.

To inspect real downloaded archives with the production ZIP parser without
extracting or launching a game:

```sh
cd packages/glitter-boys-launcher
cargo run --locked --example audit_archives -- C:\Games\GlitterBoysGuide\Downloads
```

This checks archive metadata and expanded sizes. It does not prove CRC integrity,
successful client login, game startup, or multiplayer connectivity; those are
separate acceptance checks. The game's installed receipt proves local file
installation, not successful multiplayer gameplay.

For a local extraction comparison, `cargo run --release --locked --example
benchmark_extraction -- <download-directory> <scratch-directory>` copies eight
unchanged compressed BO3 entries into a temporary sample ZIP, then measures one
and four workers. The existing scratch directory needs room for the sample and
its output. Timing includes output writes and CRC checks, and temporary files
are removed after the benchmark. Concurrent disk activity affects the result.

## Diagnostics

`crates/launcher-core/src/diagnostics.rs` owns the allow-listed event contract.
Local JSONL logs rotate at 10 MiB, keep at most five files, and expire after seven
days. Exports contain only those structured events. They never read client login
configuration. Fields are release, game, operation, outcome, coarse failure,
duration, bytes, timestamp, and schema version. There are no free-text messages,
account IDs, installation IDs, IP addresses, paths, or user names in event payloads.

Automatic reporting defaults on and has an in-app opt-out. Opt-out clears queued
uploads and prevents new ones; a request already in flight can finish. Debug
builds never upload. The disk queue keeps at most 1,000 events for 24 hours;
batches contain at most 25 events, with bounded network timeouts and backoff.
Telemetry failures do not prevent game installation or launch.

The Rust `launcher-service` crate accepts the same typed contract, exposes public
HTTP ingestion on 8080 and private Prometheus metrics on 9091, limits request size
and aggregate request rate, and bounds release-label cardinality. Metrics use
at-least-once delivery, so a retried accepted batch can be counted twice. Failed
operations and sanitized panic events forward to Bugsink using its bootstrap
`SENTRY_DSN`. Native crash dumps and symbolicated stacks are not implemented.
Edge/proxy access logs have their own retention outside this event contract.

Its Docker target and Woodpecker image registry belong to this package. The
homelab chart owns the tunnel, secret reference, private ServiceMonitor, alerts,
and Grafana dashboard. Its checked-in release stage is `prepared`, which renders
no workload. Activation requires a real published image digest and a granted
`glitter-boys-launcher-credentials` 1Password item. Change those through the
normal homelab GitOps release path; never activate the unpublished digest marker.

## Packaging

Cargo Packager describes an NSIS Windows installer. Development builds are
unsigned previews. Do not distribute them as a signed release. A friend-facing
release requires the configured Windows signing identity, timestamped app and
installer signatures, real Windows install/launch verification, and published
release artifacts. No auto-update endpoint is enabled in this preview.

Build the preview with `bun run --cwd packages/glitter-boys-launcher package`.
The installer is written to `dist/` and uses a per-user installation with Start
menu and desktop shortcuts. Uninstalling the launcher preserves the game library.
The portable build is `target/release/glitter-boys.exe`. The installed root holds
a stable bootstrap and `current.json`, with executable payloads in
`versions/<version>/`. Repairing the installer resets its bundled active version.

`release-profile.json` pins the channel, manifest location, Ed25519 public keys,
and exact Authenticode publisher subject. Preview has no trusted keys or
publisher. For a signed release, provision that public profile plus the signing
certificate and private Ed25519 key through the repository credential workflow.
The build expects `WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT` and
`GLITTER_BOYS_UPDATE_SIGNING_KEY` (PEM); neither belongs in the tree.

Run `bun run --cwd packages/glitter-boys-launcher release` in a Windows signing
environment with the SDK signing tool available. It timestamp-signs the app and
NSIS installer, verifies signatures, creates a hashed ZIP, signs the channel
manifest, and retains PDBs outside the public artifact folder. Keep those symbols
private. The script prepares artifacts; it does not publish them or provision a
Windows CI runner. Use the repo-owned static-site release path to publish immutable
`launcher/releases/<version>/` artifacts before the channel manifest.

The updater validates the signed manifest, version/channel/expiry/target, ZIP
size/hash, extracted executable hash, and Windows publisher. Interrupted staging
can reuse a revalidated payload. It switches the active pointer only on exit once
game tasks have stopped. Startup marks the new version attempted before launch
and healthy after the library and GUI initialize. A failed startup rolls back on
the next start. The previous version and newer staged updates are kept. Older signed payload
folders are checked against their manifests before cleanup; unrecognized folders
are preserved. Portable builds cannot apply updates.

Before distribution, verify the signed installer on a clean Windows x64 account,
upgrade from the previous signed release, exit during active work, interrupt
staging, test failed-startup recovery, and uninstall while preserving the game
library. Source tests do not substitute for those signed native acceptance checks.

The UI embeds Luckiest Guy and Atkinson Hyperlegible. Their license files are
included under `assets/`; no font downloads are needed at runtime.

Hosted downloads belong to the repo-owned homelab release path. Source checks,
CI, artifact signing/publication, and live user acceptance are separate gates.
