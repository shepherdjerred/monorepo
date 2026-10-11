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

Reinstalling restores launcher-preserved saves before promoting the verified game
directory. If the process stops after promotion, startup verifies the completed
installation and removes its duplicate preserved saves before dropping the queued
job. A later keep-saves uninstall can then reuse those save destinations.

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

Installed games can launch while other games download or unpack. Launches are
serialized, and BO1/BO2 client finalization waits while a Plutonium launch owns its
shared updater. Pause all pauses installations without cancelling a launch;
closing the app cancels its launch observation without terminating the game.
The UI shows Launching until a visible game window appears, excluding launcher
and console windows. After five minutes without a game window, it offers recovery
guidance for sign-in, updates, and errors. This confirms a window opened, not that
the main menu or multiplayer session is ready.

Each game row shows the current step and time-left estimate. Details holds
elapsed time, recent throughput, file sizes, and the underlying operation. Elapsed time includes task-slot waits, excludes pauses, and resets when the
launcher restarts. Parallel archive downloads contribute to one combined download
total and speed. Checking files and unpacking have separate speed samples; their
ETAs do not include later stages or client setup. Estimates appear after a short
warmup and clear after five seconds without progress. Timing is local UI state.

The library distinguishes new installs from paused queue entries using scheduler
snapshots, not stale UI settings. Settings owns the game location, reporting
preference, and updates; Help owns report export and advanced tools. Expected
recovery actions use typed `ActionRequired` errors and `Problem` messages, with
raw error details retained for copying. Successful launch observation indicates
a visible game window, not proof that a multiplayer session is running.

WinSafe owns the read-only Windows window, version-resource, and registry API
wrappers. The core keeps its unsafe-code deny policy without local exceptions.
Missing Microsoft components use Windows PowerShell's `Start-Process -Verb RunAs
-Wait -PassThru`, retaining the UAC prompt, cancellation, and installer exit code.

Settings has General, Storage, and Updates tabs. Storage analysis and cleanup
run on the scheduler under the installation lock, never on the UI thread.
Read-only analysis can run during installations. Settings reports total file sizes
for the selected library, launcher installation and logs, and shared Plutonium
files without counting a nested library or shared download twice. Game details
separate game files, downloads, temporary files, and saves/settings/mods. Sizes
are a snapshot rather than filesystem allocation accounting; refresh after changes.
Cleanup protects every queued game's content-addressed downloads. Cancelling a
paused installation removes only its unshared cache entries, even while another
game downloads. Uninstall requires a valid launcher receipt and a closed game.
An idle installed game can be removed while other games download. Existing
unrelated tasks continue; new writers wait for the removal to finish. Cleanup of
unused temporary files still requires installations to be paused.
It preserves local saves, settings, mods, and screenshots by default in
`.saves/<game>/`, restoring them during the next successful installation in that
library. Shared Plutonium account data and Microsoft components are retained.
Interrupted removals use a journal and can be completed by Free up space.
Recursive mutations reject junctions and links and validate paths under the
selected library before deleting anything.

## Client adapters

- **IW4x:** installs the pinned official launcher, runs `--skip-launch` to update
  a new installation, then starts that launcher for Play.
- **Plutonium:** sets only `t5Path` or `t6Path` while its client is closed,
  preserves unrelated configuration, runs the official updater with
  `-update-only`, and opens the fixed `plutonium://play/` link for the selected
  game and mode after the updater exits. The current updater can remain on its
  **Game is up to date** screen; close that window to continue. Login remains in
  the official launcher. The application never
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

## Release and signing runbook

Cargo Packager describes an NSIS Windows installer. Development builds are
unsigned previews. Friend-facing builds use Azure Artifact Signing with
timestamped signatures on the application, installer, and uninstaller. The app
embeds its icon in both the Windows executable and native window. Signing alone
does not verify installation, gameplay, or public update delivery.

Build and publish a signed release with `bun run --cwd packages/glitter-boys-launcher release`.
The installer is written to `dist/` and uses a per-user installation with Start
menu and desktop shortcuts. Uninstalling the launcher preserves the game library.
The portable build is `target/release/glitter-boys.exe`. The installed root holds
a stable bootstrap and `current.json`, with executable payloads in
`versions/<version>/`. Repairing the installer resets its bundled active version.

`release-profile.json` pins the preview channel, manifest location, Ed25519 public
key, and exact Authenticode publisher subject. Existing 0.1.0 previews need a
one-time installation of the signed baseline to receive that trust configuration.
Portable builds cannot apply updates.

