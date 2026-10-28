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
same Service and StatefulSet.
UDP Query remains private to the forum's status service.

## Delivery

`minecraft-tsmc` releases use `retained-volume-restart`. Delivery applies the
exact published image to the existing one-replica StatefulSet and retained
world PVC, then requires owned Argo reconciliation and the selected image
running Ready. A graceful restart can disconnect players briefly. It does not
create a backup or restore a second world.

Scheduled Velero backups are the only backup. There is no verified-restore
mode, preservation controller, or operator restore procedure in this
repository.

## Plugin and configuration ownership

`owned/plugins/TheStorm/config.yml` registers and enables all 31 Storm modules,
including `creative`, `rwf`, and `rwfbots`. The creative world is the recovered
2016 plot map. Keep its Multiverse `auto-load` setting false: Multiverse enables
before TheStorm and cannot obtain its generator then. TheStorm opens existing
legacy or native creative terrain with its plot generator before enabling the
module. Missing terrain, linked files, truncated region files, or two conflicting
terrain stores stop startup; production never creates an empty replacement.
On enable it freezes that world: random ticks are off, so leaves do not decay and
crops do not grow, fire does not spread, vines and snow do not advance, and mob
griefing, TNT, and block-breaking projectiles are off.
Players enter with `/creative`, arriving at the glowstone crossing, and leave
with `/creative leave`; the visit stores their survival body and gives them an
empty creative one. Other modules can request the same entry flow through the
`CreativeEntry` service. Recovered plots are the `plots` list in `creative.yml` (a
blank owner is staff-held); the plugin reads that list and never writes it. A
recovered owner can change that plot. Roads, staff-held plots, and every other
plot stay closed, including a piston, fluid, or explosion that would cross an
edge. A road between plots the same owner merged can be built on, and a
piston, fluid, or explosion may cross that road. `thestorm.creative.bypass`
builds anywhere. Command blocks, structure
blocks, jigsaws, and command minecarts cannot be placed. Players claim an empty
cell with `/creative claim` or `/creative auto` (two new claims; catalog plots
do not count; staff with `thestorm.creative.bypass` or
`thestorm.creative.admin` are exempt). A claim that saves takes the player to
the center of that plot. `/creative home` returns them to a plot they can
already build on. `/creative name`, `/creative desc`, `/creative member`, `/creative trust`,
`/creative deny`, `/creative flag`, `/creative floor`, `/creative wall`, and
`/creative biome` persist in the claim store. `/creative flag
<name> on` or `off` sets `pvp`, `use`, `vehicle`, `mob-interact`, or `explosion`
for visitors. They default off. Break and place follow the role. A flag does
not change a world gamerule. A floor, wall, or biome choice is stored on the
claim and does not rewrite the plot. Grass, stone, and plains stay the generator
defaults. `/creative clear confirm` restores that plot's footprint, including
its wall, to the generator plus those choices, and does not change the road.
`/creative reset` restores flags and those choices without changing blocks,
members, the name, or the description. `/creative unclaim` deletes a plot the
player claimed themselves once the footprint matches the generator again and
the plot is not merged. Recovered plots stay on `/creative admin unclaim <id>`.
`/creative merge <id>` links the owned plot the player is standing on with
another plot they own that shares a side. The road stays. `/creative unlink`
separates them once that road matches the template and copies members, the
deny list, and flags onto each plot. `/creative save <name>`, `/creative load`,
and `/creative paste <name>` keep a personal schematic of the one plot the
player is standing on, under `creative-schematics/<uuid>/<name>.schem`. Paste
refuses a footprint that is not the generator, a schematic that is not one
plot, and a command block, structure block, jigsaw, or command minecart.
`/creative download` remains the staff-fetchable `x_z.schem`. `/creative rate
<1-5>` stores one score per player. `/creative comment <text>` adds a public
comment, capped by `commentLength` (140) and `commentCap` (20) in
`creative.yml`. The owner deletes the latest comment. Anyone else deletes
their own latest comment. `/creative info` shows the average and the latest
three comments on a claimed plot. A member or trusted player
can build. A trusted player can add or remove members. A denied player cannot
enter that plot or be teleported into it. `/creative tp <id>` visits a plot
the player is not denied on. `/creative home` still returns to a plot they can
build on. The plugin never writes `creative.yml`. `/creative download`
saves one `x_z.schem` under the plugin data folder `creative-schematics` for
someone to fetch outside the world; it is not mailed. `/creative admin assign`,
`unclaim <id>`, `clear confirm <id>`, `move <from> <to>`, and `scan` require
`thestorm.creative.admin`. The console can run unclaim, clear, and move. Assign
and scan still need a player. Unclaim releases that plot and redraws its map
marker without changing blocks. Clear writes the empty spawn footprint first,
leaving the road, then releases it. Move copies one unmerged plot onto an empty
cell, then leaves that same footprint behind. A merged plot is refused. Scan
reports claim drift and does not rewrite the catalog. BlueMap draws a Plots marker set on
the creative world's maps only. Each plot is labelled with its name, or with
the owner's username when it has no name. The player-facing map is the map
named creative on `https://bluemap.ts-mc.net/`, beside survival. GrimAC's owned config has no
per-world exemption key, so the module pauses flight and creative-break checks
through Grim's API only while the player's world is creative, then restores the
checks it paused. The module
also refuses to start unless CoreProtect is
recording block, sign, bucket, entity, and WorldEdit changes for that world. The rwf map world is provisioned on live. RWF creates
or loads its explicitly declared owned void lobby before starting gameplay;
it preserves the lobby's identity and saved terrain across restarts.
Storm owns gameplay, economy, chat, towns and locks, quests, NPCs, skills,
arena, moderation, Discord relay, sleep, graves, and native world borders.

