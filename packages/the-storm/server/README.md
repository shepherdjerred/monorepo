# The Storm server image

`minecraft-tsmc` runs `docker.io/shepherdjerred/the-storm-server`: pinned,
pre-patched Paper, TheStorm, the MCBridge agent bridge, twelve supporting
plugins, and repository-owned configuration. The image builds through `docker-bake.hcl`;
CI publishes immutable artifacts and Delivery records accepted selections in PostgreSQL.
Publish and qualify the candidate, complete any required stopped-volume maintenance,
then request its deployment through Delivery.

The Application declares both the image value and Helm's higher-precedence
`image.tag` parameter from that accepted selection. A release replaces
operational parameter overrides with the declared list; recording credentials
remain supplied by the chart's `extraEnv` secret references.

The Storm uses mc-router's default backend for `ts-mc.net`, `mc.ts-mc.net`,
and status checks that send a resolved IP. The pinned mc-router 1.47.2 ignores
`defaultServer` when `externalServerName` is also present, so the Service must
declare only the default annotation. Other servers retain their explicit
hostname routes and take precedence. This keeps the default attached to the
same Service and StatefulSet covered by the world-restoration admission guards.
UDP Query remains private to the forum's status service.

## Delivery preservation interface

The delegated TSMC registration explicitly selects
`minecraftUpgrade.releaseMode: retained-volume-restart` for routine releases.
Delivery applies the exact published image through the existing one-replica
StatefulSet and retained world PVC, then requires owned Argo reconciliation and
the selected image running Ready. A graceful server restart can disconnect
players briefly. It does not create a backup, restore a second world, or run
candidate gameplay on every deployment. The separately scheduled Velero backups
and operator restore procedure remain independent of routine releases.

`verified-restore`, or an older frozen pipeline without `releaseMode`, retains
the full preservation procedure below. That mode waits for an empty server
before the controller closes admission; a late join reopens the unchanged server
and defers the request without disconnecting players. Choosing routine restart
does not authorize world replacement, a progression reset, or image-only rollback.
The entrypoint's existing progression-preparation guard still applies.

`delivery_validation.py` exposes `eligibility`, `snapshot`, `verify`, `recover`,
and read-only `report` for the
source-owned controller. Its immutable request, exact candidate digest and
private journal are supplied by that controller. The interface never accepts
world installation, historical restoration, or an image-only rollback operation.
`restoration-control.py` remains the independent operator restoration mechanism.
Its release and pre-install abort guards accept the upstream Minecraft chart or
Delivery's ChartMuseum mirror only at version 5.2.0, after downloading and
verifying the original archive size and SHA-256. A repository migration therefore
preserves the maintenance lease's image, template, storage and ownership checks;
a different chart or archive requires a separately reviewed contract update.
The effective image tag comes from Helm's `image.tag` parameter; an optional
image value tag must agree. Delivery also supplies an exact `image.repository`
parameter with `forceString: true`; that repository must match the image value.
Duplicate image parameters, foreign repositories, additional image overrides and
unknown parameter fields are refused. A stopped release permits only the exact owned
replica difference after a fresh authenticated Argo normalized comparison proves
every other resource unchanged. Pre-install abort requires the untouched original
template; candidate release requires unchanged acceptance evidence, its recorded
graceful stop, and the accepted template and controller revision. Resolve the
registered Argo reader credential before launching that operator. Other image
checks still require `Synced`.

The snapshot captures original server, template, native volume, route and Argo
source identities before maintenance. Recovery reports use the neutral contract
in `packages/ops-model/src/minecraft-delivery-recovery.schema.json`; they reread
native resource versions, reject retained helpers/copy claims, and never infer
the original source from current health. Delivery independently verifies this
report before settling a separate admin recovery intent. Routine recovery refuses
candidate source selection or production write authorization.

Verification creates a real Velero backup and restores it into the fixed,
source-owned `minecraft-tsmc-delivery-validation` namespace. It compares the
complete source and restored file streams before starting the candidate only
on the restored PVC. Both native volume identities and the original server
incarnation remain fenced throughout the check.