The Windows release environment requires Azure CLI signed in with permission to
use the configured certificate profile, PowerShell 7, Windows SDK signing tools,
and the verified Microsoft Artifact Signing Client 1.0.146 under
`%LOCALAPPDATA%/Microsoft/ArtifactSigning/`. Public account/profile metadata lives
in `scripts/artifact-signing.json`; no certificate private key is exported.
The Ed25519 private key is read from the 1Password Private vault item
`Glitter Boys launcher release`, field `update-signing-key`. CI can supply the
credential `GLITTER_BOYS_UPDATE_SIGNING_KEY` as PEM. Never log it. The key
provisioning script refuses to overwrite an existing public trust configuration.

### One-time Windows setup

Use a normal Windows x64 PowerShell 7 terminal. Release signing is performed on
your PC; Woodpecker builds the hosted site and telemetry service, not this Windows
installer. There is no unattended Windows signing runner.

1. Install Git, mise, Azure CLI, 1Password CLI with desktop integration, PowerShell
   7, and the Windows SDK **Signing Tools for Desktop Apps** component.
2. From the repository root, run `mise install`, `bun install --frozen-lockfile`,
   and `bunx lefthook install`. Cargo Packager is pinned in `.mise.toml`.
3. Install Microsoft's Artifact Signing Client **1.0.146** under
   `%LOCALAPPDATA%\Microsoft\ArtifactSigning\Microsoft.ArtifactSigning.Client.1.0.146\`.
   The required library is `bin\x64\Azure.CodeSigning.Dlib.dll`. The signing script
   checks its Microsoft signature before loading it. Use the
   [Microsoft signing setup instructions](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
   when preparing a replacement PC.
4. Sign in and select the paid subscription containing the signing account:

   ```powershell
   az login
   az account list --query "[].{name:name,id:id,state:state}" --output table
   az account set --subscription "Azure subscription 1"
   ```

5. Confirm the configured account `jerredsigning` and certificate profile
   `publictrust` are Active. Their endpoint is `https://wus2.codesigning.azure.net`.
   `scripts/artifact-signing.json` is the source of truth. Only Azure CLI
   authentication is enabled by this metadata, so a different Azure application's
   login will not authorize signing.
