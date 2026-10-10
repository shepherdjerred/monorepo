# The Storm server image

`minecraft-tsmc` runs `ghcr.io/shepherdjerred/the-storm-server`: pinned,
pre-patched Paper, TheStorm, the MCBridge agent bridge, eleven supporting
plugins, and repository-owned configuration. The image builds through `docker-bake.hcl`; CI publication and
the version catalog control its GitOps release.

CI updates the candidate pin `shepherdjerred/the-storm-server`. The live chart
uses the separately accepted `shepherdjerred/the-storm-server/prod` pin. Publish
the candidate first, complete the selected stopped-server progression archive
below, then promote its exact digest into the production pin through a PR.
Candidate publication cannot restart production with an unprepared volume.

The Application declares both the image value and Helm's higher-precedence
`image.tag` parameter from that same production pin. A release replaces
operational parameter overrides with the declared list; recording credentials
remain supplied by the chart's `extraEnv` secret references.

## Plugin and configuration ownership

`owned/plugins/TheStorm/config.yml` registers and enables all 25 Storm modules,
including `rwf` and `rwfbots`, whose world is provisioned on live.
Storm owns gameplay, economy, chat, towns and locks, quests, NPCs, skills,
arena, moderation, Discord relay, sleep, graves, and native world borders.

The supporting plugins are LuckPerms, WorldEdit, CoreProtect, BlueMap, Chunky,
Geyser-Spigot, floodgate, Multiverse-Core, ViaVersion, ViaBackwards, and
Citizens. `plugins.json` is the authority for their versions, artifact URLs,
and hashes. Multiverse loads resource worlds before TheStorm; the world module
validates those worlds and does not generate them during startup.

Players see the map as **LiveMap**. `build-livemap.sh` extracts its frontend
from the checksum-verified BlueMap jar and brands titles, metadata, application
names, error text, and screenshot filenames. The owned icon and social image in
`server/livemap/` match the player docs. It preserves the plugin artifact,
JavaScript API, and upstream credits. Changed assets and translations use
content hashes in their URLs so cached default branding cannot leak through.
The entrypoint copies only these static files into `bluemap/web` on each boot;
it never prunes that webroot or replaces settings, maps, or live data. Non-root
installs use the runtime UID and volume group, including root-owned PVC mounts.
Archived world viewers are independently published and do not use this bundle.

`MCBridge.jar` is built from `plugin/bridge` alongside TheStorm.jar. It serves
the mc-harness agent API on port 25580, which has no Service or ingress and is
reached only through `kubectl port-forward`. It requires `MC_BRIDGE_TOKEN`
(the `storm-brain` 1Password item) and disables itself without one.