The candidate runs without a ServiceAccount token or production process
credentials. Its image-derived overlay enables only economy, mail, chat,
tracks, towns and tickets, uses local plugin databases, and binds game and
MCBridge listeners to loopback. These are application isolation controls;
the cluster's Flannel networking does not enforce NetworkPolicy egress isolation.
Real MCBridge/Citizens observations must confirm inventory mutation and denied
protected placement, followed by a graceful candidate exit. A dispatched command
alone is insufficient evidence.

The receipt and eligibility formats are defined by
`packages/homelab/src/minecraft-delivery-{receipt,eligibility}.schema.json`.
Python validates those neutral contracts before writing a receipt; Temporal
validates the same source before recording preservation evidence. Private
startup evidence retains allowlisted startup facts rather than raw player logs.
Successful verification reopens the unchanged original and removes only the
exact restored claim after owned candidate/readers and volume attachments are
gone. A retained copy PV changes to `Delete` with UID, resource-version and
full-spec preconditions; normal CSI reclaim must remove both the copy PV and
its recorded ZFS volume before cleanup completes. Interrupted cleanup resumes
from those recorded identities. A failed restore's owned unbound Pending PVC
can be removed without reclaiming the original PV named in its spec. The backup and
private journal remain available for independent restoration. Interrupted or
ambiguous operations retain their journal and ownership for explicit recovery.

This receipt proves restore-copy compatibility. Production reconciliation and
runtime acceptance remain separate requirements after applying the candidate.
Lightweight Python boundary tests run in `test:server`; Paper/gameplay checks
remain local extended acceptance.

## Plugin and configuration ownership

`owned/plugins/TheStorm/config.yml` registers and enables all 27 Storm modules,
including `creative`, `rwf`, and `rwfbots`. The creative world is the recovered
2016 plot map. Keep its Multiverse `auto-load` setting false: Multiverse enables
before TheStorm and cannot obtain its generator then. TheStorm opens existing
legacy or native creative terrain with its plot generator before enabling the
module. Missing terrain, linked files, truncated region files, or two conflicting
terrain stores stop startup; production never creates an empty replacement.
On enable it freezes that world: random ticks are off, so leaves do not decay and
crops do not grow, fire does not spread, vines and snow do not advance, and mob
griefing, TNT, and block-breaking projectiles are off.
Players enter with `/creative` and leave with
`/creative leave`; the visit stores their survival body and gives them an empty
creative one. Recovered plots are the `plots` list in `creative.yml` (a blank
owner is staff-held); the plugin reads that list and never writes it. A recovered
owner can change that plot. Roads, staff-held plots, and every other plot stay
closed, including a piston, fluid, or explosion that would cross an edge.
`thestorm.creative.bypass` builds anywhere. Command blocks, structure blocks,
jigsaws, and command minecarts cannot be placed. Players claim an empty cell
with `/creative claim` or `/creative auto` (two new claims; catalog plots do
not count; staff with `thestorm.creative.bypass` or `thestorm.creative.admin`
are exempt). `/creative name`, `/creative desc`, and `/creative trust` persist
in the claim store. The plugin never writes `creative.yml`. `/creative download`
saves one `x_z.schem` under the plugin data folder `creative-schematics` for
someone to fetch outside the world; it is not mailed. `/creative admin assign`,
`unclaim`, and `scan` require `thestorm.creative.admin`. Scan reports claim
drift and does not rewrite the catalog. BlueMap draws a Plots marker set on
the creative world's maps only; the player-facing map is the map named creative
on `https://bluemap.ts-mc.net/`, beside survival. GrimAC's owned config has no
per-world exemption key, so the module pauses flight and creative-break checks
through Grim's API only while the player's world is creative, then restores the
checks it paused. The module
also refuses to start unless CoreProtect is
recording block, sign, bucket, entity, and WorldEdit changes for that world. The rwf map world is provisioned on live. RWF creates
or loads its explicitly declared owned void lobby before starting gameplay;
it preserves the lobby's identity and saved terrain across restarts.
Storm owns gameplay, economy, chat, towns and locks, quests, NPCs, skills,
arena, moderation, Discord relay, sleep, graves, and native world borders.

