# The Storm server image

`ghcr.io/shepherdjerred/the-storm-server` is the image `minecraft-tsmc` runs:
[itzg/minecraft-server](https://docker-minecraft-server.readthedocs.io/) with
Paper pre-patched, every plugin jar baked in and checked by sha256, and the
repository's config for those plugins. Kubernetes supplies only secrets and
server identity (seed, difficulty, MOTD) through the chart values in
`packages/homelab/.../games/minecraft-tsmc.ts`.

It is the `the-storm-server` target in `docker-bake.hcl` (infra group, build
context `packages/the-storm`). CI builds it when anything under `plugin/` or
`server/` changes, and the version commit-back pins its digest in the version
catalog (`shepherdjerred/the-storm-server`).

## Build and check locally

```bash
docker buildx bake --load the-storm-server                              # the-storm-server:dev
docker buildx bake --set the-storm-server.target=smoke the-storm-server # jar pins, jar set, plugin descriptor
packages/the-storm/server/boot-check.sh the-storm-server:dev            # fresh and legacy-volume boots
```

`boot-check.sh` boots the image with the chart's pod security (uid 1000, gid
3000, read-only root) in two scenarios, and fails unless every boot reaches
Done with every plugin enabled:

- **fresh**: two boots on a new volume, the second with `--network none`.
  `the-storm.db` and other runtime files survive, `REMOVE_OLD_MODS` leaves
  exactly the image's jars, and the patches apply.
- **legacy**: a volume pre-filled with the config tree the old
  `minecraft-tsmc` init container copied (from git history), which is what the
  live volume holds. On the first boot the patch step accepts those older
  files, `remove.list` clears the stale copies, and the patches land. A second,
  offline boot with a recreated `spawn.yml` and one line appended to
  `remove.list` runs only the new entry.

## Stages