Mechanic III players can build the classic small obsidian frame or the
seven-block-wide, one-block-thick circle, with a wall sign and button on
opposite sides. Put the gate name on line one and the network name on line
three; an unknown name creates a public network, and a blank name uses `central`.
Private and town networks are created with `/stargate network create`; private
network owners manage invitations with `/stargate network invite` and `uninvite`.
Right-click the sign to select another gate, press the button and enter. To fix
the destination, put its name on line two; add `A` on line four to keep that
gate open when its destination and permissions allow. Each player may own up to
four always-open gates across all networks. The gate owner can
break a gate's frame, sign or button to unregister it, or use `/stargate remove
<network> <gate>`. Network and gate records persist in the Storm database.

Gate travel is free and checks network access, town protection and the shared
teleport safety rules. A single rider can bring a boat, minecart, horse, pig or
strider when there is enough safe, permitted landing space. Dismount before
entering Creative. Server-owned world gates use the seven-block-wide
obsidian circle, declared in `stargates.yml` with the origin at the middle of
the bottom row. The sign and button attach to opposite sides, two blocks above
the origin. Each gate must explicitly declare `allowPreservedPortal`; leave it
false unless its exact portal interior has been approved for temporary changes
on preserved land. Even when true, only the configured interior is filled and
cleared; preserved signs are not rewritten. Each
destination needs an explicit landing in its world. Creative's configured landing
must match its entry point, and travel uses the inventory-isolated creative entry
service. The server evaluates the managed
`the-storm-stargates-enabled` flag at startup and fails closed if it cannot
evaluate it; a flag change requires a restart. The welcome-plaza gate is configured
for protected Spawn with an approved interior exception. Place and verify the
reviewed plaza and its destination landings before enabling the flag.
Until the gate registry loads, the plugin cannot distinguish stored gates from
ordinary blocks. It therefore blocks sign edits, edits to obsidian, portal blocks,
signs and buttons, and portal travel across all worlds. If loading fails, the
server logs the failure and those protections remain until a successful restart;
repair the storage issue before restarting.

The supporting plugins are LuckPerms, WorldEdit, CoreProtect, BlueMap, Chunky,
Geyser-Spigot, floodgate, Multiverse-Core, ViaVersion, ViaBackwards, and
Citizens, and GrimAC. `plugins.json` is the authority for their versions, artifact URLs,
and hashes. CoreProtect 25.1 is unpublished, so the image downloads it from
`https://public.sjer.red/the-storm/plugins/CoreProtect-25.1.jar`. That object
sits outside `pr/assets/` and the public bucket keeps it. Compile stays on the
public 24.1 API. Multiverse loads resource worlds before TheStorm; the world module
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
Existing directories owned by another UID retain their ownership and permissions
when the runtime user has write and search access. This includes the separate
render volume root provisioned with Kubernetes `fsGroup` permissions.
Archived world viewers are independently published and do not use this bundle.