Citizens provides the player bodies for story NPCs (`npcs`), survival
companions (`companions`) and Red Warfare bot combatants (`rwfbots`). TheStorm
declares it, CoreProtect and WorldEdit as required `load: BEFORE` dependencies,
so TheStorm does not start without them. Nobody is granted `citizens.*`
permissions; the plugin has no owned LuckPerms configuration and `/npc` stays
operator-only. See [Citizens artifact](#citizens-artifact) for how its jar and
runtime libraries are sourced.

Legacy gameplay jars are retired, including manually installed LWC jars.
The image removes stale top-level jars with `REMOVE_OLD_MODS`; there is no
LWC exception. Their old data is archived during the one-time cutover.

Configuration belongs in these places:

| Location                                                   | Ownership                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `owned/plugins/TheStorm/*.yml`                             | Strict, typed gameplay configuration                                          |
| `owned/plugins/TheStorm/{npcs,quests,shops,arena/arenas}/` | Content trees mirrored exactly on every boot                                  |
| `owned/plugins/Geyser-Spigot/config.yml`                   | Floodgate authentication and Bedrock ports from the first boot                |
| `owned/plugins/BlueMap/core.conf`                          | Map bootstrap configuration                                                   |
| `owned/plugins/Citizens/config.yml`                        | NPC tab-list and player-list defaults, overwritten on every boot              |
| `patches/`                                                 | Selected Bukkit, Paper, Spigot, and Chunky settings forced on every boot      |
| Homelab chart                                              | Server identity, credentials, and service bootstrap                           |
| Persistent volume                                          | Worlds, vanilla inventories, permissions, plugin databases, and runtime state |

Never add `plugins/TheStorm` itself to `owned.roots`: it contains the runtime
database. Floodgate generates its private key on the volume; the image never
owns or copies that key. `plugins/Citizens` is not an owned root either: it
holds Citizens' downloaded `lib/` cache and `saves.yml`, which persists the
story NPC and companion bodies and which Citizens writes hourly and on
shutdown. Bot NPCs never enter that file because `rwfbots` keeps them in an
in-memory registry.

## Startup contract

Before copying or deleting any content, `storm-entrypoint` requires
`/data/.the-storm-progression-v1.json` with status `complete` on an existing
world. An unprepared existing volume fails closed. A genuinely new volume
gets a new-world marker; no ordinary boot resets progression.

The entrypoint then processes each `remove.list` file once and records it in
`/data/.the-storm-removed`. Recreated runtime files survive later boots.
Content-only roots are mirrored with checksum comparison and deletion of
obsolete content. itzg synchronizes the baked jars and files, applies patches,
and starts the pre-patched Paper without downloading it.

Required external credentials are supplied through the existing 1Password
grants: Storm Discord token/channel, brain bearer token, and RCON credentials.
The active agent uses the homelab brain service. Unlocked chest theft and
permitted PvP are allowed; ban and temporary-ban recommendations escalate to
human staff. Crier and merchant visits additionally require their production
Flipt flags.

Essentials asynchronously loads the existing windmill spawn chunk and holds
logins closed until its floor and clearance are safe. Arena and shard startup
checks validate their existing chunks, containers, and altar. A startup log
listing all modules alone does not prove these asynchronous checks succeeded.

## Preparing an existing volume

Historical restoration recreates the resource dimensions without retaining
their old terrain. After `prepare-activation`, run `world-restore.py
prepare-resources` with the same staging, pinned Paper/bootstrap, candidate,
verified modern export and backup proof. This produces only native generator,
identity and fresh level metadata for `wilds`, `peaks` and `mining`.
The preparation journal seals the receipt hash before installation; changing
metadata and its receipt together invalidates the native preparation proof.

After installation, use `restoration-control.py bootstrap-resources` under the
existing stopped lease, then `remove-writer` before `private-start`. The bounded
transaction refuses existing resource terrain, retains a complete hash manifest
of all other volume data, and requires byte-identical readback. Private startup
requires this proof. It can also complete after a failed private startup has
been stopped; it does not reinstall the historical world or bypass the
installation revision and rollback rules.

Converted historical chunks have their old lighting invalidated. BlueMap's
generated map configuration normally omits chunks without native light data.
Under the private restoration lease, `repair-private-map` changes only the
main map's `ignore-missing-light-data` and ambient lighting settings, journals its original bytes,
reloads BlueMap and queues a forced full render. It loads no gameplay chunks
and survives restarts because the generated map file is runtime state. BlueMap
uses full ambient brightness so converted chunks with zeroed light arrays remain
readable too. It cannot use missing lighting to hide caves or reproduce night mode. See the
[BlueMap map configuration](https://bluemap.bluecolored.de/wiki/configs/Maps.html).

Prevent admissions and mc-router wake-ups during the cutover. Preserve the old
image digest and relevant Flipt values. Require exact-head checks and published
image verification before activation.

1. Check for players, active arena games, outstanding graves, pending inventory
   handoffs, and unfinished refunds or teleport charges. Recover player
   belongings before retiring their owning plugin.
2. Provision `wilds` with `large_biomes`, `peaks` with `amplified`, and
   `mining` with `normal` through Multiverse while the old image is running
   with Storm gameplay disabled. Confirm their NORMAL environment, presets,
   saved registration, and automatic loading.
3. Stop the server cleanly. For an archive-only cutover, run the reviewed
   repository script against the stopped data volume:

   ```bash
   python3 archive-progression.py --data /data --archive-only
   ```

   This moves old progression aside on the same volume, records an
   `archive-only` receipt with no backup ID, and preserves worlds and vanilla
   player data. It requires free world session locks, a valid Storm database,
   settled inventory/financial obligations, and unambiguous archive targets.
   Repeating the completed command leaves new progression alone.

   When independent recovery verification is required, take a consistent full
   backup, restore to independent storage, and use verified-restore mode with
   both servers stopped:

   ```bash
   python3 /opt/the-storm/archive-progression.py \
     --data /data --restored-data /restored-data --backup-id <backup-id>
   ```

   The script compares every preserved world's files, including player data,
   and each archived progression target against the restore. It holds world
   session locks, checks Storm SQLite integrity, and refuses outstanding
   inventory or financial obligations. Legacy plugin directories and the old
   Storm database move to `/data/progression-archives/v1/`. Worlds, vanilla
   inventories, LuckPerms, and owned Storm content remain in place. Interrupted
   moves resume against the same backup; a completed archive never runs again.

4. Promote the verified candidate digest into the production catalog pin and
   remove the legacy `DISCORDSRV_TOKEN` and `CFG_DISCORD_CHANNEL_ID` chart refs.
   Reconcile the published image and chart revision through GitOps. Confirm
   the exact runtime plugin set (`plugins.json`, TheStorm, and MCBridge), the
   25 enabled Storm modules, successful asynchronous
   world checks, brain readiness, and the authenticated Discord bridge.
5. Verify the windmill spawn and altar, mine entrance south of town, trainers
   and quest givers, arena join/class/leave and inventory restoration, shops,
   town protection, skills, graves, crier/digest, and trader barters. Bedrock
   and BlueMap have separate live acceptance checks.

The reset affects plugin progression only. On first participation in the new
Storm economy, an existing vanilla player receives 500 crystals once, using
the economy's durable player-seen ledger.

The Bukkit world spawn remains at `(0,65,0)`; seasonal door offsets use it.
Storm's player spawn is the existing windmill entrance at `(68.5,69,66.5)`.
Native border diameters preserve the old radii: 40000 in the main world,
10000 in the nether, and 5000 in the end.

## Rollback

Stop admissions and the server. An archive-only cutover retains old plugin
state locally but creates no independently verified world recovery point.
For verified-restore cutovers, restore the complete pre-cutover backup,
previous image/chart revision, and captured Flipt settings, then reconcile
through the release workflow and check legacy player state.
Do not combine an old plugin database with newer player data: inventory
handoff receipts must stay consistent. Keep the archived state and restore
volume until live acceptance and the rollback retention window are complete.

## Citizens artifact

Citizens publishes only mutable Maven snapshots; the runnable plugin jar exists
only on Jenkins,
`https://ci.citizensnpcs.co/job/Citizens2/<build>/artifact/dist/target/`.
`plugins.json` pins build 4256 (`2.0.44-b4256`, 2026-09-26) by URL and sha256,
as does `tests/e2e/harness/pins.ts`. The plugin compiles against the same
Jenkins jar: `plugin/gradle/libs.versions.toml` pins `citizens` to that build,
`settings.gradle.kts` resolves it through an ivy repository, and
`verification-metadata.xml` checksums it. Jenkins prunes old builds and exposes
no JSON API, so when the URL stops resolving the pin must be re-fetched from a
newer build: download the jar, record its sha256, boot it once against the
pinned Paper build, and update `plugins.json`, `pins.ts` and the catalog pin
with its verification metadata together.

At boot Citizens downloads its own runtime libraries from Maven Central into
`plugins/Citizens/lib/`: Adventure 4.26.1 and its serializers relocated to
`clib.net.kyori`, jspecify, scoreboard-library, phtree, joml, fastutil and
mocha. The relocation step runs inside Citizens with a relocator it also
downloads, so the image cannot pre-bake those jars the way it pre-patches
Paper without re-implementing Citizens' loader. The first boot on a volume
therefore needs egress to `repo1.maven.org`; later boots reuse the cached
`lib/` because the directory is not an owned root. A boot without egress and
without a warmed `lib/` fails Citizens' enable, and TheStorm, which requires
Citizens, does not start.

The Jenkins URL is a single point of failure for image rebuilds. If it is
pruned before a newer build is accepted, the jar should be mirrored the way
`packages/macos-cross-compiler` mirrors its SDK tarballs: a private SeaweedFS
bucket declared in `packages/homelab/src/tofu/seaweedfs/buckets.tf` (for
example `the-storm-artifacts`, `prevent_destroy`), the object uploaded once
with the existing S3 client in `packages/toolkit` (`toolkit pr asset` targets
the public `public-sjer-red` bucket and is not the right place for a jar), and
`plugins.json`/`pins.ts` repointed at the bucket URL with the same sha256 so
`fetch.sh` keeps verifying the bytes. Nothing has been uploaded yet; the pin
stays on Jenkins until that mirror exists.

## Historic land protection

`owned/plugins/TheStorm/heritage.yml` is the mandatory preservation catalog.
It protects Spawn, reconstructed historical towns and dwellings, and the Colosseum
across the full world height. Settlement and Rustworks are protected in their
separate arena worlds. Wilderness remains editable.
Original Towny claim files were not recovered; the displayed boundaries are
reconstructed preservation footprints. Claim flags, unclaiming and town
deletion cannot remove this protection.

Verified editors may intentionally edit only the catalog's proven construction
chunks. Buffers remain in staff custody. Exact shop boundaries and their assigned
owner UUIDs live in `parcels.yml`; provenance distinguishes direct evidence from
reasonable sign/name matches. Permanent historical shops have no rent or
expiry. Public container permissions do not inherit into historical holdings.

The offline restoration imports built-in container locks throughout these
holdings, including furnaces, brewing stands and hoppers. Assigned shop owners
manage their shop's locks; joint owners can open, unlock and manage trust. Town
construction chunks use their identified leadership, with ordinary member
sharing and redstone access initially disabled. Unidentified holdings and
ownership boundaries remain in staff custody. Historical locks retain archived
owner names before those players rejoin, do not consume the ordinary lock quota,
and keep their ownership when a player leaves a town. Hopper transfers require
the same primary owner at every locked endpoint.

The immutable floor blocks destructive environmental changes. Sheep may graze
grass blocks, grass blocks may regrow, and existing crops may age and farmland
moisture may change. Farmland trampling, decorative grass removal, leaf decay,
fire, explosions, mob block changes and cross-boundary mechanisms are denied.
`/town list [page]` and `/town info <name>` expose the shared public directory,
including staff-held sites with their actual member and claim counts.

The catalog does not restore terrain or import town membership. Those are
offline restoration operations that require their own backup and migration
receipts before activation.

## Offline restoration tools

`world-restore.py` prepares the approved archive on independent storage. Each
operation holds an exclusive journal lock, checks its input hashes, and writes
its phase and verification receipts before the next operation can proceed.
Failed copies remain available for inspection. The source archive and successful
input checkpoints remain immutable.

| Operation                   | Required checkpoint                                                   | Result                                                                                           |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `prepare`                   | Approved archive SHA-256                                              | Validated archive paths, complete chunk inventory, source file hashes                            |
| `convert-legacy`            | Prepared private copy                                                 | Guarded Paper 1.21.7 conversion and clean shutdown                                               |
| `convert-companions`        | Legacy terrain converted                                              | Individually converted vanilla players, statistics and maps                                      |
| `convert-native-chunks`     | Legacy companion checkpoint                                           | Native 26.2 terrain, embedded entities and block entities                                        |
| `convert-native-companions` | Native terrain checkpoint                                             | Native item codecs, safe player positions, verified beds and map allocation counter              |
| `convert-native-auxiliary`  | Native companion checkpoint                                           | Native entity and POI stores                                                                     |
| `rehearse-native-layout`    | All native archive data converted                                     | Frozen Paper 26.2 startup, native dimension layout and metadata verification                     |
| `fork-native-layout`        | Completed, sealed, unticked archive preparation                       | New private staging reusing the exact native archive conversion; old receipts remain intact      |
| `preserve-heritage`         | Verified native layout                                                | Every saved archive chunk preserved with underground upgrade disabled                            |
| `retain-arena-worlds`       | Heritage preservation and independently verified modern backup        | Sealed Settlement, Rustworks and RWF worlds; no overworld overlay                                |
| `prepare-database`          | Verified separate arenas and the same modern backup and candidate jar | Fresh candidate Flyway histories, retained identity/moderation rows and proven historical owners |
| `prepare-activation`        | Verified arena and identity checkpoints and the same modern backup    | Independent assembled world retaining native RWF, Settlement and Rustworks dimensions            |
| `verify-copy`               | Two independent stopped data trees                                    | Complete file hash comparison; symlinks and shared hard links are rejected                       |
| `database-inventory`        | Existing database                                                     | Integrity check, table schemas and row counts without private row contents                       |

Converters use the exact pinned Paper bootstrap and verify every library hash.
The conversion guard freezes ticking before world initialization. Whole-world
inventory checks preserve every pregenerated historical terrain chunk.
Heritage preservation changes only generation and lighting metadata in every
saved archive chunk; saved sections, biomes, foundations and records remain
unchanged. This prevents automatic height expansion from generating terrain
inside the restored archive. It grants no additional wilderness protection.
New chunks beyond the saved archive still use the current Minecraft generator.
Because this checkpoint preserves every saved chunk, subsequent claim catalog
refinements do not change its terrain proof. Separate arena retention verifies
that complete preservation receipt and binds the current catalog to the
candidate used for database preparation and activation.

The historical overworld contains only the archive's original structures.
`retain-arena-worlds` preserves the modern arenas in their existing separate
dimensions. The older `transplant-arenas` operation remains available for
explicitly reviewed overlays; it is not part of a pristine archive restoration.

Activation preparation preserves the historical overworld, then copies the
three retained arena dimensions byte for byte. Modern
resource-world terrain and vanilla player progression are excluded. Its native
verifier reads every chunk and persistent entity without running a world. A
separate private repair preserves every unowned historical farm animal while
assigning deterministic IDs to repeated animal identities. It changes only the
duplicate entity UUIDs, verifies every other chunk in the affected region files,
and leaves the historical checkpoint unchanged. Collisions involving owners,
leashes, passengers, plugin data, other entity types or retained arena dimensions
are refused. A complete native scan must then find no remaining collisions.
World UUID collisions, temporary game entities, missing maps and changed map
payloads require explicit resolution before a layout is marked ready. The
main-world generator, safe spawn and continued map allocation are verified again.
This produces private installation inputs; it does not write production data.

`restoration-policy.json` is the reviewed identity retention contract.
`prepare-database` first version-migrates an independent private source copy
through the exact candidate's Flyway migrations. The verified backup is immutable.
Existing retained identities must remain byte-equivalent at the SQLite value
level, and newly introduced identity tables must start empty. Changed migration
checksums fail validation; the tool never repairs migration history.
`database-restore.py` requires a fully checkpointed source database and compares
retained rows using type-preserving hashes. Identity preferences, staff audit
records and personal letters are retained. World-bound staff state, including
spawn overrides, jail coordinates and logout positions, requires an explicit
position migration before import; IP bans can be retained without moving
coordinates. Gameplay tables, teleport usage and migration histories start fresh.
Economy balances, transfers and welcome-grant markers reset together, allowing
returning players to receive the configured starting balance on their next join.
The retention policy must cover every table produced by the current candidate;
unknown tables abort preparation. Historical owner imports use the domain's
stable town IDs and their recorded import time; archive dates do not imply
founding dates.

`NativeHistoricalLocks.java` then surveys the sealed, unticked native world using
the candidate's actual land resolver. It imports only lock records into the
fresh database and reads them back through the gameplay persistence adapter.
Its inventory records every protected container, source block-entity hashes,
archived owner names, joint ownership, and boundary conflicts. Original 1.8 double
chests are grouped before native neighbor updates without changing their blocks.
Containers lacking a saved block entity are inventoried explicitly as absent;
the importer does not fabricate inventories or write terrain. Arena loot and
personal ender-chest storage do not receive these property locks.
Preparation and installation verify the sealed lock receipt, input configuration
and tool hashes, request identity, database counts and disabled sharing defaults.
Plot recovery writes auxiliary archive version 2 with this ownership metadata;
version 1 ordinary locks migrate explicitly when an older archive is read.

`restoration_files.py` provides filesystem primitives for stopped-volume
installation. It has no production CLI. Staging verifies the entire stopped
volume against the sealed original manifest and copies only the native world
and prepared database onto that volume. Complete file readback precedes any
replacement. Journaled renames retain the original world, database and sidecars,
SQLite CoreProtect database and BlueMap cache in a request-owned archive; the
CoreProtect configuration and other bootstrap files stay in place. An
interrupted rename resumes only if both original and staged contents still
match their manifests. Save locks remain held during the transaction. A completed
installation still requires private startup and acceptance. After any startup,
rollback must restore the independently verified whole volume with its paired
rollback image; the archived installation targets alone cannot restore other
plugins' runtime changes. `stage_whole_rollback` prepares every file from that
independent volume and retains its ownership and permission metadata; inability
to preserve access aborts preparation. `commit_whole_rollback` retains the failed
activation's complete root contents and installs the original volume through
resumable renames. Unexpected writes or changed backup bytes abort the operation.
Its completion still requires the controller to select the recorded rollback
image before restarting. These primitives do not acquire a lease, start a pod,
release maintenance or open a route.

Before the first Paper startup, `restoration-control.py revise-installation`
can replace a completed installation with another fully verified activation
layout and immutable candidate image under the same closed maintenance lease.
Pass the replacement digest through `--image` and its staging and jar through
`--staging` and `--candidate`. The controller revokes startup authorization
before rebinding the image. The volume transaction retains the original
rollback archive and the superseded world/database, verifies unrelated files,
and resumes interrupted staging or renames using its sealed revision journal.
It reuses the existing independently verified backup. Any attempted Paper
startup, recorded resource bootstrap, changed storage identity, changed input or foreign helper refuses the
revision; after startup, use whole-volume rollback instead.

The controller's dormant writer template uses the exact candidate image and
mounts only the recorded data claim and bounded scratch directories. It receives
no server credentials or ServiceAccount token and starts no Paper process.
Restoring the volume's UID 0 and UID 1000 files requires filesystem ownership
capabilities; the template grants only `CHOWN`, `DAC_OVERRIDE` and `FOWNER`, with
privilege escalation disabled and a read-only container root. The controller
rejects replaced helper identities, injected credentials, extra containers,
lifecycle commands, host namespaces and broader privileges. Source-volume
readers must be removed before its writer can be accepted.

`restoration-control.py preflight --journal <private-receipt> --request <uuid>
--image <immutable-image>` checks the reconciled Kubernetes admission guards and
records the exact server, claim, volume and Service identities.
The complete policy and binding specifications must match `restoration-guards.json`,
whose consistency with the infrastructure source is checked by the homelab suite.
Only Kubernetes' harmless empty selector defaults are normalized.
Its `acquire` operation verifies an empty server, closes all four Service routes,
disables router wake, stops Paper through its normal grace period, and acquires
the request-owned offline lease. Updates use resource-version comparisons.
Live dry-run probes must demonstrate that StatefulSet, scale and deletion requests
are denied, together with attempts to reopen or delete each of the four Services.
Service admission binds the parent lease, requires closed selectors and the same
request owner, and refuses replacement until the parent lease is released.
Before that parent exists, normal Service creation is allowed for bootstrap;
a leased parent cannot disappear because its deletion guard remains active.
A failed or interrupted acquisition resumes from its private journal
and retains closed admission. Ordinary live harness access refuses and the mining
reset defers while the restoration lease is held.

With the same journal and lease, `backup` creates or resumes an owned Velero
backup of the exact recorded PVC and PV. It requires closed routes, stopped
replicas and no mounted source-volume pods, and accepts completion only with
exactly one successful volume snapshot. `restore-backup` restores only storage
resources into `minecraft-tsmc-restore`; it cannot restore a production workload
or route. The restore claim is explicitly excluded from scheduled backups.
The recorded claim, PV and native CSI volume handle must all identify distinct
storage. Both commands report pending controller work and can be repeated.
Controller warnings remain recorded for operator review. A completed restore
keeps byte verification pending. `verify-backup` creates two request-owned,
read-only volume readers using the recorded immutable rollback image. Readers
use UID 1000 and GID 2000 to read the existing server-owned private files and
group-owned directories, while dropping every capability. They do not change
volume ownership or permissions. Verification streams
the whole volumes through SHA-256 without extracting or saving file contents,
rejects linked or non-regular files, and compares every file except transient
world session locks. The original server remains stopped and all routes stay
closed. Storage and reader identities are checked before and after the comparison;
unexpected writers or replaced readers abort verification. The private receipt
contains hashes only. `export-backup --export-dir <new-private-directory>
--export-proof <new-private-receipt>` copies the approved native terrain, dimension
metadata, maps and Storm identity database from the independent restore. Every
file must match the whole-volume hash proof. The export excludes server
configuration, credentials and modern vanilla player progression. An unexpected
dimension, unsafe archive record, missing file or changed hash aborts the copy;
failed copies remain private for inspection. Its separate receipt pins the
whole-volume proof and exact storage identities. Native arena transplantation and
identity import verify this complete selection again before using it.
`remove-readers` deletes only those recorded helpers with
UID and resource-version preconditions. These operations leave the independently
restored rollback volume in place and do not activate or reopen Storm.

`plan-install --staging <private-historical-preparation> --candidate <exact-jar>`
uses the same controller journal to verify installation inputs without writing
the volume. The historical, activation, identity and export receipts must belong
to this request and identify the same independently restored storage. Generic
local-copy receipts, synthetic acceptance receipts and changed conversion or
retention tools are refused. Every retained arena file must match the actual
production backup's exported hash. The plan pins the candidate plugin, published
image and full installation manifest; it does not grant private acceptance or
reopen admission.

`install` takes the same `--staging` and `--candidate` arguments. It revalidates
the plan, creates the bounded request-owned writer, and checks the gameplay jar
inside the published image before uploading anything. Only world files, the
prepared identity database and operator code enter its scratch directory. The
writer verifies the complete upload and runs the stopped filesystem transaction.
`remove-writer` deletes that exact helper using its recorded UID and resource
version. `private-start` selects the pinned candidate and starts one replica
under the admission guard's `VALIDATING` phase; all public routes remain closed.
Use a local port forward for private acceptance and retain the observed evidence.

`accept --evidence <private-json>` records acceptance only for the running pod's
exact UID, published image digest and candidate plugin. Its `checks` object must
record `VERIFIED` for startup, historical spawn, the town directory, proven plot
editors, heritage protection, historical container locks, grazing and growth, each of the three arenas,
CoreProtect lookup and rollback, retained identities, historical player data,
maps and private admission. The evidence also carries `requestId`,
`candidateImage`, `candidateJarSha256`, `podUid`, `containerId` and `restartCount`.
Acceptance is invalidated if the pod or container changes, and a new private
startup clears earlier acceptance. Acceptance requires the pod's controller
revision to match the StatefulSet's observed template. The receipt retains that
complete pod template; reopening checks it again immediately before clearing
the lease, refusing same-image changes to storage, commands, environment or
template metadata after validation or shutdown.
Release requires the exact accepted incarnation's
recorded graceful stop. Synthetic evidence is not
accepted. `private-stop` gracefully saves and stops this candidate without
opening routes. `release` requires that unchanged acceptance evidence and a
stopped lease, clears the owned maintenance annotations and restores the captured
Service selectors. The Java wake route opens last. Interrupted release resumes
from the same journal, including a successful wake before its final response.
The reconciled ArgoCD Application must declare the accepted candidate in both
Helm image settings before release. The controller checks that declaration and
refuses stale comparisons, pending operations and conflicting image overrides.
Admission also refuses deletion of a leased StatefulSet; acquisition proves
that denial with a server dry run alongside the update and scale probes.

If backup or independent verification fails before any production writer has
been authorized, `abort` can reopen the untouched original server. It requires
the recorded claim, volume, original image, complete pod template and reconciled
GitOps declaration. It refuses unknown source-volume pods, removes only recorded
read-only helpers, and records unchanged abort evidence before releasing the
lease and restoring the captured routes with Java wake last. Interrupted route
reopening can resume. Writer authorization is recorded before any attempt to
create a writer and is never cleared; after that point, use verified whole-volume
recovery instead of aborting.

If private startup fails, keep admission closed and use `private-stop` before
whole-volume recovery. The independently restored PVC remains available. A
`whole-rollback` controller operation recreates only the recorded restore reader
and bounded production writer, checks their identities and the independently
verified storage, and streams the complete restored volume directly between pods.
Configuration and other plugin state remain inside the cluster. The receiver
refuses unsafe, duplicate, linked or unverified entries and checks every scratch
file before the stopped transaction can stage or commit. Source hashes and
storage identities are checked again before commit. Writer creation revokes
candidate acceptance and prior rollback proof; recovery cannot open a route or
start Paper. A staged or interrupted rename transaction resumes without another
transfer. A failed partial scratch transfer requires `remove-writer` and a new
writer before retry; incomplete filesystem staging requires inspection.
The filesystem transaction retains the failed activation while restoring the
original file ownership and permissions.
Run `verify-rollback` after removing the writer. It checks the completed rollback
transaction and every current volume file against the original independent
backup proof, excluding only the retained restoration workspace, then selects
the recorded immutable rollback image. Remove its read-only helpers with
`remove-readers`. Restore that original image through GitOps if the candidate
was already promoted, then use `release-rollback` to restore the captured routes
with Java wake last. The controller requires unchanged verification, removed
helpers, a stopped owned volume and the reconciled original image at both Helm
precedence levels. Recovery release resumes after an interrupted route reopening.
Preflight records the complete original pod template. Acquisition refuses drift
before closing routes and before acquiring the stopped lease. Rollback release
compares that original template again immediately before clearing the lease;
same-image changes to storage, commands, environment or template metadata must
be reconciled to the verified original configuration before reopening.
Creating another writer invalidates both candidate and rollback acceptance.
It also revokes the prior installation authorization before granting write access.
Only a newly verified installation can authorize candidate startup again; a
whole-volume recovery primitive cannot leave a stale candidate start permission.
Do not restart an old image against the activation database or restore only
the overworld after other plugins have run.

The restoration journal and native conversion sources are operator inputs,
separate from the production gameplay jar. Activation requires an independently
verified whole-volume rollback copy, preservation of the other retained arena
dimensions, a fresh CoreProtect epoch, and private acceptance of the matching
published image before public routes reopen.

## Local checks

Real-Paper acceptance uses the local `plugin/dist/build/libs/TheStorm.jar`.
Set `STORM_E2E_PLUGIN_JAR` to an existing immutable jar when reproducing behavior
against a published baseline; the harness still creates a disposable server and
runs the same assertions. This does not select or change the production image.

```bash
bun run --cwd packages/the-storm build
bun run --cwd packages/the-storm test
bun run --cwd packages/the-storm test:e2e
bun run --cwd packages/the-storm test:full
docker buildx bake --load the-storm-server
docker buildx bake --set the-storm-server.target=smoke the-storm-server
packages/the-storm/server/boot-check.sh the-storm-server:dev
```

The full-module suite uses a separate `TheStormFixtures.jar` to prepare
synthetic worlds and blocks at the shipped coordinates. It is never shipped
in TheStorm.jar or the production image. The fake brain and Flipt boundary
exercise gameplay without external AI calls. A deliberately malformed Discord
token tests module wiring without posting externally; it cannot prove real
Discord authentication.

The boot check uses that fixture jar with the chart's security settings:
uid 1000, gid 3000, supplemental group 2000, read-only root, and no capabilities.
Fresh and legacy-config volumes each boot twice, including offline restarts.
The checks cover jar cleanup, runtime database preservation, content delivery,
patch application, all modules, and first-boot Geyser/Floodgate setup.

Java connections through mc-router wake the server from zero replicas.
Bedrock uses UDP 19132 in the pod and public port 30004; this direct UDP route
requires the server to be awake first.