| Stage     | What it does                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin`  | `gradle -p plugin :dist:shadowJar` on Gradle 9.7.1 / Corretto 25 (the `.mise.toml` pins) → `TheStorm.jar`                                                           |
| `fetch`   | `fetch.sh` downloads everything in `plugins.json` and fails on any sha256 mismatch, then pre-patches Paperclip                                                      |
| `release` | The itzg base (same digest as the catalog's `itzg/minecraft-server`) plus the jars, the bundle and the entrypoint                                                   |
| `smoke`   | Asserts the jar pins, the exact jar set, TheStorm.jar's `paper-plugin.yml`, `$put`-only patches, a well-formed `remove.list`, and that uid 1000 can read the bundle |
| `image`   | The published image                                                                                                                                                 |

## How a boot works

1. `storm-entrypoint` deletes each file in `remove.list` once: an entry is
   appended to the ledger `/data/.the-storm-removed` after it runs and is
   skipped on every later boot, so appending a line runs only that line and a
   file recreated later (such as `spawn.yml` after `/setspawn`) is kept. It
   then mirrors each directory listed in `owned.roots` into `/data` with
   `rsync --delete` (none yet; reserved for content-only trees such as
   `plugins/TheStorm/content/quests`), and execs itzg's start script.
2. itzg deletes every top-level jar in `/data/plugins` (`REMOVE_OLD_MODS`),
   then copies `/plugins` into `/data/plugins`: the baked jars and every file
   under `server/owned/plugins/`. Files are overwritten when they differ
   (`SYNC_SKIP_NEWER_IN_DESTINATION=false`) and never deleted, so plugin data
   folders, databases and runtime files are left alone.
3. itzg copies Paper's default configs from `/opt/paper-defaults`
   (`PAPER_CONFIG_DEFAULTS_REPO`) where `/data` has none, applies
   `patches/*.json` (`PATCH_DEFINITIONS`), interpolating `${CFG_*}` env, then
   starts Paper from `/opt/paper` without a download (`PAPER_CUSTOM_JAR`,
   `-DbundlerRepoDir=/opt/paper`).

A patch whose target file does not exist yet only logs a warning, so on a
fresh volume a plugin's config is patched from its second boot on. A failing
patch operation stops the boot (exit 2, a crash loop). `$set` fails when its
leaf key is missing, and every operation fails when its parent is missing, so
patches use only `$put` on the leaf's parent (the smoke stage enforces it),
and every parent must exist in both the plugin's current default and the old
copy on the live volume (`boot-check.sh`'s legacy scenario covers the latter).
Only string values are interpolated: put `${CFG_*}` in a leaf, never inside a
map value.

## Where each config lives

- **`owned/plugins/<Plugin>/…`** (overwritten every boot): files the
  repository authors completely and the plugin never rewrites.
- **`patches/<plugin>-<file>.json`** (keys forced every boot): files a plugin
  generates and rewrites or migrates itself. A patch forces only the keys that
  differ from that plugin version's default.
- **Chart values / env** (`minecraft-tsmc.ts`): `server.properties` values and
  secrets.
- **Runtime** (the volume, backed up by Velero): worlds, databases and
  anything players or admins change in game.

## Jar set

Every third-party jar is the one `minecraft-tsmc` loaded before this image
(its former `pluginUrls`), except where noted. Each stays until the TheStorm
module that replaces it ships (see `../README.md`). To change one, download
it, record its sha256 in `plugins.json`, and run the smoke and boot checks.

| Plugin          | Version                              | Jar in the image                | Source                                                                                                                 | Why it is here                                                                      |
| --------------- | ------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| BlueMap         | 5.27                                 | `BlueMap-5.27.jar`              | [github.com](https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.27/bluemap-5.27-paper.jar)              | Web map at bluemap.ts-mc.net; stays. Bumped from 5.23                               |
| ChestSort       | 1.1                                  | `ChestSort-1.1.jar`             | [cdn.modrinth.com](https://cdn.modrinth.com/data/LDkz4P10/versions/jOP2uPPT/ChestSort-1.1.jar)                         | Until the `qol` module                                                              |
| Chunky          | 1.5.3                                | `Chunky-1.5.3.jar`              | [cdn.modrinth.com](https://cdn.modrinth.com/data/fALzjamp/versions/MdY6JATr/Chunky-Bukkit-1.5.3.jar)                   | World pregeneration; stays                                                          |
| ChunkyBorder    | 1.2.23                               | `ChunkyBorder-1.2.23.jar`       | [cdn.modrinth.com](https://cdn.modrinth.com/data/s86X568j/versions/asaBBItO/ChunkyBorder-Bukkit-1.2.23.jar)            | Until the vanilla `worldborder` replaces it                                         |
| CombatLog       | 1.19                                 | `CombatLog-1.19.jar`            | [cdn.modrinth.com](https://cdn.modrinth.com/data/LI8sodAD/versions/xrvVOux2/CombatLog.jar)                             | Until the `qol` module                                                              |
| CoreProtect     | 24.1                                 | `CoreProtect-24.1.jar`          | [cdn.modrinth.com](https://cdn.modrinth.com/data/Lu3KuzdV/versions/3sehX6Sg/CoreProtect-CE-24.1.jar)                   | Block logging and rollback; stays. Bumped from 24.0, which refuses to start on 26.2 |
| CraftBook5      | 5.0.0-beta-05                        | `CraftBook-5.0.0-beta-05.jar`   | [cdn.modrinth.com](https://cdn.modrinth.com/data/jrO7z7l7/versions/5NcWuiCT/craftbook-bukkit-5.0.0-beta-05.jar)        | Until the `mechanics` module                                                        |
| DecentHolograms | 2.10.1                               | `DecentHolograms-2.10.1.jar`    | [github.com](https://github.com/DecentSoftware-eu/DecentHolograms/releases/download/2.10.1/DecentHolograms-2.10.1.jar) | Until `core` TextDisplay holograms                                                  |
| DiscordSRV      | 1.30.5                               | `DiscordSRV-1.30.5.jar`         | [cdn.modrinth.com](https://cdn.modrinth.com/data/UmLGoGij/versions/ATlquwiT/DiscordSRV-Build-1.30.5.jar)               | Until the `discord` module. Pinned; was the unpinned `latest` download              |
| DynamicShop     | 2.6.4                                | `DynamicShop-2.6.4.jar`         | [cdn.modrinth.com](https://cdn.modrinth.com/data/OzSmbRQS/versions/IEILpPIV/DynamicShop-2.6.4.jar)                     | Until the `shops` module                                                            |
| Essentials      | 2.22.0                               | `EssentialsX-2.22.0.jar`        | [cdn.modrinth.com](https://cdn.modrinth.com/data/hXiIvTyT/versions/nY6VN1XH/EssentialsX-2.22.0.jar)                    | Until the `essentials` module                                                       |
| EssentialsSpawn | 2.22.0                               | `EssentialsXSpawn-2.22.0.jar`   | [cdn.modrinth.com](https://cdn.modrinth.com/data/sYpvDxGJ/versions/lc5JHiNJ/EssentialsXSpawn-2.22.0.jar)               | Until the `essentials` module                                                       |
| GravesX         | 2026.4.9.1                           | `GravesX-2026.4.9.1.jar`        | [cdn.modrinth.com](https://cdn.modrinth.com/data/vCFaodCy/versions/JpbCUK5u/GravesX-2026.4.9.1.jar)                    | Until the `qol` module                                                              |
| LevelledMobs    | 4.5.3.2 b159                         | `LevelledMobs-4.5.3.2-b159.jar` | [cdn.modrinth.com](https://cdn.modrinth.com/data/eX8JZ3Zr/versions/dSBu3PRW/LevelledMobs-4.5.3.2%20b159.jar)           | Until the `mobs` module                                                             |
| LuckPerms       | 5.5.71                               | `LuckPerms-5.5.71.jar`          | [cdn.modrinth.com](https://cdn.modrinth.com/data/Vebnzrzj/versions/b0mk8uS6/LuckPerms-Bukkit-5.5.71.jar)               | Permissions; stays                                                                  |
| Lunamatic       | 2.0.8                                | `Lunamatic-2.0.8.jar`           | [cdn.modrinth.com](https://cdn.modrinth.com/data/uA289E2d/versions/F4QSC1D9/Lunamatic-2.0.8-all.jar)                   | No replacing module planned yet                                                     |
| mcMMO           | 2.3.002-SNAPSHOT (Jenkins build 363) | `mcMMO-2.3.002-b363.jar`        | [popicraft.net](https://popicraft.net/jenkins/job/mcMMO/363/artifact/target/mcMMO.jar)                                 | Until the `skills` module. Was hand-placed on the volume. See the warning below     |
| MobArena        | 0.109                                | `MobArena-0.109.jar`            | [github.com](https://github.com/garbagemule/MobArena/releases/download/0.109/MobArena-0.109.jar)                       | Until the `arena` module                                                            |
| PlaceholderAPI  | 2.12.3                               | `PlaceholderAPI-2.12.3.jar`     | [cdn.modrinth.com](https://cdn.modrinth.com/data/lKEzGugV/versions/pIvQcXW8/PlaceholderAPI-2.12.3.jar)                 | Until `core`                                                                        |
| Plan            | 5.8 build 3605                       | `Plan-5.8-build-3605.jar`       | [cdn.modrinth.com](https://cdn.modrinth.com/data/wJQfHhxh/versions/VCtXebje/Plan-5.8-build-3605.jar)                   | Removed in Phase 1 without a replacement                                            |
| ProtocolLib     | 5.4.0                                | `ProtocolLib-5.4.0.jar`         | [github.com](https://github.com/dmulloy2/ProtocolLib/releases/download/5.4.0/ProtocolLib.jar)                          | Until `core`                                                                        |
| Sleeper         | 1.10.8                               | `Sleeper-1.10.8.jar`            | [cdn.modrinth.com](https://cdn.modrinth.com/data/Kt3eUOUy/versions/hvoPVYQT/Sleeper-1.10.8.jar)                        | Until the `qol` module                                                              |
| Towny           | 0.103.2.0                            | `Towny-0.103.2.0.jar`           | [cdn.modrinth.com](https://cdn.modrinth.com/data/Vs77PB2W/versions/pra46LOM/Towny-0.103.2.0.jar)                       | Until the `towns` module                                                            |
| Vault           | 1.7.3                                | `Vault-1.7.3.jar`               | [github.com](https://github.com/MilkBowl/Vault/releases/download/1.7.3/Vault.jar)                                      | Until the `economy` module                                                          |
| VentureChat     | 3.8.0                                | `VentureChat-3.8.0.jar`         | [github.com](https://github.com/Aust1n46/VentureChat/releases/download/v3.8.0/VentureChat-3.8.0.jar)                   | Until the `chat` module                                                             |
| WorldEdit       | 7.4.5                                | `WorldEdit-7.4.5.jar`           | [cdn.modrinth.com](https://cdn.modrinth.com/data/1u6JkXh5/versions/F5ea2ov3/worldedit-bukkit-7.4.5.jar)                | Builder tooling; stays                                                              |
| WorldGuard      | 7.0.18                               | `WorldGuard-7.0.18.jar`         | [cdn.modrinth.com](https://cdn.modrinth.com/data/DKY9btbd/versions/btHBavWa/worldguard-bukkit-7.0.18.jar)              | Until the `towns` protection engine                                                 |
| XConomy         | 2.26.3                               | `XConomy-2.26.3.jar`            | [github.com](https://github.com/YiC200333/XConomy/releases/download/2.26.3/XConomy-Paper-2.26.3.jar)                   | Until the `economy` module                                                          |
| TheStorm        | `plugin/gradle.properties`           | `TheStorm.jar`                  | Built in the `plugin` stage from `../plugin`                                                                           | Our plugin                                                                          |

Paper is `paper-26.2-129.jar` from fill-data.papermc.io, and Paper's default
configs come from [Shonz1/minecraft-default-configs](https://github.com/Shonz1/minecraft-default-configs/tree/6aacbe6355508991ad47b07de8dc7ef1c49430a4/26.2);
both are pinned by sha256 in `plugins.json`.

> **mcMMO's pin will break.** mcMMO publishes 26.2-compatible builds only on
> its Jenkins, which keeps the last 100 builds. When build 363 ages out, the
> `fetch` stage fails (404) and no image builds. Re-pin to a current build
> (new URL and sha256) or host the jar; the `skills` module replaces mcMMO
> later.

Removed from the former set: Multiverse-Core (one survival world, vanilla
nether and end), LWCX (container locks; the `towns` module will protect
containers inside claims, and its `lwc.db` stays on the volume) and
LiteBans (a paid jar; only its config was shipped).

## Config classification

Every file that `packages/homelab/src/cdk8s/config/minecraft-tsmc/` used to
copy onto the volume, and where its content lives now.

- **Defaults** means the old file matched the current plugin's generated
  default, or differed only by an older release's defaults or reworded
  messages, so nothing is carried into the repository. The live volume still
  holds the last copy the old init container wrote: a frozen older version
  that the plugin keeps using (or migrates) until someone deletes it. The
  frozen copies left in place are the BlueMap `plugin.conf` and
  `webserver.conf`, CoreProtect, DecentHolograms `config.yml`, the DiscordSRV
  files other than `config.yml` and `messages.yml`, DynamicShop `config.yml`,
  Essentials `worth.yml` and `custom_items.yml`, LuckPerms, the mcMMO files
  other than `config.yml`, MobArena, Plan, Towny `townyperms.yml` and its
  language override, VentureChat `commands.yml` and `Messages.yml`, Vault,
  WorldEdit, WorldGuard, XConomy and PlaceholderAPI. Keeping them keeps the
  live server's behaviour; delete one to move that plugin to its current
  defaults.
- **Removed** means `remove.list` deletes the live copy once, so the plugin or
  itzg writes a current default (then patched, where a patch exists).

| Old file                                                                                                                   | Now                                           | Notes                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `server.properties`                                                                                                        | Chart values and env                          | Seed, level type, difficulty, MOTD, PvP, spawn protection 0 were already chart values; `PLAYER_IDLE_TIMEOUT=60` added. Query dropped |
| `bukkit.yml`                                                                                                               | Removed; `patches/bukkit.json`                | Doubled spawn limits                                                                                                                 |
| `spigot.yml`                                                                                                               | Removed; `patches/spigot.json`                | Activation and tracking ranges, hunger, item despawn, view and simulation distance 15, thunder chance                                |
| `config/paper-global.yml`                                                                                                  | Removed                                       | Remaining differences were removed Paper options (timings, old chunk loading)                                                        |
| `config/paper-world-defaults.yml`                                                                                          | Removed; `patches/paper-world-defaults.json`  | Anti-xray on, unloaded-chunk ender pearl fix                                                                                         |
| `BlueMap/core.conf`                                                                                                        | `owned/plugins/BlueMap/core.conf`             | HOCON, which patches cannot edit; BlueMap never rewrites it. `accept-download: true`                                                 |
| `BlueMap/plugin.conf`, `webserver.conf`                                                                                    | Defaults                                      |                                                                                                                                      |
| `ChunkyBorder/borders.json`                                                                                                | `owned/plugins/ChunkyBorder/borders.json`     | World borders 20000 / 5000 / 2500. A border changed in game is reset on the next boot                                                |
| `ChunkyBorder/config.yml`                                                                                                  | `patches/chunkyborder-config.json`            | Map label "Edge of the World"                                                                                                        |
| `Chunky/config.yml`                                                                                                        | `patches/chunky-config.json`                  | `continue-on-restart`                                                                                                                |
| `Chunky/tasks/*.properties`                                                                                                | Removed; runtime                              | Generation progress; the old files re-queued a finished pregeneration on every boot                                                  |
| `CoreProtect/*`                                                                                                            | Defaults                                      |                                                                                                                                      |
| `CraftBook/*`                                                                                                              | Removed                                       | CraftBook 3 files; CraftBook5 uses its own `CraftBook5/` folder                                                                      |
| `DecentHolograms/lang.yml`                                                                                                 | `patches/decentholograms-lang.json`           | House-style prefix                                                                                                                   |
| `DecentHolograms/config.yml`                                                                                               | Defaults                                      |                                                                                                                                      |
| DiscordSRV `config.yml` (the old DiscordSRV ConfigMap)                                                                     | `patches/discordsrv-config.json`              | Channel from `${CFG_DISCORD_CHANNEL_ID}`; the bot token comes from `DISCORDSRV_TOKEN`. Both env vars are 1Password secrets           |
| `DiscordSRV/messages.yml`                                                                                                  | `patches/discordsrv-messages.json`            | Channel topics and start/stop messages off                                                                                           |
| `DiscordSRV/alerts.yml`, `linking.yml`, `synchronization.yml`, `voice.yml`                                                 | Defaults                                      |                                                                                                                                      |
| `DynamicShop/config.yml`                                                                                                   | Defaults                                      |                                                                                                                                      |
| `DynamicShop/Shop/*`, `Worth_V2.yml`, `QuickSell.yml`, `Layout.yml`, `Sign.yml`, `Sound.yml`, `Startpage.yml`, `Lang_V3_*` | Runtime                                       | Shop data admins edit in game; the old copies overwrote it on every boot                                                             |
| `Essentials/config.yml`                                                                                                    | `patches/essentials-config.json`              | Teleport cooldown and delay, AFK, homes, newbie kit and message                                                                      |
| `Essentials/kits.yml`                                                                                                      | `owned/plugins/Essentials/kits.yml`           | The `starter` kit                                                                                                                    |
| `Essentials/motd.txt`                                                                                                      | `owned/plugins/Essentials/motd.txt`           | Empty: no Essentials join MOTD (the `messages` module will own it)                                                                   |
| `Essentials/tpr.yml`                                                                                                       | `patches/essentials-tpr.json`                 | Random-teleport range 5000 to 20000. The centre is runtime (`/settpr`)                                                               |
| `Essentials/spawn.yml`                                                                                                     | Removed; runtime                              | Pinned a world UUID; set spawn in game with `/setspawn`                                                                              |
| `Essentials/worth.yml`, `custom_items.yml`                                                                                 | Defaults                                      |                                                                                                                                      |
| `LevelledMobs/messages.yml`                                                                                                | Removed; `patches/levelledmobs-messages.json` | House-style prefix. LevelledMobs 4 failed to migrate the pre-4.0 copy                                                                |
| `LevelledMobs/settings.yml`                                                                                                | `patches/levelledmobs-settings.json`          | Async task tuning                                                                                                                    |
| `LevelledMobs/rules.yml`, `customdrops.yml`                                                                                | Defaults                                      | LevelledMobs 3 files; LevelledMobs 4 backs up `rules.yml` and resets it, and migrates `customdrops.yml`                              |
| `LuckPerms/*`                                                                                                              | Defaults                                      | Groups and permissions are runtime data                                                                                              |
| `LWC/*`                                                                                                                    | Dropped                                       | LWCX is no longer installed; its data folder (`lwc.db`) stays on the volume                                                          |
| `mcMMO/config.yml`                                                                                                         | `patches/mcmmo-config.json`                   | MOTD and mob health bars off                                                                                                         |
| `mcMMO/*` (the other 13 files)                                                                                             | Defaults                                      | Their differences are an older mcMMO's XP and potion defaults                                                                        |
| `MobArena/*`                                                                                                               | Defaults                                      | Arenas themselves are runtime (`MobArena/config.yml`)                                                                                |
| `Plan/config.yml`, `theme.yml`                                                                                             | Defaults                                      | Only the server name differed, and Plan's file is not valid YAML, so it cannot be patched. Plan is removed in Phase 1                |
| `Plan/ServerInfoFile.yml`                                                                                                  | Runtime                                       | Plan's server UUID                                                                                                                   |
| `ProtocolLib/config.yml`                                                                                                   | Removed                                       | Turned on update downloads, which would fight the baked jar set                                                                      |
| `Towny/settings/config.yml`                                                                                                | `patches/towny-config.json`                   | Wilderness stays buildable; unclaiming does not revert terrain                                                                       |
| `Towny/settings/townyperms.yml`, `lang/override/global.yml`                                                                | Defaults                                      |                                                                                                                                      |
| `VentureChat/config.yml`                                                                                                   | `patches/venturechat-config.json`             | Plain white Global chat, no word filter, Towny channel, spam threshold                                                               |
| `VentureChat/commands.yml`, `Messages.yml`                                                                                 | Defaults                                      |                                                                                                                                      |
| `Vault`, `WorldEdit`, `WorldGuard`, `XConomy`, `PlaceholderAPI` files                                                      | Defaults                                      |                                                                                                                                      |
| `ChestSort/*`                                                                                                              | Removed                                       | They configure JEFF Media's ChestSort; the installed ChestSort 1.1 (AshKiano) has no config                                          |
| `BetterSleeping4/*`, `BlueSlimeCore/*`, `DisableVillagerTrade/*`, `LiteBans/*`, `Multiverse-Core/*`                        | Removed                                       | No such plugin is installed                                                                                                          |

`owned/plugins/TheStorm/*.yml` is TheStorm's own configuration, written by the
module work and loaded strictly by the plugin.

## Rolling out to the live volume

The first release onto the existing `minecraft-tsmc` volume:

1. **Announce and back up.** Tell players before the release: existing LWC
   locks disappear at this deploy, and containers inside claims are protected
   again once the `towns` module is switched on. Run an on-demand Velero backup
   of `datadir-minecraft-tsmc-0` and confirm it completed. Keep the server
   asleep until step 6.
2. **Dry-run the patches against the live configs.** Copy the live
   `plugins/`, `bukkit.yml`, `spigot.yml` and `config/` out read-only (for
   example `kubectl cp` from a pod that mounts the volume read-only), put them
   under a scratch `data/`, delete what `remove.list` names, and run the
   patch step the way the image does:
   `docker run --rm -e CFG_DISCORD_CHANNEL_ID=x -v "$PWD/data:/data" --entrypoint mc-image-helper the-storm-server:dev patch --patch-env-prefix=CFG_ /bundle/patches`.
   It must exit 0. A non-zero exit here is a crash loop in production.
   "Unable to patch … it is not an existing file" is expected for the files
   `remove.list` deleted; on the real boot itzg or the plugin recreates them.
3. **Merge**, then make the package public once: open
   <https://github.com/users/shepherdjerred/packages/container/the-storm-server/settings>
   and set "Change visibility" to Public. GitHub has no API for this. Until
   it is public, the `images` step's anonymous-pull check fails, which blocks
   every homelab release.
4. **Wait for the digest.** The catalog starts at the unpublished zero digest;
   a wake before the version commit-back pins the real digest fails with
   ImagePullBackOff.
5. **Prune the old ConfigMaps** (`minecraft-tsmc-server-configs`,
   `minecraft-tsmc-plugin-*`, `minecraft-tsmc-discordsrv-config`) with the
   repository's `release-root` workflow; the Application's automated sync does
   not prune.
6. **First wake.** Expect in the log: `[storm-entrypoint] removed stale …` for
   the `remove.list` files, `REMOVE_OLD_MODS` deleting every top-level jar
   (including the hand-placed mcMMO and LWCX jars and Multiverse-Core), and
   all 29 plugins enabling. mcMMO upgrades its stored data in place.
7. **In game:** `/setspawn` at the windmill (the pinned spawn was removed),
   `/settpr` if random teleport has no centre, check that DiscordSRV relays
   chat and that bluemap.ts-mc.net renders. (Dropping Multiverse loses
   nothing: its only extra world, `world_amplified`, was already unreachable,
   because its folder is gone from the volume and its autoload was turned off
   in e0a72baa90.)

Rolling back to the old chart is not a clean revert: the hand-placed mcMMO and
LWCX jars are gone and must come back from the Velero backup.