6. The signing identity needs **Artifact Signing Certificate Profile Signer** on
   the profile or an enclosing scope. Owner/Contributor alone does not grant
   signing. Preflight also needs read access to discover the signing account and
   read its certificate profile. See [Microsoft's role instructions](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles).
7. Unlock 1Password. Keep the existing `Private` vault item **Glitter Boys launcher
   release**, concealed field **update-signing-key**. Its Ed25519 public key must
   match `release-profile.json`. Do not rerun key provisioning on an already
   configured release profile.
8. Publication reads **Woodpecker SeaweedFS Credentials** in the Homelab vault,
   fields `SEAWEEDFS_SITES_ACCESS_KEY_ID` and `SEAWEEDFS_SITES_SECRET_ACCESS_KEY`.
   The release commands resolve `publication.env` through the repository's
   `with-service-account.sh` wrapper. On Windows, inject
   `OP_SERVICE_ACCOUNT_TOKEN` into the invoking terminal through the existing
   secret-manager integration; see [toolkit credential setup](../toolkit/README.md#credentials).
   Git for Windows supplies the native Bash wrapper. The build, signer and
   publisher receive only the two resolved site credentials, never vault access.
   The identity needs the existing site-bucket grants described in the
   [site README](../glitter-boys/README.md#hosting). The serving route and DNS
   must be deployed before publication can pass public verification.

Never run `op read` for these fields directly in a terminal: that prints the
secret. Release commands capture credentials in memory. CI may inject the two
publication credentials directly; both must be provided together.
`GLITTER_BOYS_UPDATE_SIGNING_KEY` accepts a secret-manager-injected signing key;
otherwise the owner reads the Private-vault key through desktop integration.
Never paste credential values into commands or files.

### Publish a new version

Run these commands from the repository root:

```powershell
bun run --cwd packages/glitter-boys-launcher release:preflight
bunx turbo run build typecheck test lint --filter=@shepherdjerred/glitter-boys-launcher --filter=@shepherdjerred/glitter-boys
```

Update `[workspace.package].version` in `Cargo.toml`, then run `cargo check` from
the launcher directory to update its `Cargo.lock`. Use a version higher than
the published channel; never reuse a version after publishing any artifact.
Keep the same preview channel, publisher and verification keys for normal
releases. The docs download component reads `published-release.json`, which the
publisher writes only after public artifact and manifest verification. A Cargo
version bump alone never changes the public download. The publication record also
stores the authenticated manifest expiry for the homelab's renewal alerts.

```powershell
bun run --cwd packages/glitter-boys-launcher release
```

The command verifies Windows tools, Azure profile status, update-key trust,
publication access, and that the version is unused **before signing**. It runs
Rust formatting checks, tests, Clippy, and release-script tests; builds and
timestamp-signs the application and bootstrap; signs the NSIS installer and its
embedded uninstaller; creates a ZIP; signs the update manifest; then verifies
the installer and ZIP's executable again before publishing.

Output under `packages/glitter-boys-launcher/dist/`:

| Path                                                     | Purpose                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `glitter-boys_<version>_x64-setup.exe`                   | Installer to copy to your Desktop or share                 |
| `release/<version>/glitter-boys_<version>_x64-setup.exe` | Immutable public installer                                 |
| `release/<version>/launcher.zip`                         | Signed executable payload for the updater                  |
| `release/preview.json`                                   | Ed25519-signed channel manifest                            |
| `*.pdb`                                                  | Private debugging symbols; never upload to the public site |

For review before any upload, use `release:prepare` instead of `release`.
Preparation still checks publication access and requires an unused version.
Inspect the result, then run the validation and retryable publication commands:

```powershell
bun scripts/release/publish-launcher.ts --dry-run
bun run --cwd packages/glitter-boys-launcher release:publish
```

Dry-run verifies the manifest, archive, executable hash, exact Windows publisher,
and timestamped signatures without uploading. It requires Windows. Publication
uploads the installer and ZIP first, verifies public HTTP 200 responses and
hashes, and updates the channel manifest last using a concurrency token. A partial
publication is safe to retry with the **same prepared bytes**. Do not rerun the
build/sign step, because timestamped signatures change bytes.

After artifacts are publicly verified, review and commit the generated
`published-release.json`. Until a verified release is recorded, the page shows
download availability without an active download link. Publish the docs through their registered
site command and normal GitOps route. Confirm the `/docs/launcher/` download
points to the exact release. Do not add a docs link to the site homepage.

### Verify a release before sharing

1. Download the installer from `/docs/launcher/`. In PowerShell, run
   `Get-AuthenticodeSignature -LiteralPath <installer-path>`; expect `Valid`,
   publisher `Jerred Shepherd`, and a timestamp certificate. The stricter script
   is `scripts/verify-signature.ps1`, which compares the full publisher subject.
2. Install into a fresh Windows x64 test account or isolated installation
   directory. Check its Start menu/desktop shortcuts and the signatures of the
   bootstrap, `versions/<version>/glitter-boys.exe`, and uninstaller.
3. Use `--data-dir <fresh-absolute-directory>` for launcher testing. Select a
   fresh game library; never point destructive acceptance tests at your normal
   profile or backup. Verify fresh install, launch, pause/resume, cancellation,
   cleanup, repair, and uninstall while retaining game files and saves.
4. Launch MW2 multiplayer and both modes of BO1/BO2/BO3. A window opening proves
   startup only; group multiplayer and larger Zombies lobbies require separate
   gameplay acceptance. Plutonium login stays in its own window.
5. Open the previous signed installation, check **Settings → Updates**, wait for
   the update to stage, close and reopen. Confirm the new displayed version and
   unchanged game library. Interrupt a staging test and confirm it can retry.
   Test failed-startup recovery in an isolated installation, not the live one.
6. Open **Settings → Share error and performance reports** and test opt-out.
   Check local logs/support export and the live dashboard with reporting on.
   A service outage must not prevent installing or playing.
7. Record exact commands and observations in the PR. Source checks, exact-head
   Woodpecker CI, signed artifacts, public availability, ArgoCD health and real
   game behavior are separate acceptance layers.

### Renew an update manifest

The update manifest expires after **90 days**. Renew it before expiry, even when
there is no new application release. Check its authenticated expiry using the
publication dry-run against a prepared local release; inspect the `expires`
timestamp in its payload for the maintenance date.

```powershell
bun run --cwd packages/glitter-boys-launcher release:refresh-manifest
```

This downloads and authenticates the published manifest and archive, checks the
signed installer and executable, retains the version and artifact bytes, signs a
new 90-day expiry, then uses the same safe publisher. It can renew an expired
manifest if its signing key is still trusted. Add `--prepare-only` to the script
invocation (`bun run --cwd packages/glitter-boys-launcher release:refresh-manifest
--prepare-only`) to validate without uploading. If a newer release wins the
publication race, rerun renewal from the newly published channel.

After either publication or renewal, review and commit `published-release.json`
and deliver it through the normal homelab GitOps release. Prometheus evaluates
that verified deadline independently of the telemetry service: it warns within
14 days and raises a critical alert within three days, including after expiry.
The alert includes the renewal command. Committing and deploying the refreshed
record moves the deadline and resolves the earlier alert. Before the first
verified publication there is no expiry alert. Confirm the rule is loaded and
notification routing works when activating the release. Signing remains a
manual operation on the Windows PC; no server receives the private signing key.

### Recovery and credential maintenance

| Symptom                                      | Action                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure sign-in expired or wrong subscription  | Run `az login`, select the paid signing subscription, and rerun preflight.                                                                   |
| Signing returns 403                          | Check Certificate Profile Signer for the Azure CLI identity and profile scope; subscription Owner is insufficient.                           |
| Profile inactive or identity expired         | Renew identity validation in the Azure portal, then recheck the certificate profile.                                                         |
| 1Password unavailable                        | Unlock the desktop app, check CLI integration and vault access, then rerun preflight. Never recreate the update key as a workaround.         |
| Update key/publisher mismatch                | Stop. Restore the reviewed configuration or follow a deliberate trust migration.                                                             |
| Artifact already exists with different bytes | Bump the version. Published versioned artifacts are immutable.                                                                               |
| Network failure after uploading artifacts    | Retry `release:publish` using the original prepared files. The channel is published last.                                                    |
| Public readback fails                        | Check the repo-owned DNS, tunnel, static-site route, and serving bucket grants; do not publish a docs link prematurely.                      |
| App update fails                             | Keep the current app; retry **Settings → Updates**. Repair with the signed installer if startup fails. Games remain in the separate library. |
| Portable build cannot update                 | Install the signed installer once; portable builds deliberately cannot apply updates.                                                        |

Azure manages certificate private keys and certificate renewal. **Identity
validation** has its own expiry: Microsoft permits starting renewal 60 days
before expiry and requires the portal verification flow. Follow its notification
emails and [identity renewal instructions](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-renew-identity-validation).
Short-lived signing certificates and the 90-day update-manifest expiry are
different mechanisms. Keep the paid Azure subscription active; review the billing
budget and signing usage in that subscription.

For update-key rotation, ship a signed release that trusts both old and new
public keys **using the old private key**. Allow friends to install it before
signing subsequent manifests with the new key. Retain the old key until all
supported baselines trust the new key. A lost key or changed publisher can require
a fresh signed installer; do not silently relax publisher or signature checks.

### Hosted telemetry operations

The homelab owns `launcher.glitter-boys.com`, the `glitter-boys-launcher`
namespace/Application, its immutable service image, the Bugsink DSN grant,
Prometheus scrape and Grafana dashboard **Glitter Boys launcher**. Use the
[homelab release procedure](../docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md)
for deployment and recovery rather than manually editing cluster resources.

Verify `GET https://launcher.glitter-boys.com/healthz` returns HTTP 200, then
check Prometheus `up{namespace="glitter-boys-launcher"}` and
`glitter_launcher_events_total`. Metrics port 9091 is private. A successful
health response does not prove ingestion or Bugsink forwarding: send a controlled
allow-listed event through an isolated release-profile run and inspect both.
Telemetry cannot identify unique users; delivery retries may double-count events.
Native crash dumps and symbolicated stacks are not collected.

The release wrapper injects the existing Woodpecker SeaweedFS site credentials
through the approved service account. The publisher verifies the signed manifest
and installer and refuses to replace
different bytes at an existing version. It uploads immutable
`launcher/releases/<version>/` artifacts to the repo-owned static-site bucket,
then verifies their public HTTP 200 responses and hashes before publishing the
channel manifest. The site deployment preserves `launcher/*`. DNS and the
static-site route must already be reconciled through the homelab GitOps path.
Manifests expire after 90 days; publish a refreshed signed manifest before expiry.
Use a new Cargo version whenever executable or installer bytes change.

The updater validates the signed manifest, version/channel/expiry/target, ZIP
size/hash, extracted executable hash, and Windows publisher. Interrupted staging
can reuse a revalidated payload. It switches the active pointer only on exit once
game tasks have stopped. Startup marks the new version attempted before launch
and healthy after the library and GUI initialize. A failed startup rolls back on
the next start and records the failed version separately from activation state.
The updater waits for a release newer than that failed version instead of
offering it again. Install 0.1.8 or later once to establish this rollback-aware
bootstrap baseline. The previous version and newer staged updates are kept. Older signed payload
folders are checked against their manifests before cleanup; unrecognized folders
and history signed with retired keys are preserved. Current update signatures
remain mandatory. Verified updater ZIPs are removed after staging succeeds;
interrupted downloads remain available for a retry. Portable builds cannot apply
updates.

Before distribution, verify the signed installer on a clean Windows x64 account,
upgrade from the previous signed release, exit during active work, interrupt
staging, test failed-startup recovery, and uninstall while preserving the game
library. Source tests do not substitute for those signed native acceptance checks.

The UI embeds Luckiest Guy and Atkinson Hyperlegible. Their license files are
included under `assets/`; no font downloads are needed at runtime.

Hosted downloads belong to the repo-owned homelab release path. Source checks,
CI, artifact signing/publication, and live user acceptance are separate gates.
