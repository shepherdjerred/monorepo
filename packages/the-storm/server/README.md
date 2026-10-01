# The Storm server image

`minecraft-tsmc` runs `ghcr.io/shepherdjerred/the-storm-server`: pinned,
pre-patched Paper, TheStorm, ten supporting plugins, and repository-owned
configuration. The image builds through `docker-bake.hcl`; CI publication and
the version catalog control its GitOps release.

## Plugin and configuration ownership

All 21 Storm modules are enabled in `owned/plugins/TheStorm/config.yml`.
Storm owns gameplay, economy, chat, towns and locks, quests, NPCs, skills,
arena, moderation, Discord relay, sleep, graves, and native world borders.

The supporting plugins are LuckPerms, WorldEdit, CoreProtect, BlueMap, Chunky,
Geyser-Spigot, floodgate, Multiverse-Core, ViaVersion, and ViaBackwards.
`plugins.json` is the authority for their versions, artifact URLs, and hashes.
Multiverse loads resource worlds before TheStorm; the world module validates
those worlds and does not generate them during startup.

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
| `patches/`                                                 | Selected Bukkit, Paper, Spigot, and Chunky settings forced on every boot      |
| Homelab chart                                              | Server identity, credentials, and service bootstrap                           |
| Persistent volume                                          | Worlds, vanilla inventories, permissions, plugin databases, and runtime state |

Never add `plugins/TheStorm` itself to `owned.roots`: it contains the runtime
database. Floodgate generates its private key on the volume; the image never
owns or copies that key.

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

Use a maintenance window and prevent mc-router from waking the server during
storage work. Preserve the old image digest and relevant Flipt values for
rollback. Do not change production until exact-head checks and publication
have passed.

1. Check for players, active arena games, outstanding graves, pending inventory
   handoffs, and unfinished refunds or teleport charges. Recover player
   belongings before retiring their owning plugin.
2. Provision `wilds` with `large_biomes`, `peaks` with `amplified`, and
   `mining` with `normal` through Multiverse while the old image is running
   with Storm gameplay disabled. Confirm their NORMAL environment, presets,
   saved registration, and automatic loading.
3. Stop the server cleanly. Take a consistent backup of the complete data
   volume and restore it to an independent, isolated volume. A completed
   backup job alone is insufficient.
4. With both servers stopped, run the archive against the actual restored
   data using the new image's script:

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

5. Boot an isolated clone with the release image. Verify startup and
   representative player flows before reconciling production through the
   repository release workflow. Never route the clone to production Discord
   or Microsoft player authentication.
6. Reconcile the published image and chart revision through GitOps. Confirm
   the exact eleven-plugin runtime set, all 21 modules, successful asynchronous
   world checks, brain readiness, and the authenticated Discord bridge.
7. Verify the windmill spawn and altar, mine entrance south of town, trainers
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

Stop admissions and the server. Restore the complete verified pre-cutover
backup, previous image/chart revision, and captured Flipt settings, then
reconcile through the release workflow and check legacy player state.
Do not combine an old plugin database with newer player data: inventory
handoff receipts must stay consistent. Keep the archived state and restore
volume until live acceptance and the rollback retention window are complete.

## Local checks

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