The supporting plugins are LuckPerms, WorldEdit, CoreProtect, BlueMap, Chunky,
Geyser-Spigot, floodgate, Multiverse-Core, ViaVersion, ViaBackwards, and
Citizens, and GrimAC. `plugins.json` is the authority for their versions, artifact URLs,
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

LiveMap's generated files use the separate `minecraft-tsmc-bluemap` PVC mounted
at `/data/bluemap`. The world PVC remains backed up; the render PVC is explicitly
excluded because the maps can be rebuilt. The storage init container uses the
same pinned upstream base as the server image and runs `bluemap_storage.py`
before Paper starts.
Its first run copies the original cache and verifies every file by SHA-256,
leaving the original intact. Interrupted copies resume; later boots preserve
new renders instead of copying the original over them. A restored world volume
without a cache initializes a new render volume. After verifying the mounted
maps, the maintenance operator can retire the original using the exact verified
manifest. Removal refuses changes to the original and never selects world files.

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
| `owned/plugins/GrimAC/`                                    | Pinned upstream config and evidence-only punishment commands                  |
| `world-protection/`                                        | Per-dimension anti-xray profiles applied before Paper boots                   |
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

The multiplayer-list icon is `assets/server-icon.png`, rendered at 64×64 from
the original cloud-backed TS in `../../storm-theme/assets/brand/mark.svg`. Run `bun run icon:render`
from the package after editing the source, then `bun run icon:check`.
The image installs it as `/data/server-icon.png` on every boot, replacing any
stale volume copy. `boot-check.sh` verifies its bytes on each boot.

Before copying or deleting any content, `storm-entrypoint` requires
`/data/.the-storm-progression-v1.json` with status `complete` on an existing
world. An unprepared existing volume fails closed. A genuinely new volume
gets a new-world marker; no ordinary boot resets progression.

The entrypoint then processes each `remove.list` file once and records it in
`/data/.the-storm-removed`. Recreated runtime files survive later boots.
Content-only roots are mirrored with checksum comparison and deletion of
obsolete content. itzg synchronizes the baked jars and files, applies patches,
and starts the pre-patched Paper without downloading it.

Anti-xray defaults to mode 3 with air and all Overworld ore heights covered.
The Nether profile includes ancient debris. Authored arena dimensions and the End
disable obfuscation. Existing per-world settings outside the owned anticheat section
are preserved. LiveMap configuration is unchanged and can expose underground areas.

Profiles apply to native initialized dimensions. Paper 26.2 rejects config-only
dimension directories, so the entrypoint never creates them. On a new volume,
provision the worlds and restart before opening authored arenas; the first
generation uses global defaults. Existing native dimensions receive their profile
before Paper starts. An existing dimension without native world-gen settings fails closed.

Grim findings are retained by Safety even while correction rollout is off. The
supported 26.2 artifact is a pinned prerelease; acceptance must cover legitimate
arena abilities and actual cheat cases before enabling corrections. Floodgate
players are exempt in Grim, so its detection covers Java clients.

CoreProtect and Spigot raw chat/command logging are disabled in favor of Safety's
redacted text journal. CoreProtect block, sign, item, entity and session tracking
remain enabled. The game SQLite database uses full synchronous WAL commits; safety
evidence is retained by the restoration policy and has no automatic purge path.

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
identity and fresh level metadata for `wilds` and `peaks`.
The preparation journal seals the receipt hash before installation; changing
metadata and its receipt together invalidates the native preparation proof.

After installation, use `restoration-control.py bootstrap-resources` under the
existing stopped lease, then `remove-writer` before `private-start`. The bounded
transaction refuses existing resource terrain, retains a complete hash manifest
of all other volume data, and requires byte-identical readback. Private startup
requires this proof. It can also complete after a failed private startup has
been stopped; it does not reinstall the historical world or bypass the
installation revision and rollback rules.