BlueMap renders with two low-priority worker threads. This bounds background
map parallelism within the server's three-CPU request while leaving the main
server thread at its normal priority. Monitor tick rate and container memory
during bulk generation and rendering.

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

The entrypoint processes each `remove.list` file once and records it in
`/data/.the-storm-removed`. Recreated runtime files survive later boots.
Content-only roots are mirrored with checksum comparison and deletion of
obsolete content. itzg synchronizes the baked jars and files, applies patches,
and starts the pre-patched Paper without downloading it.

Anti-xray defaults to mode 3 with air and all Overworld ore heights covered.
The Nether profile includes ancient debris. Authored arena dimensions and the End
disable obfuscation. Existing per-world settings outside the owned anticheat section
are preserved. LiveMap configuration is unchanged and can expose underground areas.

Profiles apply to native initialized dimensions. Paper 26.3 rejects config-only
dimension directories, so the entrypoint never creates them. On a new volume,
provision the worlds and restart before opening authored arenas; the first
generation uses global defaults. Existing native dimensions receive their profile
before Paper starts. An existing dimension without native world-gen settings fails closed.

Grim findings are retained by Safety even while correction rollout is off. The
supported 26.3 artifact is a pinned build; acceptance must cover legitimate
arena abilities and actual cheat cases before enabling corrections. Floodgate
players are exempt in Grim, so its detection covers Java clients.

CoreProtect and Spigot raw chat/command logging are disabled in favor of Safety's
redacted text journal. CoreProtect block, sign, item, entity and session tracking
remain enabled. The game SQLite database uses full synchronous WAL commits.
Safety evidence has no automatic purge path.

Required external credentials are supplied through the existing 1Password
grants: Storm Discord token/channel, brain bearer token, RCON credentials, and
the CoreProtect donation key.
The active agent uses the homelab brain service. Unlocked chest theft and
permitted PvP are allowed; ban and temporary-ban recommendations escalate to
human staff. Crier and merchant visits additionally require their production
Flipt flags.

Essentials asynchronously loads the existing windmill spawn chunk and holds
logins closed until its floor and clearance are safe. Arena and shard startup
checks validate their existing chunks, containers, and altar. A startup log
listing all modules alone does not prove these asynchronous checks succeeded.

## World layout

Converted chunks can lack native light data. The owned BlueMap maps
(`plugins/BlueMap/maps/world.conf` and `map2.conf`) set
`ignore-missing-light-data: true` and `ambient-light: 1`, so those chunks stay
readable. See the
[BlueMap map configuration](https://bluemap.bluecolored.de/wiki/configs/Maps.html).

`archive-progression.py --data /data` moves old plugin progression aside on a
stopped volume. It does not compare a restored copy. Worlds and vanilla player
data stay in place. A completed archive does not run again.

The Bukkit world spawn remains at `(0,65,0)`; seasonal door offsets use it.
Storm's player spawn is the existing windmill entrance at `(68.5,69,66.5)`.
Borders are declared in `owned/plugins/TheStorm/world.yml`. `world` and `map2`
have circular borders of radius 7000 and 12000.

## Rollback

An image rollback is the same retained-volume restart: the previous image
starts against the existing world PVC. Scheduled Velero backups remain the
backup. Do not combine an old plugin database with newer player data.

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
with the existing S3 client in `packages/toolkit` (`toolkit pr asset` writes
under `pr/assets/`, which expires after 365 days; a retained jar uses a stable
key, the way CoreProtect does), and
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