Converted historical chunks have their old lighting invalidated. BlueMap
normally omits chunks without native light data, so the repository-owned maps
for restored archive worlds (`plugins/BlueMap/maps/world.conf` and
`map2.conf`) set `ignore-missing-light-data: true` and `ambient-light: 1`.
Full ambient brightness keeps converted chunks with zeroed light arrays
readable; missing lighting cannot hide caves or reproduce night mode. Under the
private restoration lease, `repair-private-map` only verifies that the
installed configurations carry these settings, then reloads BlueMap and queues
a forced full render. It writes no configuration and loads no gameplay chunks.
See the
[BlueMap map configuration](https://bluemap.bluecolored.de/wiki/configs/Maps.html).

Prevent admissions and mc-router wake-ups during the cutover. Preserve the old
image digest and relevant Flipt values. Require exact-head checks and published
image verification before activation.

1. Check for players, active arena games, outstanding graves, pending inventory
   handoffs, and unfinished refunds or teleport charges. Recover player
   belongings before retiring their owning plugin.
2. Provision `wilds` with `large_biomes` and `peaks` with `amplified`
   through Multiverse while the old image is running with Storm gameplay
   disabled. Confirm their NORMAL environment, presets,
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
Borders are declared in `owned/plugins/TheStorm/world.yml`. The restored
main world and `map2` have circular borders (radius 7000 and 12000) inside the
discs their archives were pregenerated as.

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

The catalog's `archives` list binds each restored world to the SHA-256 of its
approved source archive and to that world's SERVER spawn site. Restoration
tools select the sites of one archive's world. Sites in worlds without an
archive, such as Settlement and Rustworks, preserve modern builds. Every
catalog world must be loaded before TheStorm enables towns.

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
| `prepare`                   | Reviewed `--archive-id` and its approved SHA-256                      | Validated archive paths, complete chunk inventory, source file hashes                            |
| `convert-legacy`            | Prepared private copy                                                 | Guarded Paper 1.21.7 conversion and clean shutdown                                               |
| `convert-companions`        | Legacy terrain converted                                              | Individually converted vanilla players, statistics and maps                                      |
| `convert-native-chunks`     | Legacy companion checkpoint                                           | Native 26.2 terrain, embedded entities and block entities                                        |
| `convert-native-companions` | Native terrain checkpoint                                             | Native item codecs, safe player positions, verified beds and map allocation counter              |
| `convert-native-auxiliary`  | Native companion checkpoint                                           | Native entity and POI stores                                                                     |
| `rehearse-native-layout`    | All native archive data converted                                     | Frozen Paper 26.2 startup, native dimension layout and metadata verification                     |
| `fork-native-layout`        | Completed, sealed, unticked archive preparation                       | New private staging reusing the exact native archive conversion; old receipts remain intact      |
| `preserve-heritage`         | Verified native layout                                                | Every saved archive chunk preserved with underground upgrade disabled                            |
| `retain-arena-worlds`       | Heritage preservation and independently verified modern backup        | Sealed Settlement, Rustworks and RWF worlds; no overworld overlay                                |
| `transplant-arenas`         | Heritage preservation and independently verified modern backup        | Optional reviewed arena-column overlay                                                           |
| `restart-arenas`            | Failed transplant whose output matches its historical input           | Reverified inputs and archived failed copy and log                                               |
| `prepare-database`          | Verified separate arenas and the same modern backup and candidate jar | Fresh candidate Flyway histories, retained identity/moderation rows and proven historical owners |
| `prepare-activation`        | Verified arena and identity checkpoints and the same modern backup    | Independent assembled world retaining native RWF, Settlement and Rustworks dimensions            |
| `export-dimension`          | Heritage preservation of a terrain-only archive                       | One sealed native dimension directory for the archive's target world                             |
| `prune-export`              | Sealed terrain-only export                                            | Export pruned to a circular border, with its new manifest; earlier lock rehearsals superseded    |
| `prepare-dimension-locks`   | Exported dimension and a stopped copy of the live database            | Private database copy with that world's historical container locks appended                      |
| `verify-copy`               | Two independent stopped data trees                                    | Complete file hash comparison; symlinks and shared hard links are rejected                       |
| `database-inventory`        | Existing database                                                     | Integrity check, table schemas and row counts without private row contents                       |
| `chunk-extent`              | A region directory, or an approved archive read in memory             | Saved chunk count, bounding radius and continuous origin-centred radius                          |
| `prune-dimension`           | A stopped native dimension directory                                  | Dry-run safety report, or chunks entirely outside a circular border removed                      |

Tools that read a stopped SQLite database (`prepare-dimension-locks`, and
`prune-dimension`'s claim and CoreProtect report) open it immutably and see only
the main file. They refuse a database whose `-wal` or `-journal` sidecar still
holds changes. Checkpoint the stopped copy first, for example with
`sqlite3 the-storm.db 'PRAGMA wal_checkpoint(TRUNCATE)'`.
`prepare-activation` refuses a modern backup holding any world other than the
vanilla dimensions and the retained arenas, so a rerun can't drop `map2`,
`frontier`, `skylands`, `wilds` or `peaks`.

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

Arena merging replaces full-height columns in the catalog's reviewed footprints.
It preserves surrounding blocks, auxiliary records and historical companion data.
Biome cells cover 4×4 columns. Complete cells take the modern arena biome;
partial cells keep the historical biome so surrounding historical columns remain
unchanged. Every differing partial cell is recorded in `biomeBoundary` in the
transplant receipt. Arena blocks still use the exact approved columns.
Referenced modern map IDs require a reviewed map merge before transplantation
can succeed. The tool refuses unexplained
chunk-wide persistent data in partial chunks.

Keep the exported backup in a separate directory outside the historical staging
tree. If a transplant fails before writing its private output, `restart-arenas`
rechecks the catalog, candidate, backup proof and both trees, then archives the
failed copy and log. It refuses an output that differs from the historical input;
it cannot reset or authorize a production installation. A recorded
`ARENA_TRANSPLANT_RESTARTING` checkpoint resumes the same archive after an
interruption, revalidating the inputs, output and log before continuing.

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
records and personal letters are retained. Creative plot claims, trust, and
parked visit bodies are retained with them: a parked body is the survival
inventory of someone who disconnected inside creative, and those plot
coordinates belong to the sealed creative world, which this overworld
restoration does not replace. World-bound staff state, including
spawn overrides, jail coordinates and logout positions, requires an explicit
position migration before import; IP bans can be retained without moving
coordinates. Gameplay tables, teleport usage and migration histories start fresh.
RWF kit selections, inventory layouts and killstreak selections reset with gameplay state.
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
The writer requests 1 GiB and is limited to 2 GiB of memory because the sealed
plan and complete before/after file inventories coexist during verification.
Whole-volume rollback validates that complete original manifest; only a selective
historical export applies the reviewed native-world allowlist.

`creative_install.py` is the separate additive filesystem transaction for this
map. Its sealed payload permits only creative terrain, level metadata and the
Multiverse world registry. It verifies the entire stopped source against the
independent backup, retains the previous registry, resumes owned renames, and
verifies every unrelated survival and player file remains unchanged. It runs
inside the same guarded writer and grants no private startup or acceptance.

For additive creative recovery, use `creative_activation.prepare` on the operator
host to seal only the pinned 110-region archive and its level metadata, plus a
Multiverse registry merge that preserves every existing world. The original
registry export must match the whole-volume backup's file hash. Preparation keeps
its original bytes, including 64-bit world seeds and comments, and appends only
the creative entry. The repository's Bun YAML parser validates the merge; it does
not reserialize existing worlds. Preparation never imports old player data. The
plan validates the complete retained-volume manifest and preserves existing native
worlds without selecting them for replacement. Selective historical exports retain
their separate reviewed world allowlist.
The creative entry disables Multiverse auto-load so TheStorm can attach its enabled generator.
It explicitly selects creative game mode so Multiverse's survival default cannot
override the creative visit body during teleportation.

After independent byte verification and reader cleanup,
`select-creative-candidate --image <qualified-immutable-image>` binds the
unstarted maintenance annotation to the candidate while preserving the original
rollback image and template. It does not select the production GitOps source.
Then use `plan-creative` and `install-creative` with `--staging` and `--candidate`
(the exact gameplay JAR). Installation checks that JAR against the baked image,
uses the same tokenless writer, and records preservation of every unrelated file.
Remove the writer before `private-start`. This additive path retains the current
resource worlds and uses separate creative acceptance checks; it cannot borrow a
historical installation or resource-bootstrap receipt. Once private startup has
occurred, replacement requires whole-volume recovery.

Keep routes closed while the registered retained-volume Delivery pipeline selects
the same qualified candidate and reconciles ArgoCD. Run private acceptance against
the final Pod/container incarnation after that reconciliation. Acceptance covers
creative terrain/generator, claims/permissions, inventory isolation, CoreProtect
lookup/rollback, original survival/player preservation, other modules, maps and
private admission. Only the accepted, gracefully stopped incarnation can release
the restoration lease and restore its captured public selectors.

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
For a server already in `CrashLoopBackOff`, use `acquire-stopped` instead of
`acquire`. It requires the owned container's termination record and refuses a
running process, sidecar, or init container; an RCON failure alone is never
evidence of an empty server. Route closure and all lease admission probes still
apply. To retain a previous restoration's independent storage, pass a new
`--restore-namespace minecraft-tsmc-restore-<request-prefix>` on every command.
The journal binds that namespace before creating its first Restore and refuses
later changes.
Classify that exact namespace and claim in the homelab backup policy and reconcile
it through GitOps before creating the restore. A new namespace does not inherit
the default restore namespace's admission classification.
Service admission binds the parent lease, requires closed selectors and the same
request owner, and refuses replacement until the parent lease is released.
Before that parent exists, normal Service creation is allowed for bootstrap;
a leased parent cannot disappear because its deletion guard remains active.
A failed or interrupted acquisition resumes from its private journal
and retains closed admission. Ordinary live harness access refuses while the
restoration lease is held.

With the same journal and lease, `backup` creates or resumes an owned Velero
backup of the exact recorded PVC and PV. It requires closed routes, stopped
replicas and no mounted source-volume pods, and accepts completion only with
exactly one successful volume snapshot. `restore-backup` restores only storage
resources into `minecraft-tsmc-restore`; it cannot restore a production workload
or route. If an owned Backup has finished as failed, `retry-backup` retains its
identity and requests a new numbered Backup under the same stopped lease. It
refuses active backups, replaced owners, any writer authorization, or an existing
independent restore. After retrying, use `backup` to poll the new attempt. Never
accept a partially failed copy as rollback evidence. The restore claim is
explicitly excluded from scheduled backups.
If a native Restore fails before creating its claim, `retry-restore` retains the
failed identity and requests a numbered Restore from the same completed Backup.
It requires the same stopped lease, exact failed native owner, no production
write authorization and no existing target claim. It never deletes a failed
restore's independent storage. Fix admission failures before retrying; never
accept the partially failed Restore as a completed rollback proof.
If OpenEBS has already created a copy and refuses another restore to that
namespace, `renew-restore` preserves all failed objects and starts a new Backup
in the same stopped lease. It seals the new restore target to Delivery's
source-owned validation namespace, requiring that namespace to contain no pods
or claims. This transition is allowed once, before any writer authorization or
retained reader. Poll `backup`, then `restore-backup`, using
`--restore-namespace minecraft-tsmc-delivery-validation` for this journal's
remaining operations. The new independent restore must complete and pass the
same whole-volume byte verification; retained failed copies never become proof.
The recorded claim, PV and native CSI volume handle must all identify distinct
storage. Both commands report pending controller work and can be repeated.
Controller warnings remain recorded for operator review. A completed restore
keeps byte verification pending. `verify-backup` creates two request-owned,
read-only volume readers using the recorded immutable rollback image. Readers
reference their namespace's Docker Hub pull Secret. Before creating a reader in
the request-owned restore namespace, the controller declares a lease-owned
`OnePasswordItem` using the production reader's item reference and waits for
the operator to reconcile it. It never reads or copies Secret values. The
installation writer inherits the production namespace's pull reference.
Readers
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
UID and resource-version preconditions. It retains removed UIDs as history and
clears their current bindings only after observing deletion, so a later
verification can bind newly created read-only helpers. These operations leave the independently
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

## Additional archive worlds

Every `world-restore.py` journal names a reviewed archive: `prepare --archive-id`
selects its source SHA-256, ZIP root, chunk and player counts and target
dimension from the registry in the script. `main-map1-2015-07-09` is the
primary archive; it alone replaces the main overworld, player data, maps and
identity database through the operations above. `main-map2-2016-01-10` (source
ZIP `3fb8100f…`, 1,828,991 chunks) restores terrain only, as the `map2`
dimension. Journals written before archive selection can only name Map 1.

A terrain-only archive runs `prepare`, `convert-legacy`,
`convert-native-chunks`, `convert-native-auxiliary`, `rehearse-native-layout`,
`preserve-heritage`, `export-dimension` and `prepare-dimension-locks`. Player,
statistics and map conversion, arena retention, identity preparation and
activation refuse its journal. Its playerdata never replaces the live Map 1
progression, and its `map_*.dat` files stay out because their ids collide with
Map 1's restored maps. Converter deadlines grow with the reviewed chunk count.
The rehearsal keeps the archive's own seed; Map 2's archived spawn `0,70,9`
stands on a top slab, so its reviewed safe spawn is `0,70,8`. Preservation
covers every saved chunk and every protected chunk of that archive's catalog
world, with the same underground-upgrade and lighting metadata as Map 1.

`export-dimension` copies the preserved dimension byte for byte to
`dimension-export/world/dimensions/minecraft/<dimension>`: region, entity and
POI stores plus `data/minecraft` and `data/paper` metadata. Paper's per-world
`paper-world.yml` stays out. The receipt records the archive's world UUID, seed,
spawn and chunk counts. `prepare-dimension-locks --database <copy>` runs
`NativeHistoricalLocks.java` in additional mode against a copy of a stopped
database. It first founds the world's PLAYER sites as towns with their mayors,
refusing a town id, name or mayor membership that already exists. It then
refuses existing locks in that world or a reused request, appends the world's
container locks and verifies every other row unchanged. Map 2 owners come from
signs, archived forum rosters and bed spawns, resolved through the archived
playerdata. Every Map 2 build keeps at least two, normally three, chunks of
protected buffer, and Map 2 spawn is one 1,024-block square. A mayor who already
leads a Map 1 town keeps construction rights on a HERITAGE site instead of a
second active town. Buffer chunks and unidentified holdings stay in staff
custody. Rerunning the operation after a catalog revision retains the earlier
preparation under `superseded/`.

`chunk-extent --shape square|circle` measures a world's saved chunks from a
region directory, or from an approved archive's headers in memory. Chunk `x`
covers blocks `16x..16x+15`, and every shape is centred on the block corner
`0,0`. The square shape reports the bounding radius and the largest
origin-centred square with no missing chunk; radius `R` covers blocks
`-R..R-1`. The circle shape reports the largest whole-block radius whose disc
meets only saved chunks, and the smallest whole-block radius whose disc wholly
contains 100%, 99.99% and 99.9% of saved chunks.

| World | Saved chunks | Square bounding | Square continuous | Circle continuous | Circle 100% | Circle 99.99% | Circle 99.9% |
| ----- | ------------ | --------------- | ----------------- | ----------------- | ----------- | ------------- | ------------ |
| Map 1 | 638,647      | 208,048         | 5,104             | 7,196             | 290,549     | 12,247        | 9,055        |
| Map 2 | 1,828,991    | 12,208          | 8,640             | 12,196            | 12,235      | 12,218        | 12,213       |

Both archives were pregenerated as discs, so their circular continuous radius
exceeds the square one. Map 1's 100% radii come from a few isolated chunks,
the farthest near block `-203000,-208000`; 63 chunks lie outside its 99.99% disc
and 638 outside its 99.9% disc.

### Pruning beyond a circular border

The Storm's borders are circles centred on block corner `0,0`: radius 7000 in
`world` and 12000 in `map2`. `prune-dimension` removes every saved chunk that
lies entirely outside the disc from a stopped native dimension's `region`,
`entities` and `poi` stores. Chunks that intersect the disc stay. Region files
wholly outside are deleted; partial regions are atomically rewritten with the
outside chunks' location and timestamp entries cleared, leaving every kept
chunk's bytes unchanged. The receipt records the plan, per-store chunk counts
before and after, deleted region files and the resulting header hashes.

Without `--apply` it only writes a dry-run receipt and safety report:
heritage and parcel chunks from the shipped catalogs that lie entirely outside,
and, with `--data`, town claims from the stopped `plugins/TheStorm/the-storm.db`
and player-placed CoreProtect blocks outside, grouped by player. `--apply`
refuses while any claim, parcel or heritage chunk lies entirely outside unless
`--allow-outside-claims` is passed. It refuses links and held save locks.
`--no-server-data` states explicitly that a standalone export has no server
state. `prune-export --staging <dir> --radius 12000` applies the same rule to a
sealed terrain-only export through its journal; Map 2's installable export is
pruned this way, removing 58,899 of 1,828,991 chunks and 40 region files.

To prune Map 1 on the live volume:

1. Close admission and stop Paper under the restoration lease
   (`restoration-control.py preflight`, `acquire`), then take and verify a fresh
   Velero backup (`backup`, `restore-backup`, `verify-backup`).
2. From a writer that mounts the stopped data volume, run the dry run:

   ```bash
   python3 world-restore.py prune-dimension --data /data \
     --dimension /data/world/dimensions/minecraft/overworld --world world \
     --radius 7000 --receipt <new-private-receipt>
   ```

3. Review its town claims, parcels, heritage chunks and per-player placed
   blocks outside the disc. Resolve or explicitly accept each one.
4. Repeat with `--apply` and a new receipt, adding `--allow-outside-claims`
   only for reviewed exceptions. Keep both receipts with the backup.
5. Start privately and confirm the border, spawn and a sample of kept chunks
   before releasing the lease.

### Installing an exported dimension

Paper 26.2 stores each Multiverse world at
`/data/world/dimensions/minecraft/<name>`. Multiverse 5.8 imports a directory
that already contains native `data` and `region` entries, keeping its stored
UUID, seed and spawn.

Precondition: `map2` must be installed and imported before any image whose
`heritage.yml` lists it starts. TheStorm deliberately refuses to enable and
stops the server while a heritage catalog world, or a town or parcel world, is
not loaded; it never runs with that world unprotected.

1. Close admission and stop Paper under a verified whole-volume backup
   (`restoration-control.py preflight`, `acquire`, `backup`, `verify-backup`).
2. Run `prepare-dimension-locks` against a copy of the stopped
   `plugins/TheStorm/the-storm.db`.
3. Copy the exported `map2` directory to
   `/data/world/dimensions/minecraft/map2` with the volume's server owner and
   modes. Verify every file against `dimension-pruned-files.json` (or
   `dimension-export-files.json` for an unpruned export), and check
   that no other dimension's `data/paper/metadata.dat` holds the export's UUID.
   Replace the database with the lock-prepared copy only while the stopped
   database still matches the receipt's `sourceDatabaseSha256`.
4. Start the server with a catalog that does not list `map2`, run
   `mv import map2 normal`, and check `mv info map2` for the receipt's UUID,
   seed and spawn. Stop it cleanly.
5. Start the image whose catalog lists Map 2. Accept protection at the Map 2
   spawn, its town sites and its imported locks before reopening admission.

The controller has no reviewed writer operation for steps 2 and 3 yet. Until
one exists, perform them only under the stopped lease from step 1.

Converted chunks carry no valid light data; the owned `map2.conf` renders
them as described in [Preparing an existing volume](#preparing-an-existing-volume).
Queue a forced full render of `map2` after the import.

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
