# The Storm

The Paper plugin behind [The Storm](https://ts-mc.net), a community and economy
Minecraft server (originally 2014–2017, revived on the homelab's
`minecraft-tsmc`). All gameplay code lives in one plugin, `TheStorm.jar`, built
from `plugin/`.

The [promotion manifest](promotion/manifest.md) tracks existing advertising
placements, account references, reusable copy and images, and the manual
daily/weekly maintenance cadence.

## Layout

| Path                               | What it is                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `plugin/`                          | Gradle build (Java 25, Paper API 26.2)                                                                                 |
| `plugin/core/`                     | Shared runtime: module contract, strict config parsing, `Result`, SQLite storage, the scheduler port, house text style |
| `plugin/modules/<name>/`           | One project per gameplay module (economy, towns, quests, ...)                                                          |
| `plugin/dist/`                     | Assembles the shaded `TheStorm.jar` and the plugin entry point                                                         |
| `plugin/architecture/`             | ArchUnit rules that enforce the layering below                                                                         |
| `plugin/tools/rwfmap/`             | Offline rwf map analysis: bakes and verifies the bots' `nav.rwfnav` artifacts (not shaded into the plugin)             |
| `plugin/build-logic/`              | Convention plugins: compiler strictness, formatting, PMD, tests, jOOQ codegen                                          |
| `plugin/bridge/`                   | `MCBridge.jar`, the agent bridge HTTP API (WorldEdit, region reads, snapshots, events); never part of `TheStorm.jar`   |
| `plugin/gradle/libs.versions.toml` | Every dependency and plugin version                                                                                    |
| `brain/`                           | Disabled, manual Mineflayer session for one account; no production sidecar or autonomous gameplay yet                  |
| `playtests/`                       | mc-harness scenarios (Citizens actors on the `storm-dev` sandbox); run with `toolkit mc playtest run playtests/`       |
| `server/`                          | The `minecraft-tsmc` server image: pinned jars, config bundle and patches (see `server/README.md`)                     |

## Commands

Gradle comes from mise (`.mise.toml`); there is no wrapper.

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/the-storm
cd packages/the-storm/plugin
mise exec -- gradle check                  # everything, including PMD and JaCoCo
mise exec -- gradle spotlessApply          # format
mise exec -- gradle :dist:runServer        # local Paper 26.2 with the plugin
mise exec -- gradle bakeRwfMaps            # (re)bake rwf/maps/*/nav.rwfnav for the bots
mise exec -- gradle verifyRwfMaps          # fail if a committed nav.rwfnav is stale (part of check)
mise exec -- gradle resolveAndLockAll --write-locks   # after changing dependencies
mise exec -- gradle --write-verification-metadata sha256 build
```

The jar is `plugin/dist/build/libs/TheStorm.jar`.

## Content admission and evidence

The `safety` module runs before chat. Its shared `core.safety.ContentSafety`
port holds publications asynchronously and records attempts, window verdicts,
scores, final decisions and publication receipts in the permanent
`safety_submission` and `safety_event` tables. The shared moderation contract
comes from `../storm-brain/contracts/content-moderation.json`; the evidence
query contract comes from `../mc-harness/src/protocol/evidence-contract.json`.
Both Java and TypeScript validate their wire fields against these files.

Native chat, message commands, proposed signs and books, anvil names, name tags,
and Discord ingress pass admission before publication. Unknown command arguments
are screened; commands containing only known identifiers are audited directly.
Authentication commands and credential-shaped strings are redacted before storage.
Allowed and rejected text, including DMs, stays in the private archive indefinitely.
Loaded saved signs, containers and entity names are snapshots with unknown creators;
their observers receive no offense attribution. Visual map art is not text screening.

CoreProtect owns block and item history and rollback. Safety adds denied interactions,
inventory metadata, text, and Grim findings with gameplay context. Activity snapshots
retain their original payloads and timestamps in batches of up to 128, with one
activity database job in flight so bursts do not fill the shared writer queue.
Shutdown queues any remaining snapshots before the database closes. Safety requires the
checksum-pinned Grim runtime; development profiles with Safety off can run without it.
Its movement and packet corrections have an
independent managed rollout gate; no automatic ban commands are configured.

Chat filters accept up to 2,000 Unicode code points. Paper's command transport allows
4,096 characters, including the command and recipient; vanilla chat UI remains 256.
Length is a transport/filter limit and never a misconduct strike.

Focused real-Paper acceptance includes `tests/e2e/safety.e2e.test.ts` outside CI.
The evidence tests cover pagination, private exports, interruption recovery and a
stopped-database restore. Operator review uses the existing agent queue plus private
`toolkit mc evidence` queries; see the wiki's safety review procedure.

## Contributor verification

Minecraft CI runs unit tests and one light Paper smoke lane. The smoke command
explicitly selects `tests/e2e/plugin.e2e.test.ts` and
`tests/e2e/server.e2e.test.ts`: startup, plugin loading, client connections and
basic protocol interactions. Keep these files small. The lane builds the
plugin without building the native client and has a ten-minute timeout,
including setup.

Extended Paper and gameplay acceptance is the committer's responsibility
outside CI. Run the suites relevant to the change locally and record the
commands and results in the PR's verification evidence. This policy is a
Minecraft-only exception; other packages retain their normal CI gates.

The disposable fixture plugin enables before TheStorm to prepare its synthetic
worlds. It releases shared plugin resources on TheStorm's disable event, before
the product classloader closes; later fixture shutdown does not repeat cleanup.
Real-Paper fixture verification must inspect the final server log after shutdown,
including unused fixture handlers whose product classes resolve lazily.
Require exactly one `Released synthetic fixture resources` marker during server
shutdown, before TheStorm's database pool starts closing and before the later
fixture disable. The final log must contain no fixture-shutdown or linkage errors.

World-scoped RCON fixtures use namespaced vanilla commands such as
`minecraft:tp`. The unqualified `tp` command shares the plugin's administrative
command surface and can lose the selected dimension through console dispatch.
Wait for client chunks before moving newly connected bots or asserting entity
tracking; the Mineflayer spawn event precedes chunk delivery.

From the repository root, build the plugin and run the desired server suite
with Docker available:

```bash
bun run --cwd packages/the-storm build:plugin
bun run --cwd packages/the-storm test:smoke # the light CI selection
bun run --cwd packages/the-storm test:e2e   # extended gameplay
bun run --cwd packages/the-storm test:full  # all modules together
bun run --cwd packages/the-storm test:load  # 20/50/100-bot load profile
STORM_CAPACITY_MAP=apex-expanse bun run --cwd packages/the-storm test:capacity
STORM_CAPACITY_MAP=apex-expanse bun run --cwd packages/the-storm test:capacity-native
```

Native-client acceptance uses
`bun run --cwd packages/the-storm test:client-native` on a machine capable of
running the Minecraft client. Sandbox gameplay scenarios use
`toolkit mc playtest run packages/the-storm/playtests/` against `storm-dev`;
follow the repository's `minecraft-harness` skill for sandbox ownership and
cleanup. These checks are also committer-run.

## Essentials command surface

`/guide` opens the same welcome book delivered by the starter kit. It is optional
and available to every player; successful opens record `guide_opened` analytics.
The three shipped pages cover getting started, protecting a home, and finding
quests or help. A single delayed arrival tip points back to it. New players
receive iron tools, sixteen cooked porkchops, and the book. The windmill spawn
faces outward toward town.

The arrival dialog gives a two-sentence introduction, twelve biome choices in
title case, and an **Explore Spawn** exit. Escape also closes it. Until a player's
first successful RTP, a personal compass occupies hotbar slot nine; either mouse
button reopens the picker. QoL persists this entitlement separately from the RTP
search throttle, so failed searches, reconnects, restarts and deaths retain it.
The compass cannot be dropped or transferred and does not enter graves. Existing
players do not receive one on migration. A successful RTP through either the
picker or a command clears the entitlement before removing the item.

The console-only `storm-maintenance begin <owner>` atomically checks for human
players and closes login admission when empty. Its versioned JSON response
follows `maintenance-status.json`. Vanished humans count; NPCs do not. Repeating
the same owner is safe. `storm-maintenance end <owner>` reopens admission only
for that owner. The mining-reset worker uses this gate before stopping the
always-running server; a restart clears the in-memory gate.

The Storm implements the selected EssentialsX-style surface inside its own
Essentials, Chat and Mail modules. Commands resolve players by real username
and UUID; nicknames never become command identifiers. `/help` shows the
sender's permitted commands, and `/help <command>` shows usage.

| Audience                       | Commands                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players, existing travel       | `spawn`, `home`, `homes`, `sethome`, `delhome`, `warp`, `back`, `rtp`, `tpa`, `tpahere`, `tpaccept`, `tpdeny`, `tptoggle`                                                                     |
| Players, identity              | `nick`, `realname`, `msgtoggle`, `rtoggle`                                                                                                                                                    |
| Players, communication         | `msg`, `r`, `ignore`, `mail`                                                                                                                                                                  |
| Staff, destinations            | `setwarp`, `delwarp`, `setspawn`, `settpr`, `warpinfo`, `renamehome`                                                                                                                          |
| Staff, visibility              | `seen`, `whois`, `near`, `invsee`, `enderchest`, `socialspy`, `vanish`                                                                                                                        |
| Staff, teleport administration | `tp`, `tphere`, `tpo`, `tpohere`, `tppos`, `tpall`, `tpoffline`, `world`                                                                                                                      |
| Staff, additional travel       | `tpacancel`, `tpauto`, `tpaall`, `top`, `bottom`, `jump`                                                                                                                                      |
| Staff, jail and IP moderation  | `setjail`, `deljail`, `jails`, `jailedplayers`, `jail`, `unjail`, `togglejail`, `banip`, `tempbanip`, `unbanip`                                                                               |
| Staff, player administration   | `fly`, `speed`, `god`, `heal`, `feed`, `gamemode`, `rest`, `ptime`, `pweather`, `suicide`                                                                                                     |
| Staff, server administration   | `time`, `weather`, `thunder`, `broadcast`, `broadcastworld`, `kickall`, `give`, `spawnmob`, `spawner`, `remove`, `kill`, `sudo`, `unlimited`, `powertool`, `powertoollist`, `powertooltoggle` |
| Staff, bounded world effects   | `tree`, `bigtree`, `break`, `burn`, `ext`, `ice`, `lightning`, `fireball`, `firework`, `antioch`, `nuke`, `beezooka`, `kittycannon`                                                           |
| Staff, diagnostics             | `gc`, `ping`, `list`, `playtime`, `getpos`, `compass`, `depth`, `essentials status`                                                                                                           |

Chat channels are Global (`/g`), War (`/war`, `/wc`), Staff (`/sc`) and Town
(`/tc`), which a player can focus with the bare command, plus two that belong
to a match and are reached one message at a time: Team (`/t <message>`) and
Dead (`/dead <message>`). Town, Team and Dead are membership channels: the
module that owns the group registers who is in it through the chat module's
`ChannelRegistry` and cancels the returned `Subscription` when it disables.
The same registry takes routers, which may redirect a player's line before it
is checked (a leading `@` to the team, a dead player's Global to Dead), and
taps, which hear every delivered channel line. NPCs talk through `NpcChat`,
under the same rules as players and never relayed to Discord.

There is no registered `/kit` command. First join silently delivers the
once-only starter supplies and welcome book, retaining durable delivery
receipts and recovery. Players can visit named warps; creating and deleting
warps requires staff permission. Kit administration, virtual workstations and
item utility commands are outside this surface.

New staff permissions are `thestorm.essentials.<command>`, defaulting to OP.
Player identity nodes default to everyone. Acting on another player with a
player administration command requires its `.others` node. Changing someone
else's nickname requires `thestorm.essentials.nick.others`.
Inventory inspection defaults to viewing: `/invsee <username> edit` and
`/enderchest <username> edit` additionally require the corresponding `.edit`
node. Left clicks swap actual items only after the audit commits and both
players, permissions, cursor and slot are checked again. Shift clicks and
drags cannot extract the displayed copies.

`thestorm.essentials.vanish.see` permits seeing vanished staff. Vanish persists
across restarts and hides players from ordinary tab lists, suggestions,
private-message lookup and Discord join/quit and online-player output.
Removing vanish permission or disabling the staff gate reveals online staff.
`tpo` and `tpohere` also require `thestorm.essentials.teleport.override` to
bypass registered teleport guards and land entry checks. Sealed worlds,
world borders and safe landing checks still apply. Ordinary administrative
teleports are immediate and free, with guards and protection retained.
`sudo` dispatches with the target player's existing permissions.
Console and RCON keep the vanilla syntax for commands shared with Minecraft;
in-game staff use the usages shown by `/help`.

Mass operations and destructive effects require repeating the identical
command within the configured confirmation interval. Changed targets require
another confirmation. Staff actions and identity changes have durable audit
rows. Spawn and RTP origins, jail sentences, IP bans, logout locations and
vanish state live in SQLite; commands never rewrite repository-owned YAML.
Jail sentences preserve the return location, survive restart and expire
through the online enforcement sweep. Jailed players retain communication
commands while travel and item/world interactions are blocked.

`/mail` lists reward deliveries and player letters separately. Existing reward
claims remain `/mail claim <reward-id> <choice>`. Letters use
`/mail send <username> <text>`, `/mail read <letter-id>`,
`/mail reply <letter-id> <text>` and `/mail delete <letter-id>`.
Reading opens a virtual book with literal text, without adding an item.
Only the recipient can read or delete a letter. Sending commits before
notification and respects ignores, mutes, message preferences and repeat
filtering. A full inbox refuses new letters without evicting existing ones.

Owned limits are in `server/owned/plugins/TheStorm/expansion.yml`: 2,000 Unicode
code points per letter, ten seconds between sends, 100 active letters per
inbox, 64 entities per operation, 32 blocks of effect radius, 16 blocks of jail
radius and 30 seconds for confirmation. Managed rollout declarations live in
`packages/feature-flags/src/managed-flag-inventory.json`:

| Flag in namespace `the-storm`      | Production/fallback | Beta |
| ---------------------------------- | ------------------- | ---- |
| `the-storm-staff-tools-enabled`    | false               | true |
| `the-storm-identity-enabled`       | false               | true |
| `the-storm-letters-enabled`        | false               | true |
| `the-storm-ip-enforcement-enabled` | false               | true |

IP enforcement additionally requires a verified public address forwarded by
a trusted private PROXY-protocol peer. Private, loopback, link-local,
multicast and shared carrier addresses cannot become ban targets. An enabled
IP gate rejects unverified connections and unavailable login checks. The
server image accepts PROXY protocol; mc-router supplies it, Geyser forwards
Bedrock addresses, and the RLCraft HAProxy sidecar strips the header for Forge.
NodePort services preserve source addresses with `externalTrafficPolicy: Local`.
Backend gameplay ingress is restricted to the router, with Bedrock UDP and
existing management ports preserved. Roll out router and backends together;
the staff and IP flags are independent of that network change.

## Skills

The `skills` module replaces the launch set of mcMMO skills with eleven
persistent skills: Mining, Woodcutting, Excavation, Herbalism, Fishing, Swords,
Axes, Archery, Unarmed, Acrobatics and Repair. Each level is earned on a
1–1000 scale; power level is the sum of those levels. `/skills` shows progress,
`/skills <skill>` shows XP to the next level, and `/skills top` shows the
power-level leaderboard. The state lives in the shared SQLite database;
historical mcMMO player data is archived rather than migrated. The activation
resets plugin progression while preserving worlds, builds, and vanilla inventories.

Gathering and Fishing gain a capped extra-drop chance, combat skills gain a
capped bonus against eligible mobs, and Acrobatics reduces fall damage.
Right-click an iron block with a damaged tool in the main hand and its repair
material in the offhand to use Repair. Spawner-created, scripted quest and
arena mobs and non-mob entities do not give combat XP. Player-placed gathering
blocks, fertilized flowers and grass, and logs grown from player-planted
saplings stay ineligible across restarts through the `skills_placed_block`
table. Block markers follow pistons, falling blocks, and Enderman movement.
The module is enabled alongside retirement of the old mcMMO plugin.

## Citizens NPCs and survival companions

Upstream Citizens owns player bodies, skins and navigation for every scripted
NPC, including guards, trainers and quest givers. Storm retains dialogue,
schedules, combat rules and quest markers. `/stormnpc` owns Storm's commands;
Citizens retains `/npc`. Legacy mannequin bodies are removed only after
Citizens reconciliation succeeds. Citizens and CoreProtect jars are pinned
and checksum verified in [server/plugins.json](server/plugins.json).

The `companions` module provides Rowan, Juniper and Flint. Utility scoring,
bounded recipe planning and incremental resource scans run locally. Their
inventories hold real items; mining, crafting, crop replanting, eating and
placement use native Paper operations and normal events. Shelters consume
gathered materials and stay within 12×12×8 and 256 block changes. Crafting
supports material-choice hand and workbench recipes; furnace cooking and
arbitrary player automation are outside this action set.

Availability requires the managed `the-storm-companions-enabled` flag,
14:00–22:00 Pacific local time, and a real human online. Citizens entities do
not count as humans or receive player join rewards. Companions defend against
their attackers under ordinary PvP and claim rules. CoreProtect history and
queue checks prevent changes to another player's recorded blocks.

SQLite stores identity, inventory, vitals and construction progress. Each
world or inventory effect records a pending journal entry before execution.
An interrupted effect pauses that identity for operator reconciliation; it
does not replay the effect or issue another starter kit. This does not make
Minecraft world saves atomic with SQLite. Back up the world and Storm database
together, and inspect both after an unclean shutdown.

`/companion status` and `/companion reconcile` require
`thestorm.companions.admin`. Nearby players can use `/companion <id> follow`,
`stop` and `resume`. `resume` releases an ordinary stop, not a failed journal.
The kill switch is the managed gameplay flag. Provider outages and chat budget
exhaustion leave local survival running. Conversation uses the ordinary chat
policy, responds only to nearby name mentions, and receives no action tools.
Its contract and shared budget are documented in [storm-brain](../storm-brain/README.md).

The Temporal core-hour schedule reconciles an already-running server and never
wakes it. The module is installed while the managed production rollout remains
disabled until live acceptance. Mineflayer
is retained only as a real-client E2E dependency. `tests/e2e/harness/rcon.ts`
contains the test client's control protocol.

## Modules

Every module implements `StormModule` and is listed in `dist`'s `Modules`
(a test fails if one is missing). `plugins/TheStorm/config.yml` must name every
module under `modules:` with `true` or `false`; a missing or unknown key stops
the plugin. The repository owns that file; the plugin never writes it.
The shipped `config.yml` registers 25 modules and enables all of them,
including `rwf` and `rwfbots` (the rwf map world is provisioned on live). RWF
creates or loads its declared owned void lobby before gameplay, retaining its
saved identity and terrain on restart. The boot check, the
full E2E lane and `dist`'s `ModulesTest` verify that exact enabled set, not a
count, so a production module replaced by a scaffold is caught. Existing
volumes must satisfy the one-time archive contract in
[server/README.md](server/README.md) before the image starts.

Storm Shards award ore drops only in chunks generated after the shards module
activates. Older chunks may contain player-placed ore from before provenance
tracking existed, so their ores stay ineligible. Mob drops are unaffected.

Inside a module, packages are layered:

| Package            | May use                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`           | The JDK, core's `Result`, and its own module's `domain` and `app` value types. No Paper, Adventure, jOOQ, Jackson, JDBC, network or other modules                                                                                  |
| `app`              | Use cases and the ports other modules may call                                                                                                                                                                                     |
| `adapter.paper`    | Listeners and commands. Main thread only, so no JDBC, jOOQ, file or network I/O                                                                                                                                                    |
| `adapter.db`       | jOOQ repositories over the module's own tables                                                                                                                                                                                     |
| `adapter.citizens` | `rwfbots` only: its single package allowed to use Citizens, and only `net.citizensnpcs.api` and `net.citizensnpcs.trait`. Main thread only, like `adapter.paper`. `npcs` and `companions` bind Citizens from their `adapter.paper` |

Modules reach each other only through the other module's `app` package, and
schedule main-thread work only through `core.schedule.Scheduler`. No class may
use `net.minecraft` or `org.bukkit.craftbukkit`, and `rwfbots.app` may not use
Paper at all because it drives bots from worker threads. ArchUnit tests in
`architecture/` enforce all of this.

## NPCs and the town watch

The NPC module reads strict content from `server/owned/plugins/TheStorm/npcs/`
and combat settings from `npcs.yml`. Spawn has eight guards: the captain and
east, west, market, tavern, windmill, north, and southeast watches. The captain
stays at his post; the other guards patrol short local routes.

All NPCs can take damage and die, including from projectiles, damaging spells,
and the environment. Non-damaging spells cannot freeze, push, trap, or otherwise
impair NPCs because those effects produce no attributed attack for the Watch to
respond to. Civilians flee nearby hostile mobs and actual attackers; guards
fight them. Peaceful mobs are left alone. Detection uses each NPC's current
position, including loaded areas without nearby players. Guards within 48
blocks answer a call for help and pursue at most 64 blocks from the incident.

A player's first two damaging hits on each NPC in a game day receive private
warnings from a shuffled bank of 24 phrases. The third hit calls the guards.
A lethal hit calls them immediately. Wanted players receive no fresh allowance
on another NPC; guards remember them until that world's next dawn. Warnings,
wanted status, and deaths persist asynchronously in SQLite across reconnects
and restarts. NPC startup waits for that state before reconciling entities.

Dead NPCs return at home with full health at the next dawn and give no drops or
XP. Dialogue, training, and quest interactions are unavailable while an NPC is
dead or reacting to danger. `/npc list` reports deaths awaiting dawn. Reloading
content does not reset deaths or grant fresh warnings.

## Quest content

The `quests` module reads authored quests, board templates, regions, factions,
and hooks from `server/owned/plugins/TheStorm/quests/`. Its runtime settings are
in `server/owned/plugins/TheStorm/quests.yml`. Content is validated against the
loaded Minecraft registries and NPC directory when the module starts; invalid
content stops startup with file and field errors. The objective, condition, and
action syntax is defined by `quests/domain/content/Dsl.java`.

`server/owned/plugins/TheStorm/collections.yml` defines 20 regional field notes.
The first eligible item pickup in the main world reveals each matching note,
saves its discovery time with quest state, and shows it in `/quests`.
The journal also lists the ten most recently completed authored quests with
their stored completion dates and summaries. Old completed quests remain in
SQLite even when they are outside that visible list.

Quest offers, commands, and progress are restricted to the configured main
world (`world`). Regions must resolve to that world's registry key. Board
draws keep a snapshot of their objective and reward data in SQLite so edits to
templates do not change quests already assigned to players. Shipped content
counts and references are checked when the quest module is built. Regional
chapters in `quests/regions/` cover Spawn Town, Sewers, Library, Caravan Road,
the main-world Wilds fringe, South Mines, the old Harbour, and Frost Falls.
The old sewer, water study, and caravan drafts inform their chapters. Enabled daily and
weekly slots require a template pool at module startup, and reward arithmetic
is checked before a board can be drawn. Boards turn over on player join or the
first quest interaction or journal view after the calendar boundary; the
recurring quest tick only rechecks objective progress.
Board and NPC offers use the same eligibility checks: prerequisites and repeat
cooldowns are evaluated against player state before an offer appears. NPC
dialogue gives story and track quests priority, then rotates offers of equal
priority in a stable order for each player and local day. Hand-ins and active
choices remain ahead of new offers.

Quest dialogue text may reference an Ink knot as `ink:<script>#<knot>`. Scripts
live under `quests/dialogue/` and compile at module enable; invalid scripts or
references stop startup. Ink currently renders text inside the existing NPC
dialogue graph. `quest_active(id)`, `quest_completed(id)`,
`quest_can_accept(id)`, `quest_variable(name)`, `quest_reputation(faction)`, and
`quest_points()` are read-only external functions over the current player's
main-world quest state. Quest buttons still invoke the quest engine's guarded
accept, hand-in, and choice actions. Ink snippets must end without Ink choices;
the authored quest statechart owns those buttons and their side effects.
Variable, reputation, and point values are exposed as decimal strings so
their full 64-bit values can be displayed; Ink scripts should not use them in
numeric expressions.
Scripts cannot use `INCLUDE`, so all source is auditable in one file.
Board template accept, decline and finish text can use Ink references. Board
offers retain the board's `{amount}` and `{target}` interpolation and reject
Ink references at startup.

Quest state and pending world actions commit in one SQLite transaction. Item
hand-ins run from that outbox after the state write succeeds, so a failed write
cannot remove items. Actions run in order while the player is in the main
world. Before an action touches Paper, its row moves to `IN_DOUBT`; the row is
removed only after the action reports success. A crash or ambiguous failure
leaves that row for staff to inspect, and later actions pause behind it.
Quest progression, completion reads, and the journal wait while an item hand-in
is outstanding, so the saved completion cannot unlock follow-up work early.
Crystal transfers use the outbox ID as the economy ledger's idempotency key;
these can resume safely after a crash. Paper inventory, teleports, spawns, and
custom hooks still need operator reconciliation after an ambiguous attempt.

Use `/quests admin effects <player-uuid>` to inspect the queue. For an
`IN_DOUBT` effect, inspect the player's inventory, crystal ledger, permissions,
or world state as appropriate. Use `/quests admin effect complete
<player-uuid> <effect-uuid>` only when the action took effect; use `/quests admin
effect retry <player-uuid> <effect-uuid>` only when it did not. Both commands
require `thestorm.quests.admin`. An item hand-in can remain pending if the
player leaves the main world or no longer has the items. Do not retry an
ambiguous action without checking its effect first.
Towns protection loads persisted claims before registering listeners. If a town
save fails, it reloads persisted state before accepting another change. If that
reload also fails, the server shuts down because its in-memory protection state
may no longer reflect stored claims. A denied join or respawn relocates only to
an already loaded, permitted location; when none exists, the player is
disconnected rather than triggering terrain generation in the arrival event.

The world module requires every world in `server/owned/plugins/TheStorm/world.yml`
to be provisioned and loaded before TheStorm enables. A missing world stops the
server rather than generating terrain during plugin startup. Operators provision
`wilds` (large biomes),
`peaks` (amplified), and `mining` (normal), and confirmed their loaded names and
presets. The plugin checks the loaded name and NORMAL environment; Paper does
not expose reliable preset metadata for an existing world, so preset acceptance
remains an operator check. A mining reset must likewise make the replacement
world available before TheStorm enables again. Multiverse remains a required
startup dependency. Native borders are declared in the same typed file.

Towns separates land rights from container rights. Claims control building,
while a lock controls opening a lockable container on claimed land. New
containers lock for their placer. Unlocking removes the lock while claimed land
still applies its access rules. Owners can grant use, management, town sharing,
and redstone access separately. Admin
regions retain their own opening rules. Other modules use the towns
`Protection` port so their container interactions follow the same rules.
The towns `TownRead` port exposes an alphabetical, bounded directory of town
names with member and claim counts plus the total town count. Consumers call
it on Paper's main thread because it snapshots the loaded towns state; it
does not expose town membership identities or treasury data.

Shared server land stays in `towns` protection, with required `SAFE`, `ARENA`
and `PRESERVE` region profiles. Every loaded world's spawn gets a full-height
safe region from its actual spawn position; the End arrival platform is protected
separately. Repository-owned regions in `towns.yml` cover the larger main spawn
and arenas. Safe regions deny all player damage, harmful potions, hostile spawns,
fire and griefing without blocking the arena's declared gameplay allowances.

`parcels.yml` declares exact block bounds, corroborated UUID owners and survey
provenance. Holdings are separate from Town membership, Governor limits and
treasuries. Empty owners preserve imported builds in staff custody. Permanent
historical shops remain rent-free. Parcel owners may edit only their holding;
the surrounding spawn's safety rules still apply. BlueMap draws exact parcel
outlines and `/plot list` shows bounds, custody, provenance and lease terms.

New rental shops use prepaid seven-day leases and a seven-day withdrawal-only
grace period. Renewal is manual; no recurring debit exists. A durable payment
intention and the economy's `transferOnce` ledger key recover uncertain charges.
The managed `the-storm-shop-rentals-enabled` flag controls new admissions only.
Renewals, expiry enforcement, mail and journal recovery continue independently.
Each rental needs an air-only baseline above a server-owned solid foundation.

After grace, the world snapshot, native inventory stock, decorative entities,
container locks and sign-shop definitions commit before any reset. WorldEdit
7.4.5 is a required server dependency; finite main-thread batches capture,
restore and verify blocks while detached archive encoding runs off-thread.
Unfinished work remains protected and resumes from its database checkpoint.
The `mail` module exposes the public `Mail` port and `/mail`, delivering native
item stacks with a player-data receipt before acknowledging their durable batch.
Mail does not expire and never drops excess items when inventory space is short.
External plugin integrations obtain published module ports through
`TheStormPlugin.service(Class<T>)`; disabled or unordered providers fail loudly.

An eviction message offers one exclusive choice: building materials plus stock,
or an owner-bound packed chest. Right-clicking previews an empty destination,
then `/plot confirm` rechecks permissions, Shopkeeper capacity and lock limits.
The server reserves the whole volume and journals its preimage before writes.
Stock, locks and shops retain their identities; old tokens cannot place twice.
`/plot reissue <recoveryId>` replaces a lost token through mail. Staff may resume
or roll back an unfinished placement. The Temporal reconciliation schedule uses
the isolated mining-reset Activity queue and skips sleeping servers without
waking them. Its RCON protocol is validated against the shared JSON contract.

Town deletion commits a pending treasury payout in the same transaction as
removing the town and its claims. The treasury then pays the former owner with a
stable economy transfer key. If the server stops between these steps, towns
replays pending payouts on the next module start; a failed payout remains
recorded and is logged for recovery. Treasury deposits and withdrawals hold the
town busy until their transfers finish, so deletion cannot race a balance change.

### Main-world crier

The world module also owns an on-demand `/crier` bulletin. Its separate
`world.yml` `crier.enabled` setting ships as `true`. The `/crier` command registers with the
module and evaluates `the-storm-crier-enabled` in Flipt for each player. Both
the typed file safety gate and the managed flag must allow the command; a
missing or failed Flipt evaluation leaves it unavailable. The managed flag is
enabled in the beta inventory; production stays gated until live acceptance.
Java flag IDs are checked
against the shared inventory during Gradle compilation. Once enabled, the
command works only for players in `world`. It reports observed weather and
game time, then rotates one historical Storm fact by full game day. The archive
notes come from
the recovered Storm history (old spawn landmarks, the Bridge Hobo quest, the
2015 Easter hunt, and Braxton's bank). It makes no claim that those landmarks
or quests exist in the current world. There is no timer or automatic broadcast.

`world.yml` enables `ambient.enabled`. Its configured center uses the
block position of the repo-owned Essentials gameplay spawn in `world`
(`68, 69, 66`), independently of the Bukkit world spawn. A player arriving
within the configured radius and height of that center hears one crier
bark, grounded in current weather and a rotating archival fact. Join, world
entry, and movement into the spawn area can trigger it, at most once per
Pacific date per player. The last-heard date persists on the player. This is
new authored behavior inspired by the old windmill and Storm history, not a
recovered NPC script. It has no recurring task or server-wide broadcast.

The separate `world.yml` `digest.enabled` setting ships as `true` and
requires `crier.enabled`. When enabled, `/crier digest` reads the current
Pacific date's ledger for `world` and replies only to the requesting player in
that world. It counts distinct players who joined or entered the main world
and player deaths observed there after recording was enabled. The reply shows
the first observed time so a partial first day is clear. Online player count
and weather are current at reply time. The ledger uses the plugin's SQLite
database and asynchronous reads and writes; there is no recurring task. It
does not report town founding, trades, arena records, or earlier server history
because those sources are not connected. Before a live rollout, enable the
world module and crier, then enable the digest and verify an arrival, a death,
and an on-demand read in `world` after GitOps deployment.

### Windmill trader visit

The world module's `world.yml` `merchant.enabled` setting ships as `true`,
with a measured anchor at `(65,69,66)` outside the existing windmill. The
block below must be solid, with two air blocks above it. The listener refuses
an unsafe or unloaded anchor; it never chooses another position.
The independent managed `the-storm-merchant-enabled` flag must evaluate true
for the arriving player. The beta inventory enables it; production stays gated
until live acceptance. Flipt errors or
missing bootstrap settings keep visits off.

On the first join, world entry, teleport, respawn, or block movement within `arrivalRadius` of
the anchor on a Pacific date, one named Wandering Trader appears in `world`.
The visit is recorded on the world and cannot be repeated that date, even if
the trader is removed. Paper's native trader despawn delay is set to
`visitMinutes`; no plugin timer or scheduled job runs. The trader has two
finite item barters each date, rotated deterministically among bread for
wheat, torches for coal, and a lantern for iron ingots. It does not transact
crystals, connect to player shops, travel to towns, or offer escort or robbery
quests. The windmill and NPC shops are historical facts; this visit, its
stock, and its timing are new authored behavior, not recovered mechanics.

For live acceptance, first verify the measured anchor and open the feature
through GitOps and target the managed flag. With a player in `world`, verify the spawn, trade offers,
same-day limit, natural despawn, and next-day rotation. Roll back by setting
`merchant.enabled` to `false`; a trader already spawned can remain until its
native despawn.

Arena and rwf restores keep the database snapshot until saved player data
proves the restore. Core's `SnapshotKeeper` applies the snapshot and its
persistent-data marker, then saves the player in the same tick. Paper writes
`<level>/players/data/<uuid>.dat` (or the pre-26 `playerdata/`) to a temporary
file and swaps it in, so the marker and the belongings land together. The file
is read back on the compute pool. The row is marked restored only when the
fully read file holds that snapshot's fingerprint.

A join asked for meanwhile is told the belongings are still being saved and
goes ahead by itself once they are. Failed read-backs retry after 1, 2, 4 and
8 seconds; after that the restore is stalled and the player is asked to
reconnect, as is every restore when the server's player-data folder cannot be
found. A later login carrying the marker proves a stalled restore. One
player-file write per restore runs on the server tick, as Paper's own saves
do; the read-back never does.

### Colosseum

`/arena join colosseum` keeps the original finite 72-wave format: pick a class,
start with a kit, fight waves and bosses, and scavenge all sixteen shared caches. Every cache receives
one weighted loot stack at the start and at each five-wave resupply checkpoint.
Classes start with stone tools, leather armor and reduced enchantments while
keeping their spells, consumables and companion identities. Wave 6 raises gear
to the intermediate tier, wave 16 grants the authored class equipment, and wave
31 improves offensive/protection enchantments. Specialist weapons that have no
stone or iron counterpart retain their material.

Every five **cleared** waves, caches receive another loot roll without clearing
unclaimed items. Kits are repaired and consumables refilled at that checkpoint;
after a boss, the following upgrade wave delivers the kit refill. Looted gear
is repaired and preserved rather than replaced by class upgrades. Equipment can
wear out between checkpoints. Full caches and inventories keep their contents;
supplies that do not fit are not dropped into the world.

Hostiles acquire fighters across the arena and explicitly start navigation.
Cross-map path requests beyond sixteen blocks use a 1.2 movement multiplier;
close-range native combat goals still control attacking and strafing.
Stalled mobs retry after five seconds; after twenty seconds without progress,
they return to a floor entrance. Mobs already in combat keep their native attack
behavior. Boss waves require a clear and cannot time out into the next wave.

Boss spells are announced and mark a fixed danger circle two seconds before
resolving, with simultaneous spells queued rather than stacked. At 40% health,
bosses enter an enraged phase with faster spells and stronger damaging casts.
Party size is captured at the start of each encounter: boss health gains 80%
per extra fighter (capped at 1,024), summoned reinforcements scale with the
party, and Heartwood's objective requires more hits. Difficulty tiers and wave
damage scaling still apply. Food and healing consumables remain available.

### Settlement survival

The Colosseum retains its finite 72-wave game. Settlement is a separate,
endless, one-to-four-player crafting survival game. Its fourteen connected
districts form a coastal fortress town on three terraces at Y72, Y88, and Y104,
inside a 160 × 160 protected footprint in its own void world, `settlement`.
The region is X−80–79, Y62–142, Z−80–79; its lobby is at −65.5,73,−67.5.
Broad rising streets connect
the harbor and market to a central cathedral, then the upper barracks and ramparts.
The cathedral is an early eight-emerald unlock, with a large nave, walkable galleries,
stained glass, and a separately gated crypt. Three banks serve the three levels.
A separate staging dock holds the lobby; an
offshore forge is reached by plane. Permanent buildings are protected; purchased
routes, barricades, charged traps, and personal gathering budgets reset each run.

| Command or interaction                          | Result                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `/arena join settlement`                        | Saves belongings and enters the separate staging dock                     |
| `/arena join settlement <round>`                | Creates a shared practice lobby; requires `thestorm.arena.debug` (OP)     |
| `/arena class fighter\|ranger\|medic`           | Selects an initial class                                                  |
| `/arena class engineer\|alchemist\|beastmaster` | Selects an unlocked class at 500, 1,500, or 3,000 persistent XP           |
| `/arena ready`                                  | Toggles readiness; all admitted participants start a ten-second countdown |
| `/survival ability`                             | Uses the class ability, with a 40-second cooldown                         |
| `/survival status`                              | Shows round, XP, emerald items, and opened districts                      |
| `/survival classes` / `/survival upgrades`      | Explains roles and unlocks / chooses an earned run upgrade                |
| Right-click the ninth-slot compass              | Uses the class ability; sneak-right-click opens upgrades                  |
| `/survival give <player> <material> <amount>`   | Donates run items to a nearby standing teammate                           |
| Right-click a resource node                     | Gathers from a personal, finite per-round budget                          |
| Right-click a station                           | Opens weapons, armor, and supplies tabs                                   |
| Right-click a bank terminal                     | Deposits team supplies or stores and withdraws private equipment          |
| Sneak-right-click a gathering node              | Opens harvest and team yield upgrades                                     |
| Lobby lectern / `/survival guide`               | Reads public rules without taking a book or exposing secrets              |
| Click a route sign twice within three seconds   | Confirms its displayed emerald price and opens a shared route             |
| Right-click a defense                           | Repairs a barricade or charges a trap with materials                      |
| Sneak within three blocks with line of sight    | Revives after five uninterrupted seconds, or four as Medic                |
| `/arena leave`                                  | Restores pre-run belongings                                               |

Fighter has an area knockback attack; Ranger supplies arrows and a speed burst;
Medic heals nearby teammates. Engineer repairs, Alchemist weakens the horde,
and Beastmaster recalls a companion wolf. Kills, assists, bosses, and completed
rounds award persistent XP through idempotent database credits. Currency and
gathered materials are physical items tagged to the current run.

Clearing rounds 4, 9 and 14 earns three choices per run. Choose one specialization first,
then Potency (+25% of the base effect, or two seconds of utility duration) or Tempo
(six seconds off the 40-second recharge). Choices survive downing and reset when the run ends.
Persistent XP still unlocks Engineer at 500, Alchemist at 1,500 and Beastmaster at 3,000.
A compact sidebar shows the round, teammates' carried emeralds, and the shared bank balance.
Lobby rows show readiness. Class details and upgrade progress remain in the optional menus.
Joining, changing class, leaving, or becoming unready cancels a countdown. Public lobby,
start, boss-clear, and end announcements include clickable join or watch actions, limited
to one of each kind per minute. Practice runs do not generate public invitations.
The compass stays in its reserved slot. WorldEdit compass navigation permissions are
temporarily denied inside every protected arena footprint, including for operators;
leaving the footprint restores the previous permission state.

| Class       | Passive                              | Specialization abilities                                                         |
| ----------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Fighter     | 10% less ordinary enemy melee damage | Guardian: temporary absorption; Vanguard: damaging sweep                         |
| Ranger      | 10% more projectile damage           | Marksman: three strengthened shots; Piercer: three piercing arrows               |
| Medic       | Four-second revive channels          | Field Surgeon: team healing; Rescuer: revive one nearby downed ally              |
| Engineer    | Barricade repairs cost two planks    | Fortifier: repairs and team absorption; Sapper: shock trap                       |
| Alchemist   | Class debuffs last 20% longer        | Cryomancer: slowing field; Plague Brewer: weakness and credited damage over time |
| Beastmaster | Wolves deal 20% more damage          | Packleader: two wolves; Warden: one wolf and temporary absorption                |

A downed player has 30 seconds before becoming a spectator. Bleedouts return
next round with a weaker kit that retains the selected class's signature tools.
Glowing players and floating labels show the bleedout timer and revive instructions;
both players see channel progress. Damage, attacks, other interactions, releasing
sneak, losing sight or leaving range interrupt the channel. Revives restore eight
HP and grant two seconds of damage protection. Solo players get one free self-revive per run; losing
every standing player ends the run. Monsters pursue players across the map,
including riders and size-two hostile cubes, with bounded spawning and stuck-mob
recovery. Native offspring are suppressed; authored adds use the encounter queue.
Mounted enemies count as one encounter unit, and orphan mounts are removed.
A round bar shows the total remaining enemies separately from boss health; lobby,
countdown, and resupply phases show the relevant next action or time. Crossing
bounds returns the player to the nearest accessible collision-free, hazard-free
anchor, avoiding enemies and marked casts when possible, without healing.

The first three rounds introduce the horde gradually. A solo opening has nine
adult, unarmed zombies with 5.2 HP and 0.6 HP native attack damage, arriving in
batches of up to three per second with at most nine alive. Rounds two and three
add husks, with 12/15 enemies, 6.5/7.8 HP, and 0.9/1.2 HP attack damage. Baby zombies and
special enemy types arrive from round six onward. Opening zombies cannot summon
Hard-difficulty reinforcements beyond the planned wave.
Every starting class receives a wooden sword and full leather armor set; returning after a
bleedout retains the weaker chestplate-only kit and class tools. Round four has
18 enemies with 18 active solo; round five keeps four supports, at most two active,
and the first boss. Rounds six and seven have 24 and 27 enemies with matching solo caps.
Ordinary counts are 1.5× the original party budget, rounded upward. Active pressure is
`min(48, 9 + 3 × (round − 1) + 2 × extra players)`, bounded by 64 physical entities
including mounts and companions. Ordinary health and damage are 65% and 60% of
their original values. Boss phase adds keep their original full bounties.
Cumulative ordinary-wave kill rewards preserve the original round income
for each eligible contributor; boss and round-clear rewards retain their amounts. Special
mobs spend 10–25% of the wave budget; ranged mobs begin at round six, have a
wind-up, at least three seconds between shots and limited concurrent slots.
Early ranged hits are capped at 2.4 raw HP and cannot inflict poison or slowness.
When one or two logical enemies remain, counting queued units, living enemies glow.

Standing survivors recover half a heart every five seconds after eight seconds
without damage, up to one-third of their current maximum health. Passive
recovery works during combat and resupply, without consuming food or applying
a potion effect. Food regeneration, potions, and class healing can heal above
that ceiling. Downed players and spectators do not receive passive recovery.

Every fifth round has a phased boss with three-second marked casts, line-of-sight
checks and recovery windows. Native boss attacks are replaced by controlled basics and authored spells. Basics have
a two-second recharge, deal 2–6 raw HP as rounds advance, and pause during casts and recovery.
Gale and Hex bosses attack at range; physical bosses need melee reach. Countdown bars,
channel particles, imminent warnings, marked ground, impact bursts, and accepted-hit
cues distinguish each stage. Secondary spell effects require accepted damage. Locked
cast origin, target, height and terrain checks govern both markings and hits.
Boss health is `(100 + 20 × round) × (1 + 0.65 × extra players)`, capped at 1,000;
round five applies a 15% health reduction: 170/280.5/391/501.5 HP for one through four players.
Its basic and spell damage is reduced by 15%; later bosses retain their original scaling.
Party size increases health and support
pressure without multiplying damage per hit. Later bosses add enemies once
at phase thresholds through the normal spawn budget.
Each boss rotates three attacks, including directional lanes, rings with safe
centers, and separate impact areas. Damage stops at 66% and 33% health until
the preceding phase resolves a cast; the final phase must also resolve a cast
before lethal damage. Interrupting a cast counts as resolving it. Boss spell
damage caps at 14 HP in late rounds, and cover blocks spells.
The Evoker's glowing ritual node interrupts casts; the Creaking's node opens
a damage window after three interactions. The Ravager breaks nearby barricades
after a charge. Special encounters use illager, trial, mounted, pale, and Nether
rosters as their required districts become available.

Market wheat nodes give nine wheat per harvest, twice per player per round;
the food counter sells three bread for two emeralds. Shared routes cost wharf 8,
quarry 10, church 8, cloister 8, infirmary 10, foundry 14, gardens 10,
barracks 12, ramparts 16, bluff 12, crypt 14 and airstrip 16 emeralds.
Click the same sign twice, 200 milliseconds to three seconds apart, to confirm.

The harbor occupies Y 73, the cathedral and middle town rise to Y 89,
and the upper town and airstrip reach Y 105. Church Crypt descends to Y 77.
Authored stairs connect the terraces; route gates control district access.
Machines use barrels, vertical shrine stacks, a copper generator with a lodestone above,
and a Runeforge. Both blocks of a shrine or generator are clickable. Two permanent
holograms identify the generator and active cache; pickup, downed and reveal labels
are temporary. Nearby gathering, station and machine particles update every 250 ms
within twelve blocks, capped at 128 ambient particles per survivor per second.
Depleted and unpowered fixtures have subdued cues; boss markings have a separate budget.
A look-at prompt identifies the current interaction. Powered shrines play their native
music disc quietly in the RECORDS category: Relic, Otherside, Pigstep, or Creator Music Box.
Only the nearest shrine plays within twelve blocks; leaving, downing or losing power stops it.
Blocked route prompts name the prerequisite districts. Shrine prompts and purchase
menu lore describe the boon before payment. Advanced tips and fixture glints appear
when the relevant district and power are available; the handbook stays accessible.

Fourteen gathering nodes cover twelve materials: wood, stone, wheat, iron, flint,
redstone, bone, glowstone, copper, string, nether wart, and blaze powder. Wood
and wheat each have two nodes; duplicates share two harvests per player per round.
Opening foundry permits an eight-emerald upgrade to 1.5× yield, and opening crypt
permits a sixteen-emerald upgrade to 2×. Upgrades affect everyone and reset per run.

The starting district and two later workshops have bank terminals. Materials and
emeralds use a shared run-local ledger; exact gear stacks use a private 54-slot locker.
Station crafting, machines, boons, and route purchases spend carried supplies first,
then shared supplies. The complete price is checked before any withdrawal. Reserved
box payments track their sources and settle at most once. Bulk deposit transfers
only recognized fungible supplies; potions and equipment stay carried. Full-inventory material
rewards go to the shared bank; equipment bundles go to the private locker. A full
locker and inventory refuse equipment delivery without charging. Crafted armor
equips automatically and preserves the previous piece in the private locker.
Lockers preserve damage, enchantments, potion data, and run upgrade tags. Ability
compasses and written books cannot be deposited. Downs and bleedouts retain bank
contents; leaving discards that player's private locker while team deposits remain.
The whole bank resets at run end. Ordinary donations spend carried items only.

Curated recipes provide all four armor slots at leather, chainmail, iron, and diamond
tiers, plus axes, spears, bows, crossbows, tridents, and a mace. Food includes bread,
baked potatoes, stew, steak, and healing apples. Typed potion outputs provide healing,
regeneration, speed, strength, and fire resistance. Station menus also repair a held
weapon, shield, or equipped armor and offer compatible held-weapon enchantments.
Actual durability loss is tripled after native Unbreaking checks; cancelled damage
stays cancelled. Survivors carry at most four combat weapons, including thrown tridents;
shields, armor, ammunition, potions and the ability compass do not count.
Extra crafted gear goes to the private locker. Locker withdrawals and box claims offer
an explicit weapon swap, preserving the replaced weapon's metadata. Recipes use
at most three material kinds plus emeralds; their outputs use the same tagged item
and payment paths as box rewards.

Restore power at the foundry with four iron and four redstone. Shrines offer four
conditional rune boons. Purchase a boon once per run, equip at most two, and freely
swap previously purchased boons at their shrines. Select a replacement before paying.
Cooldowns survive swaps; boons suspend while downed and resume on revival.

| Boon       | Cost        | Effect                                                                                                                     |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Stoneward  | 24 emeralds | Blocking grants four absorption HP for four seconds; ten-second recharge                                                   |
| Galestride | 20 emeralds | Sprint eight blocks to arm a knockback hit and speed burst; eight-second recharge                                          |
| Emberweave | 32 emeralds | Alternate melee and ranged hits within four seconds for a bounded cinder burst; six-second recharge                        |
| Soulbond   | 16 emeralds | Healing or reviving shares two HP with a nearby ally, or gives two solo absorption HP for ten seconds; ten-second recharge |

Solo runs begin with one free Echo Totem revival charge. The infirmary sells replacements
for sixteen emeralds and four bone, with one outstanding charge and at most two purchases per run.
Food takes one second to consume; potions and milk take 0.8 seconds, preserving native effects.

Equipment has independent material, rarity, signature, identity and augmentation metadata.
Common crafted gear starts unenchanted. Enchant held Common gear to Uncommon for four glowstone
and four emeralds, then to Epic for eight glowstone, four redstone and twelve emeralds.
Enchantments remain compatible and within vanilla limits; stronger existing enchantments survive.
Weapons, armor and shields use the same system. Consumable supplies do not have rarity.

The powered runic cache costs sixteen emeralds: Common 25%, Uncommon 30%, Epic 25%,
Legendary 16%, Mythic 4%. Rarity controls enchantment strength; Legendary and Mythic rewards
have signatures. Cache animation lasts three seconds and reserves the exact revealed item
for its buyer for fifteen seconds. The revealed item lowers into the box as its
claim countdown expires. Normal expiry or buyer abandonment spends the roll cost;
technical run shutdown refunds outstanding reservations. Swaps do not extend the deadline.
Full-inventory equipment rewards use the private locker; full inventory and locker refuse
delivery without losing the purchase. After six claims the cache moves to another authored
site. Follow the magenta beacon to market, wharf, church, foundry, barracks or bluff.
Bows include arrows; Graviton includes redstone. Every item keeps its identity through
reveals, claims, enchanting, augmentation, lockers and trident returns.

Legendary signatures include Stormcaller, Frostbite, Graviton, Repeater, Whirlwind,
Tidebreaker and Riftblade. Copperguard arcs three HP to two nearby enemies when blocking
(six-second recharge). Briarplate slows three nearby ordinary enemies after taking damage
(eight-second recharge). Trailwarden leaves slowing patches while sprinting (three-second recharge).
Mythic signatures introduce additional play loops:

| Equipment            | Mechanic                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stormglass bow       | Three fully drawn hits charge the next storm shot: two redstone, twelve HP to at most five targets, ten-second recharge                               |
| Wayfarer sword       | Set a five-second anchor, then return with an eight-HP burst: two redstone, twenty-second recharge; obstructed or dangerous destinations are rejected |
| Echoheart chestplate | Store up to twelve actual HP damage; the next class ability grants up to six absorption HP to nearby teammates for eight seconds                      |
| Faultline shield     | Store up to twelve blocked HP; releasing the shield erupts in a cone hitting at most six targets, twelve-second recharge                              |

Held-use state is checked every server tick against a single 250ms firing
deadline. An early tick cannot postpone a shot by another complete firing period,
and delayed ticks do not cause catch-up bursts. Real-server cadence tests observe
native projectile launches and acknowledged release/weapon switching; Mineflayer's
local physics ticks are not a server clock.

Signature damage uses normal ownership and boss protections, requires line of sight, and
cannot recursively trigger itself. Swapping equipment retains recharge timers.
The Runeforge explicitly selects held, offhand or equipped armor. Augmentations I–III cost
12/24/36 emeralds, repair equipment and preserve its rarity and signature. Weapons gain
1.15/1.35/1.55 damage multipliers plus compatible augmentation effects; armor reduces incoming
damage by 2/4/6% per piece, capped at 20% total; shields reduce disable cooldown by 10/20/30%.
Returning tridents reserve their original slot against automatic rewards. Manual occupants
move safely to another inventory slot or the locker; a full inventory and locker leave the
return pending. Loyalty, ordinary pickup and round-end recovery share one return path.

Station menus put categories in the first row, a divider in the second, recipes below,
and maintenance actions in the footer. The lower inventory allows ordinary rearrangement;
menu icons, the ability compass, and transfers across menu boundaries remain protected.
Private locker deposits require an explicit shift-click.

Three plane parts are scattered through quarry, foundry and ramparts.
Each player carries one part and installs it at the airstrip. Leaving
returns undelivered cargo. Power plus all three parts permits a flight to the
offshore forge. Players board individually over five seconds; rounds continue
and enemies redeploy toward occupied areas with their health and counts intact.
A return station operates independently. Later departures require three fuel
pickups and at least one cleared round since the previous departure.

Defeated enemies drop field salvage at an eight-percent chance, with a shared thirty-second
cooldown, a twenty-second lifetime, and at most one outstanding pickup. Wildgrowth creates
an eight-second healing grove. Redstone Surge chains the next three attacks. Resonant Shard
halves remaining class recharge and empowers the next ability within fifteen seconds.
Copper Pulse deals bounded local damage and staggers ordinary enemies. Mason's Echo gradually
restores nearby barricades and charges nearby traps. Drops are introduced within eight blocks;
a first encounter waits two seconds before collection. Item and label flash every
250 ms during the final five seconds; collection remains available during flashing.

First-encounter tips use a validated dependency DAG covering gathering, crafting, enchanting,
banking, route unlocks, defenses, power, boons, the cache, rarity, travel, augmentation, classes,
revival, every encounter family, boss, cast shape, field drop and equipment signature.
When several contexts apply, one earliest unseen prerequisite is taught. Tips appear in chat
and the action bar for six seconds, with twelve seconds between tips. Boss casts, downing and
other priority feedback interrupt without marking the tip complete. Completed topics and
preferences persist through asynchronous idempotent database writes; debug practice uses
session-only changes. `/survival tips on|off|reset` controls delivery, and `/survival guide`
keeps the catalog browsable. All six classes show XP thresholds, current progress, selection
and specialization details; debug lobbies permit all classes without granting persistent XP.

Debug rounds 1–1,000 use the ordinary shared lobby and ready countdown. Teammates
join without debug permission. Presets use starter equipment at 1–3, iron at
4–7, augmentation I at 8–14, II at 15–24 and III at 25+, with matching supplies,
routes, power and plane progress. Debug play writes no XP or leaderboard results.
An active run or conflicting lobby cannot be fast-forwarded.

Placement is controlled by strict `arena/survival.yml`; admission also requires
the managed `the-storm-survival-enabled` flag for the player. Missing Flipt
bootstrap or failed evaluations keep admission closed. Startup validates the
authored blueprint and resets gates and defenses before opening admission.
See the wiki's **How to provision The Storm settlement** for placement and recovery.

### Rustworks survival

`/arena join rustworks` enters a separate one-to-four-player Zombies run. Its
192 × 200 protected footprint is 1.5 times Settlement's, with 23,040 combat
blocks across 24 districts. Paid districts are 53–75% of the original Settlement's average
district area. Interlocking loading bays connect rail yards, workshops, copper mills,
boiler courts, planted yards, a slag vault, and an airship hangar. Ground rises
eight blocks across long slopes; doors and combat routes remain on those slopes.

Railhead and Workers' Canteen are open initially. Signs charge 6–11 emeralds
per district; districts with two connecting routes require both neighbors.
Power is in Generator House, Pack-a-Punch in Blast Furnace, and the mystery box
rotates between Freight Sidings, Glassworks, and Airship Hangar. Three banks
serve Railhead, Copper Foundry, and Slag Vault. Six barricades and six traps
provide repair and defense opportunities. Sixteen gathering nodes cover the
same twelve material kinds, with no more than two nodes per material.

Plane parts are in Boiler Court, Textile Mill, and Control Room. Assemble them
at the hangar to reach the remote salvage forge. The station, lobby handbook,
ready controls, classes, gear recipes, boss scaling, and debug-round behavior
use the same survival rules as Settlement. `/arena join rustworks <round>`
requires `thestorm.arena.debug`; `/arena spec rustworks` watches its run.

`arena/rustworks.yml` owns its geometry and fixtures; `arena/survival.yml` owns
the shared classes, recipes, and loot rules. Each enabled map has an independent
runner, gates, enemies, bank, and run inventory. Character progression is shared.
Both maps use the existing survival admission flag. Startup checks every enabled
map before opening arena admissions: install the authored world geometry before
enabling a new map in production.

Rustworks occupies its own void world, `rustworks`, at X−96–95, Z−100–99, Y68–103;
its lobby is at −78.5,73,−79.5 and exit pad at X−98, Z−80, Y72–74.
Provisioning targets use the map ID: `/rustworks preview`,
`/rustworks apply <token>`, and `/rustworks restore <token>`. Disable Rustworks
in its own configuration before provisioning. Previews retain the same wilderness,
block-budget, backup, and ownership checks as Settlement; do not enable it until
the map has been installed and verified. World identity isolates the maps even where
their coordinates overlap. Leaving restores the player's saved world and position.

Arena startup loads its configured region chunks asynchronously before checking
loot chest blocks or clearing remnants of an interrupted game. Admission stays
closed if any chunk or chest is unavailable. Vault rewards stay in the database
while delivered items and their receipt await a player-data save; a later login
retires those rows. A reward whose whole item bundle does not fit remains queued
until the player frees inventory space.

## Conventions

## Beginner's luck

The mobs module offers personal wilderness protection through the managed
`the-storm-beginners-luck-enabled` flag. Its fallback defaults off; beta and
production explicitly enable it.
`mobs.yml` defines six hours of near-peaceful combat followed by a gradual ramp
to ordinary difficulty at twelve hours. Every account, including returning
players, starts a fresh allowance on its first enabled session. The mobs-owned
SQLite clock checkpoints active time through Essentials' activity/AFK feed;
it excludes offline and AFK time, includes active minigame time, and survives
reconnects, restarts and flag disable/re-enable. It never imports historical
playtime or depends on analytics. `/beginnersluck` shows personal progress.

Mobs remain aggressive. For six active hours, mobs within 64 blocks of a
protected player, and existing mobs engaging them, become actual level one;
incoming hostile melee, projectile and explosion damage is reduced by 90%.
From hours six to twelve, levels and incoming damage rise to normal. Overlapping
beginners use the gentlest applicable level. Nearby veterans see and fight the
same weaker mob, without receiving the beginner's personal damage reduction.
Natural levels persist separately and return when protection stops applying.
Level changes never refill health, player-given names are preserved, and bonus
XP/loot use the lowest applied level so restored mobs cannot pay inflated rewards.
PvP, bosses, environmental hazards and sealed minigame worlds retain their
ordinary rules. Flag evaluation runs asynchronously; unavailable or false
evaluations pause the allowance and restore normal combat.

Spawn Citizens NPCs carry the `beginner-safe` role. They and protected players
cannot damage each other throughout the full twelve active hours, including the
six-to-twelve-hour ramp. These cancelled hits create no warnings, wanted state,
or guard retaliation; dialogue, quests, trainers and shops still work. The NPC
module reads the mobs module's cached `BeginnerStatus` on the main thread, without
waiting for storage or flag evaluation. While that initial snapshot loads, or a
flag refresh fails, spawn NPC combat stays blocked. An explicit disabled decision
restores ordinary NPC combat. NPCs outside spawn and ordinary mob combat retain their
existing rules. Travel pricing, cooldowns and death consequences are unchanged.

## Command travel

`/spawn`, `/home`, `/back`, `/warp`, `/tpa`, `/tpahere`, and `/rtp` share
one player-wide cooldown and an allowance of four weighted points over the
last hour. Spawn and warp consume half a point, home/back/RTP one point, and
player-to-player travel two points. Include the proposed trip when quoting:
each point beyond the allowance doubles both price and cooldown, up to x32;
half a point beyond the allowance starts x2. Each successful trip stops counting
exactly one hour after arrival. Offline time also expires usage.

`/tpinfo [category]` shows configured rules, current quotes, shared cooldown,
and the next usage expiration. The requester pays and accumulates usage for
both TPA directions. Unanswered requests, cancelled warmups, failed searches,
and failed delivery consume no allowance. Free RTP during the first seven
days still consumes points and receives the same escalating cooldown.
Elytra, happy ghasts, and ordinary routes are the intended regular transport.

Essentials publishes `TeleportTravel`: one reservation, warmup, guard,
payment, refund, and delivery-confirmation flow. QoL supplies RTP's destination
search and existing first-seen timestamp. The landing chunk remains held
through delivery. Successful trips and the shared cooldown live in Essentials;
confirmation clears the charge obligation in the same database transaction.
The shared policy is typed in `essentials.yml`; `rtp.yml` owns only search and
landing settings, including a 15-second search throttle for failed attempts.

Migration preserves each player's longest existing Essentials cooldown and
starts the rolling history empty once: the old aggregates cannot reconstruct
individual completed trips. Pending charges remain recoverable. Legacy RTP
refunds keep their original ledger keys and finish before shared travel opens.

## AI staff

The `tickets` and `agent` modules provide ticket tracking and proactive chat
enforcement through the `storm-brain` service (`packages/storm-brain`). Operator
guidance lives in the repository wiki at `packages/docs/wiki/src/content/docs/`:
`explanation/the-storm-ai-staff.md`, `how-to/review-ai-staff-decisions.md`, and
`reference/the-storm-agent.md`.

The economy keeps one balance per account and currency. `CurrencyId` names
them: `crystals`, the survival currency every shop, town, quest, track,
arena and teleport uses, and `rwf_credits`, Red Warfare's own. Amounts are
`Money(CurrencyId, amount)`; amounts of different currencies never add up,
compare or convert, and every caller names its currency. `economy.yml` lists
each currency's singular, plural and symbol (`crystal`/`crystals`/`CR`,
`Credit`/`Credits`/`RC`), and the published `MoneyFormatter` writes amounts
with them. `/balance` lists every currency, `/pay` moves crystals,
`/baltop [currency]` ranks one currency (crystals by default), and
`/eco give|take|set <player> <amount> [currency]` corrects one through a
ledgered transfer with the server. Migration V4 rebuilt `economy_account`
(keyed by kind, id and currency) and `economy_ledger` (with a currency
column), copying every row, id and the ledger's id sequence as `crystals`.

The economy `Wallets` port supports a stable `KeyedTransfer` for compensating
payments. It stores the operation key with the ledger row, returns the same
receipt for an identical retry, and rejects reuse of the key with different
transfer details, including another currency. `receiptFor` lets a caller
reconcile an uncertain result. Ordinary unkeyed transfers keep their existing
behavior.

Legacy QoL RTP obligations are reconciled with their original keyed ledger
contract before shared travel is available. New RTP charges use Essentials'
attempt store. The search throttle is recorded before loading destination
chunks, so cancelled warmups, failed searches, and refused charges cannot
repeat costly scans immediately. It is separate from successful-travel usage.

Paid Essentials teleports use the same keyed ledger contract. Essentials writes
an attempt before charging and clears it after arrival and usage persistence or
after a keyed refund. On module startup, it checks each unfinished attempt
against the ledger and refunds any committed charge. If the process stops after
the player arrives but before confirmation is saved, recovery may refund that
delivered teleport. A failed recovery keeps Essentials teleports unavailable
until the ledger or database can be reconciled.

- `@NullMarked` on every package; NullAway (JSpecify mode) runs as an error.
- Error Prone with Picnic's checks; `-Xlint:all -Werror`. Warnings fail the build.
- google-java-format via Spotless; PMD enforces the repository's complexity
  limits (cognitive 15, cyclomatic 20, depth 4, at most 4 parameters).
- Expected failures return `Result`; exceptions mean a broken invariant.
- Config and content parse strictly into records with `StrictYaml`: unknown
  keys, missing properties and nulls are errors, and records validate
  themselves in compact constructors.
- Storage is one SQLite file. Each module owns
  `src/main/resources/db/migration/<module>/` and its own Flyway history
  table; modules that use SQL apply `storm.jooq-conventions` to generate typed
  jOOQ classes from those migrations. Writes go through
  `StormDatabase.write` (one writer thread); never block the main thread on a
  future.
- A skipped test fails the build. MockBukkit reports unimplemented Paper APIs
  as skips, so a skip proves nothing.
- Dependencies are locked (`gradle.lockfile`) and checksum-verified
  (`gradle/verification-metadata.xml`).

## Seasonal events

`seasonal.yml` defines annual date windows in `America/Los_Angeles`, weighted
item outcomes, and exact lower-half door offsets from the `world` spawn block.
Only configured doors in the main world qualify. Stormnight runs October 28–31
with 11 daily doors, drawing on the 2015 trick-or-treat hunt. Winter Vigil runs
December 24–January 1 with seven daily gift doors. Its date window and gifts
are a new design inspired by the recorded 2015 Christmas giveaway; the original
mechanics and door coordinates were not recovered.

Only the main hand counts; opening either half records the lower half. Visits
are stored on the player's persistent data, survive restarts, and reset on the
next local day. The module is enabled with measured doors in the existing town
and windmill. Offsets use the preserved Bukkit spawn `(0,65,0)`. The historical premium
ranks, disguise packs, and horse prizes are not granted by these item events.

- Code copied from GPL/LGPL plugins keeps its license header.

## Grave recovery

The grave storage migration keeps the original V1 checksum. It refuses to run
while the old chest-based `qol_grave` table has rows, because those items live
only in world chests. Before enabling the new QoL module on an installation
that ran the old implementation, collect or expire those chests with the old
module and confirm the table is empty. The migration then creates the SQLite
item store without discarding any chest contents.

The QoL module stores grave stacks in SQLite. A death first saves a handoff in
the player's data with their emptied inventory, then creates the grave. Taking
items first reserves them in SQLite, saves the recipient's inventory and a
claim receipt to player data, then deletes the stored stacks. A restart or
rejoin reconciles unfinished handoffs.
If another death occurs before the first handoff settles, its items use vanilla
drops so the saved handoff cannot be overwritten.

Expired grave items and owner inventory overflow remain in SQLite as pending
ground drops. Tagged `ItemDisplay` entities are replaceable views; nearby
players collect them through the same saved receipt path. Overflow is owner
only until the grave expires, then anyone can collect it. Loaded chunks are
reconciled at startup and on chunk load. Interaction and nearby player movement
also trigger expiry in chunks that stay loaded. Collection pauses while QoL is
disabled; the stored stacks remain available when it starts again.

## Shop startup

The shops module registers a temporary guard before it reads stored sign shops
from SQLite. While the read or reconciliation is pending, possible shop signs
and configured shop containers cannot be opened, changed, or used for inventory
transfer. Catalog names remain available to NPC validation, but catalog menus
and `/shop` report that shops are loading. A failed read leaves the guard active
and logs the startup failure; a successful read publishes the registry only
after stale admin shops have been closed.

## Red Warfare Search and Destroy (rwf)

The `rwf` module ports libraryaddict's Red Warfare Search and Destroy (see
`NOTICE`): one-life team PvP where attackers arm an enemy team's TNT bomb with
a blaze-powder fuse, defenders defuse it, a nuke in the middle kills everyone
but the team that armed it, and a poison forces long matches to a result. A
last surviving team must defuse its own armed bombs and hostile nukes before
winning. An eliminated planting team can still win when its armed objective
eliminates the final opposition; conflicting simultaneous detonations draw. The
rules are pure (`rwf.domain`); the Paper adapter carries out their effects at
20 Hz and seals the match world so every other module leaves it alone.

Bot movement goes through the roster's body port. Crossing worlds retains the
Citizens NPC and its UUID but despawns and spawns its player body, restoring its
equipment, attributes, vitals and spectator flags after Citizens initializes it.
Callers use the returned player because the old entity is gone. A player-style
cross-world teleport would wait for a client acknowledgement that an NPC cannot
send, leaving it immune to damage. Same-world moves keep the existing body.

Red Warfare uses two worlds, both named in `rwf.yml`'s `worlds` section: the
lobby world (`worlds.lobby`, `rwf_lobby`) holds only the lobby, and the map
world (`worlds.maps`, `rwf`) holds the maps. Keeping them apart lets the lobby
be any size without colliding with a map, and lets a map be prepared, previewed
and reverted while players wait. An operator provisions both through
Multiverse, loaded before TheStorm enables; a flat or void world is fine
because the lobby and each map bring their own terrain. A missing world stops
the server, like the world module's worlds. The module never generates terrain
itself, and seals both worlds so every other module leaves them alone.

Each world is a vanilla superflat world with a single air layer and the
`the_void` biome (the same settings the e2e fixture plugin creates), not a
TheStorm `ChunkGenerator`, and neither is listed in `world.yml`. Multiverse
loads its worlds before TheStorm enables, and Bukkit refuses a plugin
generator whose plugin is not enabled yet, so a generator of ours would leave
Multiverse unable to load the world on every boot. `world.yml` lists only the
survival worlds the world module validates and offers to random teleport; the
rwf module already requires and seals its own worlds, and listing them there
would make the world module refuse to start while `rwf` is off.

Configuration and content live under `server/owned/plugins/TheStorm`:

- `rwf.yml`: the two worlds, the fallback spectator point, how matches fill
  and start (`minHumans`, `targetCombatants`, `maxCombatants`, the 90 s
  countdown, the 30 s no-humans abort, the 20 s `voteLead` the map vote closes
  before the countdown ends, the 30 s `previewLength` and the 5 s
  `freezeLength`), the ported rule constants pinned to the code, rewards in
  Red Warfare credits (3 win / 1 lose scaled by the human share, the 2-credit
  AFK penalty, the minimum match length; no daily cap), recording, the
  load-test switch and `quarantine`: the maps kept out of the rotation, each
  with its reason (Saigon and Wonderland, whose conversion found a bomb no
  team can reach). Quarantined maps still ship and are verified; no match is
  played on them.
- `rwf/kits.yml`: the kits as the operator sees them, each with its play
  `category`, the `icon`
  material and the one to four `summary` lines the kit menu and the lobby's
  alcoves show; it must describe `KitBook` kit for kit or the module refuses
  to start.
- `rwf/maps/<id>/map.yml` and `blocks.schem`: a map's teams, spawns, bombs,
  nukes, region and the SHA-256 of its Sponge v3 schematic. The module pastes
  the active map and at most one successor during ordinary play. Candidate
  visits temporarily hold up to three terrains, prepared serially without
  activating bot navigation; selecting a winner evacuates visitors, releases
  the losers and activates the winner's match resources. It repairs terrain
  when the world's blocks stop matching the hash, visiting at most 2,000
  blocks per tick with admission closed meanwhile. `training-yard` is a
  generated 64x16x64 sample; its generator lives in the module's test sources.
- `rwf/maps/<id>/nav.rwfnav` and `nav.summary.json`: the map's baked navigation
  data for the bots, produced offline by the `rwfmap` tool (see Maps below).
- `rwf/maps/<id>/details.json`: required inventories and literal sign text,
  bound to the terrain hash. Empty maps declare empty lists explicitly.
- `rwf/lobby/lobby.yml` and `blocks.schem`: the lobby every player and bot
  waits in before a match, in the lobby world: an authored 178x36x100 build at
  `0,64,0` with its region, spawn, a side per team colour, one kit alcove per
  kit (51 occupied out of 60 slots, with the original 33 alcoves and three
  eight-bay Classic, Ranged and Tactical annex galleries), the rules
  and match-board anchors, the rotation wall with a slot per weekly free kit
  (four), three vote
  podiums (a lodestone to right-click and a display above it), three
  leaderboards (kills, wins, win streak), the watch balcony and the
  schematic's hash, plus its `nav.rwfnav` for the bots. It is pasted, verified
  and repaired exactly like a map.

### Maps

Original maps have deterministic programs and typed metadata in
`tools/maps/authored/`. From this package, render and lint a candidate before
exporting its terrain:

```bash
bun run maps:author --id copperworks --iteration review
bun run maps:author --id copperworks --iteration accepted --export
bun run maps:author-lobby --iteration review
bun run maps:author-lobby --iteration accepted --export
mise exec -- gradle -p plugin :rwfmap:installDist
bun run maps:integrate-content
```

The map and lobby authoring commands write contact sheets, hero/interior
views and lint evidence under `.cache/`. The lobby program preserves its
original courtyard and adds an annex through two declared doorways.
`maps:integrate-content` runs `tools/maps/content/integrate-content.ts`, using
the authored import descriptions in `tools/maps/content/descriptions.json`.
It strips legacy `[Buy]` shop signs from both sign faces,
matching text without case or legacy colour codes while preserving other
signs and original archives. It binds details to the updated terrain, bakes
changed navigation, verifies every installed map and updates source/training
scenario hashes. Retained `removed-shops.json` files record the removed sign
payloads. Commit terrain, metadata, details, navigation and scenarios together;
offline verification still requires real-server traversal acceptance.
To bind a focused map repair, pass repeated `--map <id>` arguments to
`maps:integrate-content`. Every installed map is still verified, while shop
removal, scenario writes and registry updates apply only to the selected maps.
Unknown or repeated map IDs are refused before any content is changed.

A map is authored in a build world and exported with WorldEdit
(`//schem save <id>` as a Sponge v3 schematic, terrain only: block entities and
entities are refused), copied to `rwf/maps/<id>/blocks.schem`, and described
in `map.yml` (teams, spawns, bombs, nukes, region and the schematic's hash,
which `rwfmap` reports when it disagrees). `mise exec -- gradle bakeRwfMaps`
then runs `plugin/tools/rwfmap` over every map folder: it classifies each
palette entry with a curated block-state table (`BlockTable`; an unknown state
fails the bake and must be added to the table, never guessed), bakes the nav
graph, regions, cover, chokepoints and routes with `rwfbots`' `MapBaker`, and
writes `nav.rwfnav` plus a `nav.summary.json` of counts for diff review. The
artifact carries the schematic's `blocksSha256`, so `rwfbots` refuses it when
the world's blocks change. Commit metadata, terrain, details and navigation together.
`mise exec -- gradle verifyRwfMaps` re-bakes every map in memory and fails
if a committed `nav.rwfnav` or summary differs
byte for byte; the bake is deterministic, so a diff means the map, the block
table or the baker changed and the artifacts must be rebaked. A bake that
`NavArtifact.validate()` rejects (a spawn inside a wall, a bomb no spawn can
reach) fails too; fix the map, not the tool. Navigation format 2, generator 4
and movement model 4 use server ticks for travel costs and health points for
fall damage. Directed edges include climbing, surface and submerged swimming,
ordinary wooden doors, jump-up steps, and sprint jumps with certified run-up
and flight clearance. Compressed water intervals preserve intermediate depths
without storing a graph node for every submerged block. Nodes retain actual
half-block standing heights and exact climbable-cell metadata. A climb edge
alone does not certify that the body's feet touch a ladder or vine. Prepared
run-ups survive equivalent replans;
takeoff rechecks position, momentum, health and expiring protection. Routes account for
cumulative fall damage, actual movement and protection capabilities, effect
expiry, available healing, known enemy exposure and bomb deadlines. A
successful bake proves graph connectivity; native movement must also be checked
in the pinned Paper/Citizens runtime.
Runtime exposure, congestion and personality penalties are traversal-time
densities: each leg integrates its endpoint values over its actual duration.
This keeps compressed jumps and water intervals from receiving an artificial
discount merely because they contain fewer graph nodes. These discretionary
costs do not advance physical arrival, protection-expiry or damage clocks.
Distance fields store lossless float-bit deltas in byte planes before
compression. The artifact declares this encoding explicitly; unknown encodings
and invalid distances fail decoding. Positive infinity represents unreachable
nodes.
`rwfmap upgrade-model3 <privateMapDir>` explicitly migrates a format-2,
generator-3, model-3 artifact in a private map copy. It requires the declared
distance encoding and matching original terrain, classification, sites and
legacy summary. It preserves all eight analysis sections and the existing
graph prefix byte for byte, adds the authoritative climbable-node bitset,
and verifies the result with the current strict decoder. It writes only that
copy's navigation artifact and summary. Validate the complete candidate catalog
before copying artifacts into owned content. Rebuild the lobby with
`bake-lobby` and `verify-lobby`. Ordinary runtime loading rejects the older
model; use a full bake for other source versions.
Walk-off drops extend to the first landing within the authored map's vertical
bounds. Sprint-jump certification separately bounds descents to sixteen blocks
and simulated flight to eighty ticks; an uncertified jump does not become a
route edge merely because its landing is survivable.
Run the deterministic rebake verification locally with the applicable extended
Minecraft checks. CI's unit suite decodes the committed artifacts and checks
their metadata and structural contracts.

After building `:rwfmap:installDist`, run
`plugin/tools/rwfmap/build/install/rwfmap/bin/rwfmap verify-health <mapDir>`
for an independent cumulative-damage admission check. It binds the saved
artifact to the authored terrain, map identity, spawns and bomb sites, then
checks every spawn against every selected fuse-worker position. Its JSON
report gives each position's minimum fall damage within a nineteen-point
budget; `-1` means no route fits. A nonzero exit rejects any unsafe selected
position. This check assumes ordinary twenty-point health without healing
or temporary protection; runtime routing additionally uses the fighter's
actual capabilities and effects. Run it across the admitted catalog locally,
alongside deterministic rebake verification.

Legacy Red Warfare ZIPs can be converted without modifying the originals:

```bash
bun run maps:import --source "$HOME/Downloads/Search and Destroy" --output .cache/rwf-map-import/batch-a
bun run maps:details --import .cache/rwf-map-import/batch-a --output .cache/rwf-map-details/batch-a
bun run maps:bake --import .cache/rwf-map-import/batch-a --details .cache/rwf-map-details/batch-a --output .cache/rwf-map-bake/batch-a
bun run maps:stage --bake .cache/rwf-map-bake/batch-a --details .cache/rwf-map-details/batch-a --output .cache/rwf-map-admission/batch-a
bun run maps:close-starts --maps .cache/rwf-map-admission/batch-a/maps --output .cache/rwf-close-starts/batch-a
bun run maps:verify-close-starts --maps .cache/rwf-close-starts/batch-a/maps --output .cache/rwf-close-starts-native/batch-a
bun run maps:verify-navigation --output .cache/rwf-map-navigation/batch-a
bun run maps:verify-runtime --maps .cache/rwf-map-admission/batch-a/maps --output .cache/rwf-map-runtime/batch-a --rotations 3
```

Output directories must be new. Import preserves each ZIP and its SHA-256,
extracts only safe archive paths, migrates its world in pinned Paper, and
exports terrain with stable, nonoverlapping coordinates. `--map <id>` selects
an archive for a retry while retaining the complete original ordering.
The bake command accepts repeated `--import` arguments to combine disjoint
conversion batches from that same ordering. It freezes its producer inputs,
writes a full-terrain duel scenario, then bakes and freshly verifies each
navigation artifact. Missing exports and failed maps fail the aggregate
command and remain visible in `results.json`; successful maps remain available
for inspection. Neither command installs content into the owned server tree.
`maps:stage` assembles a private catalog with Training Yard, freshly verifies
terrain, navigation and payloads, and writes matching duel scenarios. Use
`--extra <folder>` for an independently repaired and baked original, and
`--quarantine <id>` only for an unrepaired map that failed the offline bake.
Unresolved maps and missing payload exports stop staging.

`maps:close-starts` authors private close-combat candidates from the full original
terrain. It freshly bakes navigation and deterministically selects two positions
4–16 blocks apart, facing each other on the same floor height. Each position
needs a flat 3×3 patch with two blocks of actual air, a supported walking corridor,
a clear eye-level sightline and short paths between them in both directions.
Training directly places the duel roster at these authored positions, so the
arena does not need to connect back to each ordinary source spawn. Both positions
must remain on the complete original terrain. Exact schematic states exclude
partial floors and special movement surfaces that coarse navigation shapes could misclassify.
The output preserves original metadata, terrain, loot, signs and navigation;
only the private duel scenario changes. Every failure remains in `results.json`
and makes the catalog command fail. Native Paper proofs bind the exact starts
and terrain hash. The reviewed scenarios live in the training-only
`tools/learning/maps/training-scenarios.json` catalog and are copied only into
disposable training servers. The neutral map registry and ordinary server
rotation remain unchanged.

`maps:verify-close-starts` checks those candidates in disposable pinned Paper
using the production Citizens motor. It checks native floor height, player-sized
clearance and sightlines, then walks a round trip from each start without editing
terrain. It selects each requested map once through `/rwf admin setmap`, waits
for its resources, and starts a showcase while the fixture checks the two-map
cache bound. Each case stops and waits for an empty successor lobby before the
next selection. Repeated `--map <id>` selects a diagnostic subset of at least
three maps; omit it to request the whole candidate catalog. Retained reports bind
each result to its terrain hash and exact positions, and include physics samples,
producer hashes and server logs. Geometry and traversal evidence do not establish
bot quality or human gameplay acceptance.

The schematic contains terrain only. The converter also exports inventories
through Paper's versioned item API and both sign faces as literal visible text,
including color, glow and wax. Sign actions, command blocks' commands, entities
and other block-entity payloads are omitted. The source archive and migrated
world remain intact. `maps:details` can re-export this payload from existing
conversion batches, one disposable Paper owner at a time. Its checksummed
provenance states the preservation policy. `rwfmap verify-details <folder>`
checks positions, materials and terrain binding before runtime admission.
Runtime restoration decodes inventory payloads on the bounded compute pool.
Main-thread writes apply at most eight details per batch, with a 64 KiB encoded
inventory budget; a larger permitted inventory receives its own batch. Each
batch rechecks map ownership before accessing world state.
Metadata repairs use `maps:import --repairs <file>` with the exact original ZIP
hash and cannot overwrite valid source metadata.

`maps:verify-navigation` uses real Citizens bodies in a disposable Paper server
to check opening a door, respecting a denied interaction, ladder climbing,
jumping a gap and swimming to shore. It captures physics and server logs,
then removes its server. This fixture validates movement primitives; it does
not certify every route on an imported map.

`maps:calibrate-traversal --output <new-directory> --repetitions 3` measures
the production Citizens motor on disposable walk, jump, climb, water and drop
courses. Add `--driver graph` to bake and round-trip each course's navigation
artifact, then drive its production planner, reflex and motor together.
Build `:dist:shadowJar`, `:dist:fixturesJar` and `:rwfmap:installDist` first.
The runner freezes its producers, validates the shared scenario contract
and retains every trial, including failures. Per-tick observations include
position, velocity, grounded/fluid state, health and actual damage. Controlled
water trials reset to the same submerged start after skin setup; holding depth
must remain controlled for forty ticks. These measurements inform navigation
assets; reaching a course endpoint does not certify an imported map route or
server capacity. Keep this extended native check outside CI.

`maps:verify-health-native --output <new-directory>` checks real joined-member
health and movement capabilities in a disposable Training Yard match. Its
automated network client walks reversible drop courses; the fixture never
injects damage. It captures production snapshots and native FALL events,
samples health after vanilla damage applies, and binds each risk prediction
to the original member, kit and attempt. Cases cover ordinary health,
Juggernaut's thirty-point maximum and sprint restriction, cumulative damage,
water landings and protection expiry. Use repeated `--scenario <id>` arguments
to select cases. These controlled diagnostics supply neither human
demonstrations nor proof of autonomous route choice. Build the same three
artifacts as the traversal runner and keep this extended check outside CI.
The diagnostic waits for the real body to become vulnerable after a world
transfer. It records that transition without changing protection, and keeps
requiring vulnerability throughout the trial. Passive healing observations
include the native cause, actual health change, nutrition and world difficulty.
The controlled cases temporarily use Hard difficulty, food level seven and
zero saturation to isolate cumulative damage from peaceful and satiated
regeneration. They record the setup and restore the original difficulty and
nutrition on completion or failure, without changing health or healing rules.

`maps:verify-authored-combat-native --output <new-directory>` checks an original
authored NPC against an automated player entering with `/rwf join`. Build the
same three artifacts first. The runner stages a private Trooper-only experience
before the first ballot, waits for both original bodies and ordinary spawn
protection expiry, and observes actual melee events and retained player health
loss. It never commands the NPC's attacks or injects damage. A separate native
spectator records the encounter outside the two-fighter roster. The fixture
journals and restores private Hard difficulty; failures retain partial event
observations and actual body state. This extended diagnostic supplies neither
human demonstrations nor evidence for a larger lobby cap.
The runner selects Hard through the ordinary host menu before the match locks.
Its receipt binds frozen host settings and the bot's actual combat parameters
separately from the declared experience profile.

`bun tools/maps/pursuit.ts --output .cache/rwf-pursuit/batch-a` checks the
production planner, reflex and Citizens motor together in a small disposable
arena. Build `:dist:shadowJar` and `:dist:fixturesJar` first. A visible target
stands behind glass; the pursuer must take the doorway and regain sword
contact. The runner saves positions, controller outcomes and a native-client
video, then stops its observer and server. Attack commands are observed rather
than applied, so this proves pursuit traversal and does not certify player
damage or match capacity. Keep this extended check outside CI.

At startup, map metadata is loaded for the rotation. Terrain and navigation
are loaded asynchronously for the first map and at most one successor;
the lobby remains available throughout. Chunk loading, pasting and snapshots
are batched, and advancing releases the previous map's tickets and artifacts.
Admission waits for preparation rather than blocking the main thread.
An ordinary single-map reset verifies and repairs terrain before reopening the
lobby. Permanent plugin shutdown instead restores tracked craters and player
snapshots, clears bombs and releases bots and map resources without starting
verification or opening another match; pending lobby flag callbacks cannot
reopen admission after shutdown begins.
`maps:verify-runtime` observes these production cache ports while ordinary
eight-bot showcases rotate. It compares restored item slots and metadata and
every sign face with the source payload, checks the two-map resource bound,
waits for inactive chunks to unload, and records heap and tick measurements.
Heap samples retain used, committed and maximum bytes from the same JVM memory
observation; the report includes the peak committed heap as well as peak use.
The report and server log describe that disposable runtime; production
installation still requires the published candidate and GitOps release.
The catalog must contain at least three maps to prove that startup leaves
content unloaded. Repeated `--require-map <id>` arguments require ordinary
rotation to visit selected maps, up to twelve transitions; use this for the
largest maps and maps with more than two teams.
Repeated `--visit-map <id>` arguments instead select an explicit sequence through
the ordinary admin map command and preparation handshake. The sequence must
cover every required map and contain at least `--rotations` entries, up to
twelve. Every selected map must actually become live; every required map must
also retire. For example, visit Warlords, Tropicals, Training Yard and Tropicals
again to observe both large maps together and then release each map at least
once. Omitting this option retains ordinary randomized rotation.
Terrain fingerprints stream the original canonical bytes through a bounded
buffer and reuse exact snapshot palette lookups, avoiding terrain-sized hash
buffers while retaining the same content verification.

The lobby is authored like a map: build it in a build world, export
`blocks.schem` with WorldEdit and describe its places in `lobby.yml`.
`mise exec -- gradle bakeRwfLobby` refuses to go further until `lobby.yml`
declares the schematic's hash, then bakes the lobby's nav files with its places
(spawn, sides, alcoves, podium and rotation stands, balcony) as sites and no
bombs. `verifyRwfLobby` (run by `verifyRwfMaps`, so by `check`) fails when the
hash disagrees, a stand is not standable, a kit in `KitBook.ALL` has no alcove
(or the alcoves show any other kit), the rotation wall does not have one slot
per weekly free kit, a team colour has no side, any place cannot be reached from the spawn, or the nav files are
not what a fresh bake produces. Rebake and commit the four files together. The
MockBukkit suites paste a small test lobby
(`modules/rwf/src/test/resources/fixtures/lobby`), because MockBukkit cannot
make block data for the build's walls, panes and lanterns.

Commands: `/rwf join` (joining a match already under way watches it until the
next lobby opens), `/rwf leave`, `/rwf kit <id>`, `/rwf kits` (the kit menu), `/rwf buy
<kit>`, `/rwf rotation`, `/rwf credits`, `/rwf who`, `/rwf size`,
`/rwf maps` (candidate descriptions, visits and voting), `/rwf visit <map>`,
`/rwf return`, `/rwf vote <map>`, `/rwf time`, `/rwf teamchat`, `/rwf stats [player]`,
`/rwf stats top <stat>`, `/rwf stats history`, `/suicide`, `/rwf spectate`,
`/rwf spectate next|previous` and `/rwf goto <player>`
(`thestorm.rwf.spectate`, granted by default), and
for `thestorm.rwf.admin`: `/rwf admin status` (including the match features
read from the flags), `/rwf admin start|stop|forcestop|skip`,
`/rwf admin extend <seconds>`, `/rwf admin setmap <map>`,
`/rwf admin team <player> <team>`, `/rwf admin forcekit <player> <kit>`,
`/rwf admin quarantine <map>` and `/rwf admin unquarantine <map>` (kept in the
`rwf_map_quarantine` table across restarts; `rwf.yml` stays the repository's record),
`/rwf admin repair` (re-verifies the lobby and the current map between
matches, re-pasting whatever differs), `/rwf admin loadtest <n>` (only when
`loadtest.enabled`) and `/rwf admin showcase [count]`. Joining snapshots a player's belongings
through the shared crash-safe snapshot machinery and restores them on leave,
death, disconnect or the next login. A player may join again straight after a
match; see the arena section for how the restore is confirmed.

### Match experience

A match moves through `Lobby`, `Countdown`, `Preparing` (only while the chosen
map is still loading), `Preview`, `Freeze`, `Live`, `Ended` and `Resetting`.
The [Red Warfare feature flags reference](../docs/wiki/src/content/docs/reference/red-warfare-feature-flags.md)
owns the gameplay gates, environment values, targeting and refresh boundaries.
`FliptRwfFeatures` supplies the immutable feature snapshot used by `MatchRunner`.

With match flow and candidate visits enabled, up to three candidate terrains
prepare serially before a 90-second voting opportunity. Members independently
fly over candidates with /rwf visit, switch maps or return; selection then
activates the winning map's resources before bot arrivals and the selected
preview. The host settings gate gives the first admitted human a comparator
in hotbar slot 7. Members can also open that menu with `/rwf options`; only
the host can edit it. Auto fills the map target, Off disables bots, or a fixed
count requests bots around admitted humans. Easy, Normal and Hard retain
personality variation within their skill bands. Settings lock at vote close;
later edits apply next round.

Kills and assists use Red Warfare's responsibility shares: the damage log
keeps each hit until the victim is back
to full health and 10 seconds have passed; the killer gets a whole kill, and
each other attacker their share towards their killstreak, counted as an assist
between 0.1 and 1. Bomb victims get no death message, as in the original.

Host ownership transfers to the oldest remaining human. Preferences carry into
consecutive rounds and reset when no humans remain. Candidate visits and the
selected-map preview clear temporary flight before normal play; the shared
snapshot keeper restores the player's original game mode, flight permissions,
flight speed and native hit-immunity limit on exit or crash recovery.

What every match looks like, whatever the flags, follows the original:

- The lobby wants 4 players (`minPlayers`) before counting down, one fewer for
  every 15 s it waits (`relaxEvery`), never under 2 (`absoluteMinPlayers`), as
  `LobbyManager#getMinPlayers` had it. Bots count: once `minHumans` humans are
  in and the map is loaded, drafted bots walk in over those 15 s.
- The sidebar is the original's: "Red Warfare" with the map, players and
  countdown before the start; "Teams" during the match, only teams with
  someone alive, most alive first, each with "N alive" and its bomb ("Bomb is
  Safe", "Bomb N" or the defuse bar), then the nukes. Bomb holograms read
  "Red Team's Bomb", "Unarmed nuke" or "Exploding in N". Broadcasts use the
  original's wording and colours; `/rwf time` during the match answers as the
  original's `/time` did.
- Everyone sees each fighter wearing their team's block (TNT, diamond ore,
  leaves, obsidian, gold) as a per-viewer hat, and each fighter carries the
  team chestplate in slot 8. Eating a steak plays the original's eat sound.
- The dead get the spectator compass, the kit layout star once kits have
  layouts, and "Join next game", which queues them for the next lobby.
- At the end everyone still fighting takes off and flies, and fireworks in the
  winners' colour go off around them every half second.
- Nothing hurts before the match goes live, the void included: anyone who drops
  8 blocks below the lobby or the map is put back at the lobby spawn, their
  start while frozen, or the map's spectator point (previewing, dead, watching
  or after the end).

Humans' kit picks, map votes and finished matches go to PostHog through core
analytics as `rwf_kit_selected`, `rwf_map_vote` and `rwf_match_completed`;
`RwfAnalytics` also carries the `rwf_killstreak_used` and `rwf_kit_purchased`
hooks the killstreaks and kit shop call. Bots send nothing. Recordings get a
row for each potion effect a fighter gains, and `MatchRunner.MatchHooks` is how
abilities (counted towards `ability_uses`), killstreaks and placed barricades or
banners reach the recording.

Statistics (migration `V3__match_stats.sql`) are written in the transaction
that records the match: the match's seed, duration, end reason, ballot and map
hash; each human's assists, damage dealt and taken, arms, defuses, explosions,
shots fired and hit, steaks, time alive and kit switches; the `rwf_match_event`
log; lifetime `rwf_player_stats` and per-kit `rwf_player_kit_stats` totals;
and `rwf_player_prefs` (last kit, team chat default, and the kit layouts the
kit module saves). Rows written before V3
leave the new columns empty.

On a live map the border is Red Warfare's square: it bounds the columns (X and
Z) only. A fighter outside it takes 2 damage a second through armor and is told
`You cannot explore the border!`; climbing above the map is allowed. A fighter
more than 8 blocks below the map's lowest block dies in the void. The kill goes
to whoever last hit them on the way down (`VOID_PUSHED` or `VOID_SHOT`), or to
nobody. A bomb's victims have no attacker. Their kill goes to the last member
who hurt them, while that hit still counts: until the victim is back to full
health and 10 seconds have passed, as the original's combat log did. The
Rewind kit's Time Machine samples and trims its trail every tick and records
only spots the original's safe-teleport check accepts. It lands the player
facing the way they faced there, and its recharge shows on the experience bar.

### Kits

`domain/kit/KitBook.java` holds all 51 kits: the previous 33 (22 Red Warfare
originals and 11 Storm kits) plus six Classic, six Ranged and six Tactical
kits. `KITS.md` in
the module is the per-kit reference (items, prices, tiers, every ability's
numbers and the deviations from the original). Abilities are pure classes
under `domain/ability/kits`, registered in `AbilityBook`; the match feeds them
its events (hits, hurts, deaths, ticks with each fighter's motion and the
map's ground, kit-item uses) and carries out what they answer as
`MatchEffect.Ability` effects through `KitPowers`, `KitWorld` and their
listeners. Every kit's state lives in the match this way, the Rewind kit's
Time Machine trail and cooldown included (`kits/Rewind.java`): a tick's
`Ground` re-reads whether each kept spot is still a safe landing.

`FliptPlayerFlag` supplies the player gate used by `Armory`, `StreakPicker`
and `Killstreaks`; their declarations and cache behavior are in the feature
flags reference above.

Open the reward selector from the kit menu or `/rwf killstreaks`. The command
`/rwf killstreaks compass wolves iron-golem` saves the same three-reward
selection directly. Selection is open for the same pregame phases as kits;
the default is compass, supply crate and iron golem. Choose three distinct
thresholds: compass at 2 kills, crate or wolves at 4, golem at 8, napalm at 11.
Each selected reward is earned once per life, including assist shares. A
crate and wolves cannot share a loadout because both cost four kills.
Preferences are saved through the asynchronous `StreakStore` in
`rwf_streak_prefs` (migration V6), then loaded before admission. An absent row
means the defined default; a corrupt row fails admission explicitly. A save
that finishes after the round starts applies to the next round. Death clears
streak progress while preserving kill and assist totals; late credit updates
those totals without earning rewards for the dead life. Summons share their
owner's team, spare allied players and summons, and retain owner attribution
when attacking human or NPC enemies.

- Six kits are free; the rest are bought once with Red Warfare credits through
  `app/shop/KitShop`. A purchase is a pending `rwf_kit_purchase` row before the
  ledger moves credits and a granted one after, so a crash between the two is
  settled on the next start; ownership lives in `rwf_kit_owned` (migration
  `V4__kit_shop.sql`). Both tables are reset by a world restore, like the
  economy.
- The kit browser retains its page, category, access filter and sorting choice
  while navigating or returning from a purchase/layout editor. Pages show up
  to 36 kits; access filters distinguish available, owned and weekly rotation
  kits, and sorting supports catalog order, name, price and tier.
- `KitRotation` derives each ISO week's four free kits from a fixed seed; the
  lobby board and `/rwf rotation` show them.
- A right-click on a kit in the menu opens the layout editor; closing it saves
  the layout to `rwf_player_prefs.kit_layouts`, and every equip follows it.
  On joining, a member who has not picked yet is given their `last_kit` when
  they may still pick it.
- Scoreboards are per viewing team, plus a copy for Medics that shows
  everyone's health under their name. An enemy Ghost or Wraith is on a hidden
  team, an enemy Spy on the viewer's own team, and a dressed Skinner hidden
  with its worn name drawn above it for the enemy only.
- Teams are dealt with Medics spread evenly first (`KitBook.SPREAD_EVENLY`).

Bots know every kit (`rwfbots` `Kit`). Their hotbar is read from rwf's own
layout (`KitHotbar`), and `KitPlay` decides when to use a kit item from what a
bot can fairly see: a Medic waves its wand by a hurt ally, an Explosive fires
RPGs at range and grenades up close, Demolitions and Teleporter set theirs down
once they arrive with nobody in sight, a Teleporter's remote puts a pad under
its farthest teammate when no enemy is near, a Sacrificial bonds the nearest
ally it touches and snips its bonds when low, Spotter and Bannerman use theirs
on an enemy in view, Engineer and Decoy theirs when hurt, and a Grappler hooks
toward a far waypoint. Kits whose power is in how they move have it in the
body (`Kit.Body`): a Dwarf sneaks whenever it waits with no enemy in sight, and
an Inertia sprints straight at its target instead of strafing until it is in
reach. The use goes through `BotActions.useKit` and becomes the same ability
input a player's click does (`BotKitUses`). The think step has a per-kit hook
too (`KitTactics`): small leans on the option scores toward what each kit is
for (a Sapper toward defusing, a Saboteur toward arming, kits that leave
something behind or grow while waiting toward holding a slot, stealth kits
toward hunting, the Medic and Sacrificial away from engaging), never as large
as the margin an urgent option needs. `rwfbots.yml` allows every
kit, and the match narrows the draft to the first four kits unless the full
list is on for someone present (`MatchView.kitsOnOffer`).

Crossbows, tridents, spears and maces use native item completion, including
finite ammunition, Multishot/Piercing, Loyalty return, tipped effects and mace
smash callbacks. The adapter rewrites native damage once through RWF's damage
rules while retaining the server's successful-hit path. The match owns its
hit window independently of vanilla `noDamageTicks`; legacy sword/axe timing
and native modern-weapon cooldowns remain distinct. Native operation signatures
are linked against pinned Paper 26.2 at startup and fail if that contract changes.

RWF exports `BattleSounds`, `VisualOcclusion`, `TacticalReports` and
`TacticalCasting` app ports to its bot adapter. Audible movement, landing,
splashing and combat enter a sequenced three-second bounded sound history.
Each consumer keeps its own cursor, so a slower bot or listening post does
not drain another reader's events. Listening posts publish approximate enemy
sound cells without identity. Smoke uses the same segment/sphere visibility
test for human entity tracking and bot perception; sound and projectiles still
pass. The core `PlayerVisibilityControl` service composes typed staff-vanish,
combat and spectator reasons before changing Paper's per-plugin visibility.
Combat composes smoke and stealth within its reason. Releasing one reason
restores tracking only when every reason for that viewer/target has cleared;
other plugins retain their own hides. Quit, module stop and plugin disable
release the relevant ownership. Fields, devices and cast state expire or clear
when their owner leaves or the match resets.

Ordinary matches use `match.automaticSizing: true`: automatic sizing chooses
the large preset for each map. `/rwf size` shows small, medium and large totals,
players per team, and the bot deficit after current humans. Medium targets are
16 combatants for horizontal footprints up to 128×128 blocks, 32 up to
200×200, and 48 above that. Small halves the target; large adds half. Presets
round down to equal teams and cap at the smallest team's saved spawn capacity
and `maxCombatants`. For example, the training yard defaults to 16 total,
Red Sand Seas to 24, and Apex Expanse to 72. These footprint-based suggestions
are initial tuning values, rather than measured match-quality ratings.

Administrators can use `/rwf admin size auto|small|medium|large` or
`/rwf admin size team <players>` (humans and bots combined per team). This is
one shared lobby: overrides affect everyone, last until module restart, and
apply when a countdown next drafts bots. An ongoing draft keeps its original
target. A team override follows the map's team count on rotation, bounded by
the server cap; it may reuse spawn positions. Bots fill the deficit up to the
target; missing bots, governor reductions, or additional human joins can
change the actual roster. With `automaticSizing: false`, ordinary matches use
`targetCombatants`, preserving explicit duel and training profiles.
The E2E/full/load gameplay fixtures select Training Yard explicitly because
their geometry assertions use that map. A native preview with `--rwf-map`
selects its requested map; neither selection changes the production catalog.

`rwf.yml` also requires an `experience` section: difficulty (`easy`, `normal`,
`hard`), style (`varied`, `push`, `cautious`, `teamplay`), variety (`low`,
`medium`, `high`), and map/kit ID restrictions. Empty restrictions admit every
otherwise available choice. The shipped experience is hard, varied and high
variety, with the existing automatic large lobby sizing. `/rwf settings` shows
the current frozen experience and the next draft's preferences.

Administrators can use `/rwf admin settings preset relaxed|balanced|challenging`
or set `difficulty`, `style`, `variety`, `maps` or `kits` individually. Map and
kit pools accept IDs separated by spaces or commas, or `all`. A restricted kit
pool must contain a universally available starter kit and still respects each
human's unlocks. Overrides stay in memory until restart and apply to the next
map draft. The draft freezes settings and its recorded seed together; late
arrivals retain that experience. The recording's `E/settings` event contains
the effective canonical settings and SHA-256 fingerprint. Presets do not raise
the match cap or enable an unaccepted learned model.

Watchers (`/rwf spectate`) are snapshotted through the same keeper under the
`rwf_watch` scope, then put in spectator mode at the map's spectator point
with the match scoreboard; `/rwf spectate next` follows the next living
fighter. They are never match members: the read model, the humans rule
(`minHumans`, `noHumansAbort`), team balance and payouts never see them. They
stay through every phase and move to each new map's spectator point, and
`/rwf leave`, quitting, the module stopping or (after a crash) the next login
restores them. A member cannot watch; a watcher who joins the lobby keeps the
snapshot taken when they started watching, so no second snapshot overwrites
it.

`/rwf admin showcase [count]` (default `targetCombatants`) starts a bots-only
match from a lobby with no humans in it. It needs the `rwfbots` roster and
refuses while humans are in the match. Acceptance reserves the lobby, settles
its ballot with the domain's seeded tie-break, and waits for terrain and map
resources (including confirmed bot navigation) before the first bot draft.
Candidate visits and showcases use the same activation path and map limits.
Pending starts block human admission and duplicate starts; stopping or
superseding the request prevents a late completion from drafting. The showcase
is adapter state, not a domain mode: the countdown fills to `count`, the humans rule is off, and
humans may watch but not join. It plays, records and stores like any match
(bots are never paid, so it pays nobody) and the lobby after it is normal.
Operator integrations that must inspect pristine terrain first use
`ShowcaseControl.prepare(lobbyId)`: it settles only that exact empty lobby's
ballot and activates the chosen map without drafting or reseeding. Wait for
the ready chosen map in `Lobby`, inspect it, then call `startSeeded` separately.

Matches are recorded under pseudonyms (positions, actions, results) to
`plugins/TheStorm/rwf-recordings/yyyy/MM/dd/<matchId>.rwfrec.gz` for review and
bot training; every joining human is told so on entry. Pseudonyms are
HMAC-SHA256 over the salt in `RWF_RECORDING_SALT`, which must be set when
`recording.enabled` is true. A recording is written as
`<matchId>.rwfrec.gz.part` and renamed to `<matchId>.rwfrec.gz` only once its
end row is written, so a `.rwfrec.gz` file is always finished. At enable,
recordings are pruned by age and size, but only archived ones: a recording is
archived when a sibling `<file>.archived` marker (`rwf-archive-v1`, object key,
confirmed SHA-256, size, tab-separated) matches its size. The archiver writes
the marker only after the object store has confirmed the upload: the
`the-storm-rwf-recording-archive` Temporal schedule (`packages/temporal`,
with its independent gate documented in the feature flags reference above)
reads finished recordings through
`kubectl exec`, stores them in the SeaweedFS bucket `the-storm-rwf-recordings`
(protected, backed up daily) under `the-storm/rwf-recordings/<path>`, reads each back and hashes it, then writes
the marker. `server/owned/plugins/TheStorm/rwf-archive.json` is the contract
both sides check (`ArchiveContractTest` on the plugin side). A recording
without one is never deleted, however old or however far over `maxBytes`; the
module warns how far unarchived recordings hold the folder over the cap.
`.part` files from a crash are never touched.

A recording is gzipped UTF-8 text, one tab-separated row per line, written by
`RecordCodec` (format version 4; `RecordCodecTest` also preserves the version 2 golden copy and `MatchReplayTest` round-trips every version 4 row). Tabs,
newlines and backslashes inside a field are escaped with a backslash. Ticks
count from the moment the match went live, at 50 ms each.

| Tag | Row                                                                                                                                                                                                                                                                                            | When                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `H` | version, match id, map id, map block SHA-256, seed, rules version                                                                                                                                                                                                                              | once, first                                                         |
| `R` | pseudonym, team, kit, bot (`true`/`false`)                                                                                                                                                                                                                                                     | once per combatant, after `H`                                       |
| `E` | tick, kind, subject, detail                                                                                                                                                                                                                                                                    | each match event                                                    |
| `F` | tick, pseudonym, x, y, z (1/32 block), yaw (0-255), pitch (-64..64), health (1/4 point), held slot, flags (sneak 1, sprint 2, fire 4, block 8)                                                                                                                                                 | everyone every tick (20 Hz); bots every other tick before version 4 |
| `N` | tick, pseudonym, keys (forward 1, back 2, left 4, right 8, jump 16, sneak 32, sprint 64), yaw (0-35999), pitch (-9000..9000), attack, use, hotbar slot (0-8), client sequence, acknowledged observation tick or -1, source (`HUMAN`, `AUTOMATED`, `MISSING`); angles in hundredths of a degree | humans only, every tick                                             |
| `O` | tick, pseudonym, observation contract id, normalized float values in contract order                                                                                                                                                                                                            | humans every tick when rwfbots provides its observation port        |
| `I` | tick, pseudonym, kind, target                                                                                                                                                                                                                                                                  | each bot intent                                                     |
| `V` | tick, chosen map, then each candidate map and its votes, in ballot order                                                                                                                                                                                                                       | once, at tick 0 (version 4)                                         |
| `D` | tick, victim, killer or `-`, cause (attack type name), weapon or `-`, distance in blocks or `-`, then `pseudonym=share` per assist (share of the damage, 0 to 1]                                                                                                                               | each death (version 4)                                              |
| `C` | tick, speaker, channel (`global`, `team`, `dead`), length; then the text for a rostered bot only, empty for a human                                                                                                                                                                            | each chat line (version 4)                                          |
| `B` | tick, x, y, z, block state, reason (`CRATER`, `REVERT`, `BARRICADE`, `BANNER`)                                                                                                                                                                                                                 | each block the match changes (version 4)                            |
| `J` | tick, shooter, kind, x, y, z, velocity x, y, z (blocks per tick)                                                                                                                                                                                                                               | each projectile launched (version 4)                                |
| `A` | tick, user, ability id, target or empty                                                                                                                                                                                                                                                        | each ability use (version 4)                                        |
| `U` | tick, subject, effect id, amplifier, duration ticks                                                                                                                                                                                                                                            | each effect applied (version 4)                                     |
| `K` | tick, earner, streak id, kill count                                                                                                                                                                                                                                                            | each killstreak reward (version 4)                                  |
| `S` | tick, poison stage, `TEAM=alive` list, `bomb=STATE` list (`IDLE`, `ARMING`, `ARMED`, `DEFUSING`, `DESTROYED`)                                                                                                                                                                                  | every 100 ticks (5 s) while live (version 4)                        |
| `X` | tick, winner or `-`, reason                                                                                                                                                                                                                                                                    | once, at the end                                                    |
| `P` | pseudonym, credits                                                                                                                                                                                                                                                                             | once per paid human, after `X`                                      |

The dedicated Fabric preview client sends complete `N` controls at 20 Hz through
`thestorm:rwf_input`. `/rwf recording` reports whether the Storm client is
sending manual controls and acknowledging combat observations. Chat and menus
pause controls; the status read does not consume them. Vanilla sessions remain
diagnostic, and whole-match eligibility is decided by the dataset exporter.
The client's sequence and acknowledgement of
`thestorm:rwf_observation` connect each action to the server observation the
client received. Tick offsets use Paper's tick counter. Ordinary clients, missing
packets and already-consumed packets produce `MISSING` diagnostic rows using
Paper's movement input and server rotation; missing attack/use labels are never
treated as human demonstrations. Preview automation marks controls `AUTOMATED`.
Recording leaves manual keyboard and mouse input under the player's control.
Attack and use callbacks retain clicks released before the end-of-tick sample.

`O` uses `plugin/modules/rwfbots/src/main/resources/rwf-combat-v1.tsv` as the
language-neutral order and normalization contract. It contains own state,
visible targets, decaying last-seen sightings and local terrain rays. Current
hidden enemy positions and enemy health are absent. Roster and outcome rows
remain evaluation metadata, separate from actor observations.

`F`, `N` and `O` rows are per-tick samples. A writer that falls behind drops
nothing: samples wait in memory and the log warns once the backlog passes
20,000. Only past 2,000,000 waiting samples, which only a stalled disk
reaches, are new ones dropped; every drop is logged as an error, the count is
stored in `rwf_match.dropped_frames`, and a finished recording with drops logs
`rwf_recording_dropped_frames=<n>` at error level. Every other row is always
written. A reader reads versions 2, 3 and 4 explicitly (`RecordCodec.read`
streams a file row by row for replay); version 2 lacks complete controls and
is excluded from training, and version 3 has no occurrence rows. Unknown
versions and corrupt contracts fail validation.

For local human demonstrations, run `bun run client preview --rwf-duel` from
this package. It starts a disposable Paper server with one Trooper bot and a
six-second countdown. Join with `/rwf join`, select `/rwf kit trooper` before
the start, and play using the real keyboard and mouse. The regular preview
command keeps the full team setup for other-kit or team recordings. In the
one-human duel preview, the first match is still started manually; after a
completed match resets, the preview rejoins the human and selects Trooper for
the next game. It automates lobby commands only, never gameplay controls. The
server's owned configuration stays unchanged. Add `--rwf-map <id>` to select a map
installed in owned content. Its `scenario.json` must match the neutral
`rwf-map-scenarios.json` registry and bind the schematic hash, full region and
source-team mapping and starts. A disposable duel gives Red/Blue exactly the
two declared scenario positions and facings, including authored starts, and
rebakes their bomb goal fields while retaining the full terrain;
ordinary preview retains the map's original team count. Stop with the printed session path:

```bash
bun run client stop --session .cache/client/<session>/session.json
bun run bots:dataset inspect .cache/client/<session>/recordings
bun run bots:dataset export .cache/client/<session>/recordings --output .cache/rwf-dataset
bun run test:learning
```

The launcher gracefully stops Paper and exports recordings into the session's
artifact directory before removing its container. The dataset exporter accepts
only naturally completed duels (`LAST_TEAM_STANDING` or `DRAW`), with a valid
rostered winner or a winnerless draw. Stopped matches remain diagnostic and
cannot supply demonstrations. Samples cannot extend past the end tick; only
validated human payout rows may follow the end row. Export accepts
human Trooper combat in two-combatant matches, sword selected, without an
authored item action, and with an acknowledged observation no older than two
ticks. Gaps and automated input break recurrent sequences; they are never
interpolated. Movement labels use the acknowledged observation's facing basis.
Pass multiple recording directories to combine sessions. At least ten usable
matches are required for a seeded 80/10/10 split, keeping all actors and segments
of each match together. Inspection reports action histograms; export rejects
captures without attacks or movement. The manifest pins the observation contract and recording
hashes. `--combatants 8` can inspect team captures; the default Trooper pilot
export remains restricted to duels. These commands prepare data; they do not
train or enable a learned controller.

The Trooper behavior-cloning tools live in `tools/learning`, with dependencies
pinned by `uv.lock`. Run these commands from this package:

Package Python commands, Gradle's archive/restore tests, map import and recording
validation all use this locked environment explicitly. They require `uv` and do
not depend on the host's `python3` selection. Server runtime scripts use the
Python supplied by the server image.

```bash
uv sync --project tools/learning --locked
uv run --project tools/learning --locked python tools/learning/train.py .cache/rwf-dataset --output .cache/rwf-models/seed-17 --device mps --seed 17 --max-seconds 3600
uv run --project tools/learning --locked python tools/learning/export.py .cache/rwf-models/seed-17 --output .cache/rwf-models/seed-17-onnx
bun run test:learning
bun run lint:learning
bun run typecheck:learning
```

The trainer requires dataset export schema 3, which pins the three split files
by SHA-256 and binds every match and sequence to its map ID and terrain hash.
Re-export older datasets from their original human recordings.
It checks whole-match isolation, fresh observation acknowledgements and
continuous control sequences before training. Evaluation splits contain new
matches on known maps; training across every validated map does not measure
generalization to unseen maps. The actor receives only the 34
fair observation values, uses a 128-unit LSTM, and produces five categorical
heads for movement, jump, sneak, sprint and attack. Memory resets at segment
boundaries and carries across truncated training windows; padding contributes
no loss. Validation selects the best checkpoint; test matches stay out of
optimization and checkpoint selection.

Choose `--device cpu` or `--device mps` explicitly. An unavailable MPS device
fails. Each BC invocation has a cooperative wall-clock limit (at most eight
hours), checked between training and validation windows. Reserve this time
within the pilot's per-seed budget. The Paper PPO runner described below includes
BC initialization in its cooperative invocation budget; the three-seed pilot's
durable total budget requires separate orchestration. Checkpoint and export directories must be new.
Their manifests pin weights, feature order and the observation contract and
remain `unaccepted`. ONNX export checks CPU parity for 16 recurrent steps at
batch sizes 1, 3, 20 and 100; Java inference and combat acceptance require
separate verification.

For an accelerator and export check without human recordings:

```bash
uv run --project tools/learning --locked python tools/learning/verify.py --device mps --output .cache/rwf-training/mps-check
```

This command uses synthetic data and writes an explicitly unaccepted diagnostic
checkpoint, ONNX actor and `verification.json`. It verifies training mechanics
and numerical agreement, without measuring combat strength or human likeness.

The disposable fixture plugin also exposes `rwflearn` through authenticated
console/RCON. It runs two skill-1 Troopers on Paper with equal kit statistics;
the candidate keeps authored aim and healing, and the basic opponent sprints,
strafes and clicks its sword. The fixture command is absent from `TheStorm.jar`.
Build the jars and run the benchmark from this package:

```bash
mise exec -- gradle -p plugin :dist:assemble
bun run bots:benchmark --matches 4 --probe
bun run bots:benchmark --matches 100
```

Each run owns and removes its disposable server, exports the recordings, and
writes a manifest, per-match results and a report under `.cache/rwf-benchmark`.
The manifest freezes plugin, fixture, kit, map and observation-contract hashes
and records the pinned Paper build, server image and third-party plugins before
trials begin. Trials pair each controller seed across red and blue;
Paper scheduling and physical knockback still introduce runtime variation.
Only a completed 100-trial run with at least 80 wins passes the strength gate.
Draws, stops and 60-second timeouts count as non-wins. A failed 100-trial gate
exits with status 1 after exporting evidence and removing the server. Short
runs are diagnostics.

`rwflearn begin <seed> <red|blue> <authored|external> [opponent]`
requires an empty lobby on the fixture's admitted map. The optional opponent defaults to the
frozen basic controller. Stationary does not move or attack; chase closes and
attacks without strafing; authored uses its normal combat and healing.
`authored-pressure` closes to 2.5 blocks and `authored-patient` prefers a
2.7–3.0-block spacing band; both keep authored aim, click timing and healing.
These movement variants are confined to the disposable fixture. The `historical`
opponent requires external mode and controls the second body with a frozen actor.
`rwflearn state` returns a version-3 JSON envelope, defined with its action
layout in `plugin/modules/rwfbots/src/main/resources/rwf-duel.json`. Actor
input is exclusively its 34-value `observation` vector, ordered by the same TSV
as human recordings; damage totals and outcomes are separate evaluation data.
The context fields `tick`, `elapsed` and `hp` describe the last captured frame
before commands were applied; terminal `hp` is not the final health after a hit.
`rwflearn act <match> <body> <life> <tick> <move> <jump> <sneak> <sprint> <attack>`
uses the dataset's nine movement labels and 0/1 button values. The server checks
match, body, life, monotonically acknowledged ticks and a maximum age of two
ticks, and retains the acknowledged facing for movement. Item use, aim and
noncombat actions stay authored. Missing or expired actions restore authored
control. `rwflearn cancel` stops only the exact bots-only experiment; experiments
do not update personality ratings and cannot control the successor match.
`tools/learning/duels.ts` provides the validated asynchronous RCON client.
Historical duels additionally expose `opponentFrame` with that body's own fair
observation, body/life/tick and applied-control acknowledgements. `rwflearn acts`
accepts two consecutive nine-field action contexts, with distinct bodies and the
same tick. It validates both before accepting either. Each body has independent
action clocks, facing contexts and fallback accounting.

The PPO runner owns a disposable Paper server and a Python worker. RCON
credentials stay in the server owner; the worker receives only validated
observations and sends control requests over its private process pipes. From
this package, after building the fixture and plugin jars:

```bash
bun run bots:ppo --dataset .cache/rwf-dataset --checkpoint .cache/rwf-models/seed-17 --device mps --seed 17 --seconds 3600 --opponent basic --output .cache/rwf-ppo/seed-17
uv run --project tools/learning --locked python tools/learning/export.py .cache/rwf-ppo/seed-17/learning/final --output .cache/rwf-ppo/seed-17/onnx
bun run bots:ppo --diagnostic --updates 1 --episodes 2 --seconds 240 --device mps --output .cache/rwf-ppo/diagnostic
```

Outside diagnostic mode, a genuine human dataset is required. An optional BC
checkpoint must pin that dataset; otherwise BC initializes the actor within
the same invocation. PPO uses four epochs, 64-tick recurrent windows, clipped
policy and value objectives, and imitation from the human training split.
It recomputes recurrent prefixes with the current weights for every window.
Validation and test matches do not enter PPO optimization or checkpoint selection.

PPO freezes every installed map's training scenario, terrain hash and scenario
hash in `training-maps.json`. Installed folders must match the neutral scenario
registry exactly; the separately versioned training-only scenario catalog can
replace starts in disposable servers without changing that registry. Collection
pairs red and blue on each map before advancing
through the sorted catalog, then repeats the catalog. Each successful rollout
records these identities, and the owner checks them against the fixture's
original native setup. Map changes require an empty lobby; the old sandbox is
stopped before a new one opens. All map staging, boot and transitions consume
the same original seed deadline. A pilot cannot freeze until confirmed actor
controls from both sides of every admitted map have contributed to completed
optimizer steps. Diagnostics select Training Yard only.

Strength evaluation freezes the same catalog as the pilot and distributes the
fixed 200 games per opponent across every admitted map. Each environment seed
is paired across red and blue against both opponents. Maps receive either the
same number of pairs or one additional pair; the catalog must fit within the
100 available pairs. All trials on one map run together before the sandbox
changes. Version-2 reports bind every game to its terrain and scenario hashes;
the owner saves and verifies the original Paper setup for every evaluation
duel. An omitted map, changed hash, reordered game or repeated match invalidates
the run. This evaluates admitted training maps with fresh environment seeds;
it does not measure performance on unseen maps. The existing win thresholds,
one-shot evaluation claim, deadlines and no-retry rule apply across the catalog.

Damage rewards use cumulative Paper damage sampled before any body acts, with
`(damage dealt - damage received) / 20`, a `0.001` decision cost, and a `+1/-1`
terminal win/loss bonus. Aim, item use, healing and navigation remain authored.
Paper confirms which submitted decisions actually controlled a body; only
those receive actor loss. Unapplied decisions still train the value function.
Skipped 20 Hz observations or expired contexts discard the whole episode;
an action that races with the duel ending does the same, using the fixture's
explicit `duel no longer live` response. Malformed requests still fail loudly;
three consecutive discarded episodes stop collection for repair. Budget
expiry during an optimizer update restores its starting weights.

Each run freezes the runtime inputs and writes automated rollouts, reports and
an `unaccepted` actor checkpoint. Diagnostic initialization is synthetic and
cannot pass a pilot quality gate. The owner starts its deadline before launching
uv/Python, charges imports, BC, device warmup and Paper boot to the same window,
and kills the worker's private process group at that deadline, including Python
children of uv. The running watchdog uses a monotonic timer; SIGINT/SIGTERM
also cancel that owned group. The worker reserves 15 seconds within
the window to serialize its final actor; server cleanup may finish afterward.
Every owned Paper session retains `server.log` in its map output before removing
the container, including headless diagnostic failures. A failed command stops
the worker; retained logs are for investigation and do not authorize a retry.

The three-seed pilot initializes BC independently from the same human dataset
and runs each seed for at most eight hours, sequentially. It freezes the trainer
sources, uv lock, curriculum, runtime and all dataset split hashes. Run from this
package with freshly built plugin and fixture jars:

```bash
bun run bots:pilot --dataset .cache/rwf-dataset --device mps --seeds 17,18,19 --output .cache/rwf-pilot/trooper
bun run bots:pilot --resume --output .cache/rwf-pilot/trooper
bun run bots:pilot --diagnostic --device cpu --seeds 17000,17001,17002 --output .cache/rwf-pilot/diagnostic
```

The curriculum in `tools/learning/curriculum.json` allocates the remaining PPO
window to stationary targets (10%), chase/strafe (15%), authored styles (35%),
then historical opponents (40%). Each phase must complete its minimum updates
before advancing, so slow boot or training cannot skip a phase. A snapshot is
frozen at BC initialization, each phase transition and every 25 updates.
Historical matches sample the BC anchor plus the latest fifteen snapshots,
using the same frozen opponent for each red/blue pair. Its weights are loaded
with strict hash checks and disabled gradients; its memory resets each duel.
Both policies receive only their own 34 fair features. Skipped observations
continue to censor the entire duel.

Immutable, fsynced seed claims and results record the original deadline and
final actor hashes. Concurrent owners cannot claim the same seed. `--resume`
continues only pending seeds after orderly frozen results, using the exact
recorded inputs; it verifies previously frozen artifacts and never renews a
claimed seed's window. A running, interrupted or failed seed stops the pilot
for repair. Failure does not automatically retry training or start more seeds.
The diagnostic preset instead allows three 300-second windows and seven updates
per seed, exercising every opponent and phase with synthetic initialization.

Finishing training only freezes candidates. The runner reports `unaccepted`
and `pilotAcceptanceChecked: false`; frozen combat gates and blind human
comparisons are separate acceptance work. It does not enable learned control
in ordinary matches.

Frozen strength evaluation runs every sealed pilot actor against the same
native runtime and frozen authored/basic opponents:

```bash
bun run bots:evaluate --pilot .cache/rwf-pilot/trooper --device cpu --output .cache/rwf-evaluation/trooper
bun run bots:evaluate --diagnostic --checkpoint .cache/rwf-ppo/diagnostic/learning/final --device cpu --output .cache/rwf-evaluation/diagnostic
```

`tools/learning/evaluation.json` fixes 200 games per opponent for each of the
three seeds, paired red/blue at 100 fresh environment seeds. Each actor needs
120 wins against authored and 160 against basic; draws and 60-second timeouts
count as non-wins. Checkpoint hashes, original dataset hashes and native runtime
must match the sealed pilot. Evaluation freezes its own tooling and verifies
those inputs before and after each actor. Evaluation seeds cannot overlap that
actor's training games. There are no optimizer steps or outcome-dependent
retries. A fsynced claim prevents automatic repetition of an interrupted or
failed pilot evaluation. Investigate such a run before any recovery.

Unlike PPO collection, the evaluator keeps a duel's result when ticks are
missed. It resets memory at observation gaps, records rejected actions and
authored fallback counts, and fails the run on an interrupted duel instead of
selecting a replacement. `games.jsonl` is flushed and fsynced after each result;
native recordings are exported beside each seed's report. Each evaluation
worker has an eight-hour hard window including startup; diagnostics have five
minutes and only two games per opponent (`--matches 4` allows four). Diagnostic
results cannot pass the gates. A completed failed real strength gate exits 1
after cleanup and report export. Passing strength leaves the model unaccepted:
blind preference, Java inference parity and production-shape load verification
are separate requirements. No evaluation command enables ordinary learned play.
Console-transport results include authored fallbacks, so inspect their counts
when assessing the controller; they do not establish sustained Java inference
or its two-tick delivery gate.

Blind preference reviews use a separate fixed capture schedule and a sealed
ballot. They compare the first sealed pilot seed against authored combat;
all three pilot seeds must first pass both strength gates. No seed is selected
by evaluation score. Genuine dataset files, checkpoint hashes, the original
claimed strength run and native runtime inputs are verified before preparation.

```bash
bun run bots:preference schedule --pilot .cache/rwf-pilot/trooper --evaluation .cache/rwf-evaluation/trooper --model .cache/rwf-pilot/trooper/seed-0/onnx
bun run bots:collect-preference --pilot .cache/rwf-pilot/trooper --evaluation .cache/rwf-evaluation/trooper --model .cache/rwf-pilot/trooper/seed-0/onnx --output .cache/rwf-preference/capture
bun run bots:preference prepare --pilot .cache/rwf-pilot/trooper --evaluation .cache/rwf-evaluation/trooper --model .cache/rwf-pilot/trooper/seed-0/onnx --clips .cache/rwf-preference/capture/captures.json --output .cache/rwf-preference/review
bun run bots:preference score --pilot .cache/rwf-pilot/trooper --output .cache/rwf-preference/review --answers .cache/rwf-preference/review/public/answers.json
bun run bots:preference verify --pilot .cache/rwf-pilot/trooper --output .cache/rwf-preference/review
bun run test:preference-media
```

`schedule` prints the exact twenty paired red/blue matchups at fresh environment
seeds and the candidate/runtime fingerprints. `collect-preference` verifies genuine
pilot eligibility, builds and fingerprints the native inputs, and seals one
exclusive capture claim in the pilot before allocating a disposable server.
Diagnostic pilots are refused. An interrupted or failed collection keeps its
claim and original evidence; the command has no resume or reroll option.

The collector stages and warms the exact actor through `rwfinfer load`, attaches
one native spectator, and records each scheduled learned/authored matchup once
against the authored opponent. All forty matches use the same camera, FOV and
resolution, with HUD and nameplates hidden. Each 1280x720, 30-fps clip covers the
first 600 live ticks, holding the original terminal render if combat ends early.
Losses and early endings remain. The recorder waits for the lobby between matches
and retains the full terminal outcome even when it occurs after the clip.

Before either fighter acts, the fixture samples an original setup receipt from
Paper: roster join order, personalities, fresh body identities, team, kit, spawn,
facing, velocity, health, held slot and world lighting. The neutral
`rwf-duel-setup.json` contract fixes the spawn and equipment requirements; paired
receipts must agree except for fresh identities and absolute world ticks. Each
completed match envelope is sealed before the next match starts. After shutdown,
the collector validates every exported schema-3 recording's actual domain seed
against its scheduled controller seed, checks that model/runtime/renderer inputs
stayed unchanged, and seals `captures.json` and `verification.json`.

Preparation requires this claimed collection and rechecks the setup receipts,
separate full-match clocks, every original PNG, encoded streams, recordings,
delivery accounting and frozen inputs before creating the blind pack. Hand-written
capture declarations or diagnostic pair outputs cannot substitute for it.

The Java-model sandbox can own a native spectator and record a diagnostic pair:

```bash
bun run bots:java-video --model .cache/rwf-pilot/trooper/seed-0/onnx --output .cache/rwf-java-video/trooper
bun run bots:java-video --model .cache/rwf-pilot/trooper/seed-0/onnx --opponent authored --output .cache/rwf-java-video/trooper-authored
```

This command stages and warms that exact unaccepted export, attaches one native
client to the same disposable Paper instance, and runs a separate warm-up duel
before recording one Java-controlled and one authored match against the basic
opponent (or `--opponent authored`) at a common controller and domain seed. It
uses the same pair recorder and setup checks as the twenty-pair collector.
The guarded seeded showcase port
requires the exact empty lobby, preserves its identity and map, and settles the
seeded world time before countdown. This also fixes team tie-breaks for the stable
bot join order. Wall-clock timing and asynchronous inference can still change the
combat trajectory. Every match runs once. Losses and early terminal
frames remain in the evidence. `inputs.json` hashes the actor, model manifest,
native environment, renderer sources, compiled client classes, resources and
client artifact before capture; the command checks those inputs again afterward.
Each schema-3 native frame uses the latest received Paper marker for its world
tick and retains the sampled client game clock separately as `clientWorldTick`.
Client clock corrections therefore remain visible without being mistaken for
a reversed authoritative duel clock. Frame clocks must exactly equal their
received markers; native monotonicity, missing-tick, pixel and camera gates remain.
Older schema-2 native receipts are rejected by the current encoder.
Each clip retains its frame receipt, separate full-match clock, original terminal
state and Java delivery metrics. After graceful shutdown, it validates and hashes
the original complete schema-3 bot-only Trooper recordings, including checking
that each header's domain seed equals its requested controller seed. The native
fingerprint includes the shipped personality YAML as well as map and kit inputs.
Observer cleanup runs
before Paper stops and exports recordings, including when capture fails.

`verification.json` is model-specific diagnostic evidence. It does not establish
genuine pilot eligibility or collect the twenty authored-opponent review pairs,
score a human ballot, accept the model or enable ordinary learned play. The same
owned observer and recorder are available to the fixed-schedule collector.

The native timing bridge is exercised independently of training or voting:

```bash
bun run client preview --rwf-duel --verify-duel-clock
```

To verify a full window that remains live through tick 599:

```bash
bun run bots:verify-live-window --output .cache/rwf-native-window/full-live
```

This diagnostic exports a fixed, unaccepted jump-in-place actor with attack
disabled, verifies recurrent CPU ONNX parity, and stages it in Java against the
fixture's stationary opponent. No training or demonstration data is used. After
a separate warm-up match, the command records 900 native live frames with zero
held frames, waits for the ordinary 1200-tick fixture timeout, and checks that
the separate full clock extends the recorded prefix. It requires sustained Java
action application, zero damage and changing original pixels. Setup, model,
runtime and renderer digests, frame/full-clock receipts, delivery metrics, the
encoded stream and complete original recording remain in the exclusive output.
`verification.json` records the measured live/terminal bounds. Failures preserve
the output and a failure receipt; no automatic retry occurs. This verifies the
timing and recording component, with a diagnostic actor that cannot establish
pilot strength, human preference or model acceptance.

The disposable fixture's console-only `rwfcapture observe <uuid>` admits a
connected native spectator outside the duel roster. `rwflearn` sends a begin
marker, one marker before bot actions each live tick, and a terminal marker
even when combat ends midway through a tick. The shared pure Java codec lives
in the client's `wire` package and is compiled into the fixture jar; it is
absent from `TheStorm.jar`. `storm-duel-clock.json` fixes its byte layout,
enums, bounds, receipt fields and golden packet.

The session actions `duel-arm`, `duel-status`, `duel-seal` and `duel-cancel`
retain a bounded clock journal. Arm with `name`, `seed`, `side`, `mode` and
`opponent` before starting the duel. Sealing writes an exclusive JSON receipt
off the client thread. Missing ticks, stale match identities, reversed clocks
or an invalid observer invalidate the journal. A lost observer does not stop
the bots. Verification retains native outcomes, cancellation and invalidation
receipts plus a live screenshot in the session artifact directory. Clock
receipts remain unaccepted evidence. The framebuffer recorder binds pixels to
the clock with `video-duel-arm`. Its arguments are `name`, `fov`, `seed`, `side`,
`mode` and `opponent`; the native window always contains 900 frames. Wait for
`video-ready` before arming, then for `video-status` to report `READY` before
starting the server duel. The first live payload anchors frame zero;
`video-start` is refused for native captures. Readiness includes the client
overlay and render rate, since entering a world can leave an overlay active
after the position and screen status have updated.

```bash
bun run client preview --rwf-duel --verify-duel-video
```

Schema-3 `rwf-rendered-duel-frames` receipts retain the original camera, frame
timestamps, pixel hashes, received native clock and each frame's current
marker and source-image index. Every live slot uses a separate framebuffer
readback. After an early native terminal event, one original terminal render
is copied for subsequent slots, with identical hashes and explicit source
indices. Missing slots, interrupted duels, stale markers, late first frames
and windows that fail to reach native tick 599 fail validation. A full window
may finish before the match; its clock prefix does not prove a terminal
outcome. The separate complete duel journal retains that outcome.

`video-encode` verifies both receipt versions, original PNG hashes and the
encoded 1280x720, 30-fps, silent stream without overwriting evidence. The
recorder uses a private lossless PNG writer with fast Deflate compression;
two encoder workers share an eight-image backlog and seal the manifest in
original frame order. Channel order, alpha and rows are preserved, and the
backlog limit still fails on overload. It does not change Minecraft's global
encoder settings.
The native video check first runs a separate unrecorded warm-up duel to initialize Paper
combat code and client entity rendering, then records one authored/basic duel.
It retains the warm-up identity, the recorded match's separate clock and
an early terminal hold in a 30-second clip. Its output remains diagnostic,
unaccepted footage; it does not establish candidate strength or human
preference, train a policy, or enable learned play.

The strict `CaptureSet` schema in `tools/learning/preference/gate.ts` defines
`captures.json`: candidate/runtime digests, zero retries, the shared camera and
twenty ordered pairs. Each pair's `learned` and `authored` entries have video and
recording paths plus the terminal `rwflearn state` reply. Learned entries also
include the `rwfinfer metrics` reply's `metrics` object; authored entries use
`metrics: null`. Paths resolve relative to `captures.json`. Learned delivery
counts must match the terminal state. Complete schema-3 bot-only Trooper duels,
unique match identities, common terrain and recorded outcomes are checked.
The original recording header's domain seed must equal the controller's fixture
seed; preparation checks both independently.

Preparation claims the pilot once, freezes all source artifacts and review tools,
and seals randomized A/B labels before publishing footage. `ffmpeg` and `ffprobe`
must be installed, including H.264 encoding support. The pack re-encodes videos,
removes audio, tags, chapters and extra streams, and validates frame count and
format. Reused normalized clips fail. Give the reviewer only `public/`, keeping
plans, native evidence and the answer key private. The reviewer watches A and B
for the indicated red or blue fighter and fills every choice with `A`, `B` or
`tie`, with optional reasons, without reading the private key.

Scoring verifies all frozen inputs and public clip hashes, then seals one
completed manual ballot. Fifteen of twenty votes must prefer learned behavior;
ties and authored votes stay in the denominator. Partial, repeated or reordered
ballots fail. An interrupted pack or completed review cannot automatically be
rerolled. `preference-result.json` binds the result to the actor, pack, plan,
answer key and ballot. This measures a preference for humanlike behavior,
not indistinguishability from a human. Passing leaves the actor `unaccepted`
with ordinary learned control disabled; promotion and the other gates remain
separate.

`verify` rereads the original sealed ballot and recomputes every vote. It checks
the frozen source files, pack, answer key, labels, all forty public clips and the
exact stored result, retaining their hashes for promotion. Repeated verification
does not write or consume evidence. A complete failed review still exits with
status 1; missing, interrupted or changed evidence fails explicitly.

Java inference diagnostics load a frozen, unaccepted ONNX export only in the
disposable fixture server:

```bash
uv run --project tools/learning --locked python tools/learning/java_parity.py --checkpoint .cache/rwf-ppo/diagnostic/learning/final --output .cache/rwf-java-parity/diagnostic
mise exec -- gradle -p plugin :rwfbots:actorParity -PactorParityDirectory="$PWD/.cache/rwf-java-parity/diagnostic"
bun run bots:verify-java --model .cache/rwf-java-parity/diagnostic/onnx --output .cache/rwf-java-native/diagnostic
```

The parity command independently carries Java hidden and cell state through
16 steps at batch sizes 1, 3, 20 and 100 against Python expectations. For an
existing candidate, verify its exact ONNX bytes without re-exporting:

```bash
uv run --directory tools/learning --locked python -m promotion.parity --checkpoint "$PWD/.cache/rwf-ppo/diagnostic/learning/final" --actor "$PWD/.cache/rwf-java-parity/diagnostic/onnx" --output "$PWD/.cache/rwf-java-parity/exact-candidate"
mise exec -- gradle -p plugin :rwfbots:actorParity -PactorParityDirectory="$PWD/.cache/rwf-java-parity/exact-candidate" -PactorParityReceipt="$PWD/.cache/rwf-java-parity/exact-candidate/java-receipt.json"
```

Preparation copies the candidate bytes, checks the full export metadata against
the checkpoint, and compares Python and CPU ONNX Runtime with independent
recurrent state. Java rejects mismatched artifact bindings, missing cases,
unknown fields and inaccurate outputs. The versioned `rwf-actor-parity.json`
contract fixes the replay batches, steps and elementwise tolerances. The
exclusive receipt binds the actor, export manifest, checkpoint, weights,
observation contract and sample file by SHA-256. It leaves the model unaccepted;
strength, blind preference, native load and regression gates are still required.

Accepted Java loading requires an additional `promotion_sha256` field and its
matching `promotion.json`. The versioned `rwf-actor-promotion.json` resource fixes
the gate thresholds and proof field inventory. `source-manifest.json` retains
the original unaccepted export bytes; the accepted manifest may change only its
acceptance label and add the promotion fingerprint. All evidence is portable:
each catalogue entry has the relative name `evidence/<sha256>.blob`. Loading
checks every checksum, requires every referenced artifact, and rejects symlinks,
unknown proof fields and missing evidence before opening a native session.

The runtime checks all three original eight-hour seed budgets, the first sealed
candidate, 200 matches against each opponent, the sealed twenty-pair human
ballot, the exact Java parity receipt, the 20/50/100-body load windows, and the
required regression inventory and advancement floors. It recounts strength
outcomes and blind votes and rebuilds load coverage, timing and delivery from
the original command stream. Evidence remains unaccepted until assembled into
a complete bundle. These checks protect artifact integrity and enforce the
fixed gates; genuine human recordings and votes must come from the recording
and review workflows above.

Java promotion bundles the neutral training-map and strength-evaluation
contracts from `tools/learning`. It requires version-2 strength evidence and
the same sorted map identities, terrain hashes and scenario hashes in the
pilot inputs, every trained checkpoint, the evaluation plan and every duel.
Every admitted map must fit the paired 200-game schedule; omitted maps and
changed, repeated or reordered games fail validation. Report fields are checked
against the neutral inventory before native actor allocation. Java's schedule
is tested against independently generated Python expectations across 32 maps.

`bots:promote` assembles the original passing evidence into a new local bundle:

```bash
bun run bots:promote --pilot .cache/rwf-pilot/trooper --evaluation .cache/rwf-evaluation/trooper --model .cache/rwf-pilot/trooper/seed-0/onnx --review .cache/rwf-preference/review --parity .cache/rwf-java-parity/exact-candidate --receipt .cache/rwf-java-parity/exact-candidate/java-receipt.json --load .cache/rwf-java-load/trooper --regressions .cache/rwf-regressions/trooper/regressions.json --output .cache/rwf-accepted/trooper
```

Collect the required regression inventory into one fresh directory:

```bash
bun run bots:collect-regressions --model .cache/rwf-pilot/trooper/seed-0/onnx --output .cache/rwf-regressions/trooper
```

This runs all seven fixed cases sequentially on the same frozen actor, native,
renderer and Java simulation inputs. Each native case owns a disposable Paper
server and original recording. The collector retains failed attempts and stops
at the first failure; it never retries or borrows a successful case from another
attempt. The output stays unaccepted and leaves learned control disabled.

`--regressions` must name the collector's original `regressions.json` suite.
Promotion replays every original native command, recording and simulation tick,
checks abort settlement against the saved SQLite database, checks healing against
authored personality content, and reapplies the unchanged advancement floors.
It verifies receipt and runtime hashes and archives the original evidence. The
separate `measured-regressions.json` contains independently derived aggregates in
the existing neutral Java promotion format; aggregate-only input cannot pass.
The suite supplies one check per complete case with no failures or skipped cases.
Unit fixtures and diagnostic pilots cannot establish model acceptance.

Disposable regression fixtures can bind a controller with
`CombatHarness.attachAuthored(botSlots, controller)`. This binds the next exact
draft once and leaves ordinary personality selection, kit plans, difficulty,
match-derived randomness, late arrivals, healing habits, governor thinning and
rating settlement in place. Reflex inputs remain authored; the attachment owns
the body-command hook and receives fair observations. Its successor match is
unaffected. Ordinary accepted-model inference does not start while a fixture
owns that hook. Controlled duel and load attachments retain their fixed Trooper
rosters and experiment seeds. An attachment alone supplies no regression proof;
acceptance still requires the complete measured evidence above.

To exercise the authored attachment's native journal with an unaccepted export:

```bash
bun run bots:verify-regression-capture --model .cache/rwf-java-parity/exact-candidate/onnx --output .cache/rwf-regression-capture/diagnostic
```

One disposable Paper server loads and warms that exact Java actor, arms the
`native-team-advancement` case once, and runs a normal sixteen-bot showcase to its
original ending. Only eligible Trooper sword controls use the actor; other kits,
aim and item actions remain authored. The console-only fixture retains every
selected command and action context, native tick/batch, match transition and
actual before/after damage measurement in a bounded journal. Sampling drains
are fsynced to `commands.jsonl` before the next request. The verifier recounts
every row, checks body/life/kit/tick eligibility and two-tick action age, rebuilds
the selected controls with their original authored target identity, and checks
authored fallbacks and original batch totals.

The original console requests are bracketed by journal checkpoints. The complete
recording must match every native body's test pseudonym, team and kit, keep each
living body's two-tick frame cadence, and match the native normal ending. Both
teams must meet the existing spacing, width at eight seconds and contact,
ten-second advancement, and winding floors. The verifier rejects incomplete
trajectories and fails on any missed floor.

The ticker checks the rules' current fighting roster before each body acts. A
body killed by an earlier command in the same tick cannot act from the old world
snapshot, even when the match continues for its teammates.

The exclusive output keeps model/runtime/renderer fingerprints, the complete
schema-3 recording and measured team trajectories. Failure preserves the attempt;
there is no automatic retry. `verification.json` explicitly records diagnostic
scope and supplies no seven-case regression pass or promotion input. Acceptance
requires the full regression inventory, native combat checks and simulation
floors above; this command does not train, accept a model or enable rollout.

The authored simulation advancement regression has its own original-evidence
capture:

```bash
bun run bots:verify-simulation-floors --model .cache/rwf-java-parity/exact-candidate/onnx --output .cache/rwf-regression-capture/simulation-floors
```

The offline Java producer runs the same 16 strategy pairings, fixed seeds and
measurement windows as `AdvanceTest` on the shipped training yard. Its exclusive,
fsynced `simulation.jsonl` retains every tick's body identity, kit, position,
liveness, attack targets and slot, plus the original Java measurements. The
TypeScript verifier replays those ticks independently, requires agreement with
Java, and applies the unchanged simulation width, attacking-team advancement and
winding floors. It preserves anchor exclusions and the existing median convention.
Missing ticks, changed pairings or seeds, incomplete cases and aggregate-only
claims cannot pass. Actor/native inputs, the actual Java classpath and producer
sources are fingerprinted before and after capture; failures retain the attempt
without an automatic retry. These authored simulation records are regression
evidence only. They supply no demonstrations, training data, native combat proof
or model acceptance; training continues to use real Paper interactions.

To verify Java-controlled sword damage against a player entering through
`/rwf join`, use a separate fresh diagnostic directory:

```bash
bun run bots:verify-human-combat --model .cache/rwf-java-parity/exact-candidate/onnx --output .cache/rwf-regression-capture/human-combat
```

The automated network player joins normally. The fixture picks Trooper kits
through the lobby API during a five-second countdown and offers the player to a
living enemy at 1.75 blocks. It retains native game mode, immunity, health and
contact probes. A pass requires actual health loss from an applied Java sword
command targeting that exact player in the same native tick. It keeps the player
connected through the original match ending, drains inference and replays the
whole journal. The version-2 journal includes target UUIDs and player probes;
older journals fail its contract check. The original schema-3 recording must
contain one player and incomplete (`MISSING`) control provenance from this
automated client, so it cannot supply human demonstrations. This command covers
the player-damage diagnostic only and produces no accepted model or rollout.

To verify the last joined player disconnecting, use another fresh directory:

```bash
bun run bots:verify-last-human-abort --model .cache/rwf-java-parity/exact-candidate/onnx --output .cache/rwf-regression-capture/last-human-abort
```

The automated player starts the same ordinary eight-Trooper match and disconnects
after Java controls have been applied. Original transitions must show the last
player leaving and a winnerless Stop within 120 native ticks; the original log
must confirm the configured five-second grace period. Native entity queries are bracketed by journal
checkpoints: all eight bodies must exist before disconnect and be absent after
the lobby returns. The output retains the original server log, complete stopped
recording, and a private SQLite snapshot. Requerying that database must show a
STOPPED player with no credits owed or paid. This diagnostic supplies no human
demonstrations, complete regression acceptance or rollout.

To challenge a real spectator client in a normal sixteen-bot showcase:

```bash
bun run bots:verify-spectator-immunity --model .cache/rwf-java-parity/exact-candidate/onnx --output .cache/rwf-regression-capture/spectator-immunity
```

The automated client uses `/rwf spectate` and is placed next to a living Trooper.
Three native player-attack damage requests must leave its full health unchanged.
A positive control against an opposing fighter must lose health through the same
native damage path, with the exact original damage event inside the command's
journal checkpoints. Minecraft's damage command can report invulnerability even
when Red Warfare cancels vanilla damage and applies its own damage; the verifier
therefore requires measured health and events. It retains raw console responses,
checks that bots never target the watcher, and verifies native spectator mode
and full health through the original normal match ending. The original recording
must contain only the sixteen bots and no human inputs. This diagnostic neither
supplies demonstrations nor establishes the complete regression acceptance gate.

To verify authored healing and ephemeral bot cleanup in another original showcase:

```bash
bun run bots:verify-healing-lifecycle --model .cache/rwf-java-parity/exact-candidate/onnx --output .cache/rwf-regression-capture/healing-lifecycle
```

The producer selects the first eligible Trooper from the ordinary sixteen-bot
draft and its frozen personality content, respecting `never_eats` and
`gapple_hoarder`. Native damage must reduce its health from twenty to eight;
authored item use must consume one of three apples, restore health and grant
four absorption points. Original controls must preserve the full eating interval
without a learned action replacing item use. After Java controls have applied,
the console-only fixture stops that exact match through the existing match API.
Every original body must disappear after the lobby returns. Forced Citizens saves,
registry queries and the retained empty `saves.yml` prove that ephemeral bots did
not enter the persistent NPC registry. The verifier retains and replays the
original journal and stopped all-bot recording. This diagnostic supplies no human
demonstrations, complete regression acceptance or rollout.

To verify native line-of-sight rejection and knockback:

```bash
bun run bots:verify-native-melee --model .cache/rwf-java-parity/exact-candidate/onnx --output .cache/rwf-regression-capture/native-melee
```

The producer selects two opposing Troopers from an ordinary sixteen-bot draft.
Two console-only trials place those same original bodies in melee reach. A
temporary two-block stone wall must produce `NO_LINE_OF_SIGHT` with unchanged
health and velocity. With that wall removed, the actual melee API must reduce
health and apply the rules' horizontal and upward knockback. Each trial restores
the original air blocks before returning, retains native body snapshots and is
bracketed by the original journal. The replay matches the clear hit's exact
damage event and velocity, then independently requires a landed applied Java
sword command with native knockback outside either direct trial. It preserves the
original normal ending and all-bot recording. The shared melee probe contract has
Java and TypeScript validators and enters the frozen input fingerprint. This is
an automated diagnostic; it produces no human demonstrations, accepted policy or
complete regression acceptance.

The producer verifies the sealed pilot and human ballot, recounts the original
strength outcomes, recomputes the full raw load stream, and replays the original
parity samples against the frozen Python weights and exact CPU ONNX export.
Java then checks the portable bundle and repeats the original JNI receipt before
exclusively writing the accepted `manifest.json` and `promotion-result.json`.
`source-manifest.json` retains the unaccepted export; `collection.json` records
the original paths and hashes. Evidence blobs are streamed and deduplicated by
checksum. Source changes, missing evidence, failed gates and existing output
directories fail explicitly. A failed assembly can leave a draft for inspection;
use a new output directory after correcting the cause.

This command only assembles local artifacts. It keeps learned control disabled
and does not publish, deploy, train, collect new votes or extend a pilot budget.
For a read-only numerical recheck of existing sealed samples, use
`promotion.parity --verify-samples <samples.json>` with the original
`--checkpoint` and `--actor` directories instead of `--output`.

The native
diagnostic runs both sides against authored and basic opponents with no Python
action transport. It freezes artifact and runtime hashes, retains every result,
exports native recordings and checks action accounting. Its counters distinguish
unavailable actions from authored-only behavior such as healing.
Expired results and results for retired match/body contexts have separate
counters. Deadline counters include every observed completion, including retired
contexts, so a lifecycle rejection cannot conceal a missed deadline.

Native inference load diagnostics use every shipped module and verify Docker's
four-CPU cap, 8G heap setting and 10Gi memory limit:

```bash
mise exec -- gradle -p plugin :dist:shadowJar :dist:fixturesJar :companions:e2eJar
bun run bots:verify-java-load --model .cache/rwf-java-parity/diagnostic/onnx --output .cache/rwf-java-load/diagnostic
```

The fixture's versioned wire contract is `rwf-inference-load.json` in the rwfbots
resources. Java validates its record fields and each reply; TypeScript validates
the same field inventory and parses replies strictly. A missing or incompatible
contract stops the diagnostics.

The frozen protocol in `tools/learning/load-gate.ts` measures a 90-second baseline,
then 20, 50 and 100 real Troopers for at least 3,000 live ticks per phase. Each
phase also requires 200 ticks with the entire roster alive and observed. Normal
deaths and match endings remain active; successor matches restore the roster
within a fixed budget, and every measured tick and match is retained. Authored
navigation, aim, healing and abilities continue to run; eligible sword controls
use Java inference. The diagnostic harness drives all bodies at 20 Hz without
governor thinning or habit perturbations, so this is a capacity check for that
controller rather than a normal-match rollout test.

Paper tick-end events supply individual server durations. The overall, live and
full-roster populations must each have p95 below 50 ms. At least 99% of attempted
body inferences must be observed within two ticks; skipped, rejected and final
pending requests count against that fraction. Action age, full-batch size and
native damage are also checked. `samples.jsonl`, `phases.json`, recordings and
`verification.json` retain the evidence and input hashes. These bars supplement
the existing authored load tests and gameplay floors; they do not replace them.

Before writing its final report, the load runner reconstructs baseline and phase
windows from every raw command reply. The declared tick arrays, match schedules
and before/after counters must match that complete stream. Missing or duplicated
ticks, foreign or oversized body populations, counter resets and pending work at
the start of a window fail. Slow ticks, deaths, skipped requests and requests
pending at the final boundary stay in their original denominators. This checks
the load evidence; it does not accept an actor or establish normal-match behavior.

The compute pool loads and warms native sessions and processes at most one
immutable observation batch in flight. Busy ticks are skipped rather than queued.
Main-thread delivery checks match, body, life, kit and a maximum two-tick age;
observation gaps and identity changes reset recurrent memory. Shutdown closes
native sessions after pending inference without submitting new work after the
pool closes. Corrupt metadata and model failures surface as errors. Ordinary
matches use authored control by default; these diagnostics do not accept a model
or establish the human preference gate. The separate load command checks runtime capacity without
accepting the model or enabling ordinary learned play.

The independent learning gate is documented in the feature flags reference above.
Its accepted ONNX bundle must ship with the server image after the human pilot
and all promotion gates pass. Missing Flipt
bootstrap and transport outages keep that match authored. A successful false
answer is final for the match; malformed values, missing declared flags and
authorization failures surface as errors.

When enabled, the module loads one accepted bundle from
`rwfbots/learning/accepted/trooper` beneath TheStorm's data folder and validates
and warms it on the compute pool. Loading remains asynchronous; late flag and
load completions cannot enable a finished match or its successor. Only Trooper
combat movement and attack timing use the learned actions. Normal drafting,
difficulty levers, habits, kits, healing, abilities, navigation, objectives,
governor thinning and personality ratings retain their authored paths. Prepared
and committed jumps, climbs, swimming, drops and objective or escape routes
keep authored control even when an enemy is visible. Optional learned footwork
must pass the same terrain checks; jump checks cover arbitrary later steering
within the supported landing envelope. Unsafe tickets remain unapplied and
count as ineligible rather than being silently altered. Skipped
body ticks reset recurrent memory; idle ticks drain retired inference completions.
Diagnostic attachments remain separate and never evaluate this rollout flag.
An enabled flag requires the accepted asset. Exceptional or cancelled flag/model
futures report their cause once and leave learning in `FAILED` for that match.
The failed future is retired so subsequent authored bot ticks continue; the
match does not retry the load. `/rwfbots debug learning` reports match state, action availability,
authored-only ticks, pending startup, flag outages, load rejections and inference
deadline, lifecycle and batch counters. The flag change does not publish or
install an artifact.

Payouts are Red Warfare credits (the economy's `rwf_credits`), at the
original scale: 3 for a win and 1 for a loss, scaled by the human share of the
roster, for any match at least `minMatchLength` long. There is no daily cap:
it protected the crystal economy, and credits are a separate currency. A
suicide or a quit (a disconnect or `/rwf leave`) while the match is live
forfeits the reward. Red Warfare's AFK rule applies: every combatant is AFK
when the match goes live until their whole-degree yaw or pitch changes while
alive (`AfkWatch`); a human still AFK at the end earns nothing and is charged
2 credits, never more than they hold, and a forfeit clears the mark.

Payouts and charges go through an outbox in `rwf_match_player` and the
economy's keyed transfers (`rwf:<matchId>:<uuid>`), so a crash between the
match ending and the transfer moves money exactly once on the next enable; a
charge is found by its key before anything more is taken. Each row names the
currency it settles in, so rows written before Red Warfare had its own
currency still settle in crystals. Bots are never paid.

Bots are optional: the module declares the `BotRoster` port and looks it up
when a countdown starts; the `rwfbots` module provides it. Bots act only
through the `CombatantActions` port, which validates reach, line of sight and
the hit window as it would for a human before acting through the server API.
`MatchView` and `MatchEvents` publish the read model and transitions; other
modules read them through the flattened `rwf.app.view` records (`MatchState`,
`Transition`) and act through `rwf.app.BotActions`, so nothing outside rwf
names an `rwf.domain` type. A bot provider implements `rwf.app.BotBodies` and
publishes `BotRoster.of(bodies)`.

### Lobby

Joining, the countdown and a death before the start all put a
player at the lobby spawn; anyone who leaves the room before the start (by
falling out of it, say) is put back. Nothing hurts there and nothing can be
broken. Display entities dress it, because the schematic carries no block
entities: the rules in front of the north wall, a live match board (map,
players and bots, and the wait or the countdown) in front of the south wall,
in each kit alcove the kit's menu icon with its name and summary, and on the
armory's rotation wall this week's four free kits, one per slot, while the kit
shop is on for anyone present (the wall changes with the week). They are
tagged, never saved with the world, swept and respawned when the lobby opens
and removed on disable, so none is ever duplicated. A boss bar shared by the
humans waiting says how many more players the match needs or counts it down,
the last five seconds and the start show as titles, and the bar goes when the
match goes live, ends, or the player leaves.

Every human in the lobby carries two items: a nether star ("Choose kit") in
the last hotbar slot and red dye ("Leave match") beside it, given on entering
and again after every pick, since equipping empties the inventory. Both are
kit items, so they never leave the match, and the start's equip takes them
away. Right-clicking the star opens `KitMenu`, a read-only 27-slot chest with
one icon per shipped kit (the picked one glints); a click picks that kit
through the same `MatchEvent.PickKit` path as `/rwf kit` and closes the menu.
Every click and drag while it is open is cancelled, members may open no other
container, and the menu closes when the match goes live or the player leaves.
The dye leaves through the `/rwf leave` path.

### Watch a bot match locally

`bun run rwf:watch` boots a disposable Paper server in Docker with every
shipped module plus `rwf` and `rwfbots`, Citizens and its owned config, the
void `rwf` world and a stand-in for Flipt that opens `/rwf` to everyone. It
publishes the game port on `127.0.0.1:25565` (offline mode) and runs until
Ctrl-C, which removes the container. Build the jar first.

```bash
bunx turbo run build --filter=@shepherdjerred/the-storm
cd packages/the-storm
bun run rwf:watch --op <your-name>     # --port <n> to use another port
```

Join `localhost` with a 26.2 client, then:

1. `/rwf admin showcase 8` starts a bots-only match after a 15 s countdown.
2. `/rwf spectate` puts you at the spectator point.
3. `/rwf spectate next` follows the next living bot; repeat to cycle.
4. `/rwf leave` gives your belongings back; `/rwfbots debug` shows the plans.

## Search and Destroy bots (rwfbots)

The `rwfbots` module fills rwf matches with Citizens player NPCs driven by a
pure perception, tactics, team and reflex stack (`rwfbots.domain`). It needs
the Citizens plugin (pinned in `server/plugins.json` and required by
TheStorm's `paper-plugin.yml`) and enables after rwf.

Threading. The main thread runs one 1-tick task (`BotTicker`): it captures a
`WorldSnapshot` from rwf's read model and the live entities (position,
velocity from the tick before, look, health, absorption, armor, held slot,
sprinting, on ground, using an item, invisible, last hurt, bombs, poison, and
the tick's hits, bow shots, eating, fuse clicks and footsteps), publishes it
to the `ThinkLoop`, reads the newest `DecisionBoard`, runs each bot's
`Reflex.tick` and applies the `BodyCommand`s to its body. The `ThinkLoop`
keeps two one-slot mailboxes (`AtomicReference`): the newest snapshot
replaces one not yet consumed, and a CAS flag ensures at most one thinking cycle
runs on core's `ComputePool`. Each cycle uses bounded parallel perception,
team planning, and tactics stages. Asynchronous barriers merge results in stable
order without blocking pool workers. Tactics reads frozen team boards; an ordered
merge resolves competing cover claims before publishing decisions. Search scratch
arrays are reused exclusively by each batch and released when the match retires.
Within tactics, each bounded job claims the next unstarted input when it finishes
its current proposal, keeping its own search scratch arrays throughout. Results
return to original input order before the commit barrier. A failed or rejected
job still waits for every submitted sibling before the cycle can fail or retire;
other jobs may finish more remaining inputs than the fixed partition would have.
The other parallel stages retain their fixed partitions.
Each immutable snapshot indexes combatants by ID while preserving roster order,
so repeated enemy lookups do not scan the entire lobby.
Role assignment prepares all teams before flattening their distinct source-node
distance rows into one parallel batch. Scoring follows the original bot and slot
order after the distance barrier, preserving assignments and random draw order.
Before publishing a retake plan, a separate parallel stage checks its two fuse
workers with their actual planner, health, movement capabilities and perception.
Each team step permits at most four planner evaluations, rotating through
replacement candidates across steps. An uncertified worker becomes a reserve;
screens wait for certified workers rather than all crowding the fuse. Changes to
an admitted worker's health, movement state or temporary protection trigger an
earlier check. Search scratch belongs exclusively to each batch, and Flight
Recorder spans expose both stage and individual route costs. This query-count
bound does not establish a latency bound; capacity tests still judge the entire
thinking cycle.
Role distances stop at the scoring cap of 128; directed reachability distinguishes
long reachable paths from unreachable targets, which retain their existing
horizontal-distance scoring. Other path queries keep their full search.
Failed tactical destinations are remembered for 100 ticks. An unforced
`TAKE_SLOT` or `HOLD_SLOT` plan for an excluded formation slot yields to recovery
before its search, preserving the original retry deadline. This formation
exclusion does not replace independently selected poison-escape, combat, retreat
or hunt plans. The slot can be retried exactly at expiry; a new failure starts
another cooldown. Forced objective directives bypass this formation exclusion,
and a new life clears remembered destinations.
Each navigation graph owns a derived strongly connected component index. Its
reachability bitsets use at most 8MiB of payload per graph; larger component sets
use exact traversal of the condensed directed graph with exclusive search scratch.
The index is built during graph preparation, including asynchronous runtime map
loading, and retires with the graph. It does not change the navigation artifact
format or retain a separate cache of inactive maps.
Future sprint-jump setup distances reuse the exact original waypoint geometry in
a graph-owned, thread-safe lazy cache with eight bytes per baked LEAP edge.
It retires with the graph and leaves the artifact format, physical travel times
and health costs unchanged. Fall-damage queries read the same node heights and
water landing directly instead of constructing unused jump-launch geometry.
The cycle runs perception (10 Hz), the team step
(about 1 Hz) and tactics (4 Hz) for the bots whose slot is due
(`(tick + slot) % period == 0`), under a line-of-sight ray budget, with a
fresh `SplittableRandom` per bot per job seeded from the match, the bot and
the tick, and publishes an immutable board the main thread reads with one
volatile read. Every decision carries the snapshot tick and the bot's life
epoch; death, teleport, spectating and a landed Rewind bump the epoch, and a
decision from an old life or older than `maxDecisionAgeTicks` degrades (the
path is kept, the aim lock and pending ability dropped, a rethink requested)
rather than being followed blindly. Bodies are resolved from the Citizens NPC
on every call because the entity object is replaced when the skin applies;
the attack-speed base is re-applied on every `NPCSpawnEvent`. All rule
actions (attacks, fuse clicks, arrows, Rewind) go through `rwf.app.BotActions`;
bots never deal damage directly.

Visible melee targets behind movement-blocking cover or at a different height
receive a baked approach route. The reflex controller follows that route until
an unobstructed sword ray can reach the target, then resumes local combat
steering. It keeps aiming at the visible opponent during the approach and does
not spend swing cooldowns against intervening glass. Open, level approaches keep
direct steering. This check does not replace the movement graph's traversal
limits or establish that a straight approach has continuous floor support.

The `Governor` watches the server's recent tick times (p95) and the bot
sections' own time with hysteresis: level 1 halves the think rates and makes
bots with no human within 48 blocks reflex every other tick; level 2 also
drafts fewer bots next match. It never removes a bot from a running round.

Load. `bun run test:load` (`STORM_E2E_LOAD_CPUS` sets the CPU cap, 4 when
unset) measures 20, 50 and 100 bots against the plan's bars in
`tests/load/load-bars.ts`:

- an added tick p95 of at most 8 ms at 100 bots;
- staleness (the think loop's lag from snapshot to published decision) at a
  p95 of 3 ticks or less;
- no think job longer than a tick while the governor is at level 0.

The age of the decision a bot follows, which `/rwfbots debug` calls
staleness, is about `tacticsEveryTicks` (5) by design; it is reported, not
judged. `plugin/modules/rwfbots/LOAD.md` holds the historical serial-engine
measurements. The parallel engine requires its own capacity evidence.

The shared platform compute pool reads the required, repository-owned
`compute.yml` once at startup. `maxThreads` accepts integers from 1 through 10;
the shipped ceiling is 4. The actual size is the lesser of that ceiling and
`max(1, JVM available processors - 1)`. Changing it requires a restart and affects
every module using the shared pool. Startup logs report the ceiling, actual
workers and detected processors. Invalid or missing settings stop startup.

`test:capacity` is separate extended local acceptance for 64, 100, 128, 192 and
256 total combatants (one human plus bots), on either `apex-expanse` or
`warlords-castles` selected with `STORM_CAPACITY_MAP`. It caps Docker at 3
CPUs by default with an 8G heap and 10GiB memory, matching the production CPU request
conservatively. `STORM_CAPACITY_CPUS=4`, `6`, `8` or `12` compares larger CPU budgets;
the evidence verifies the exact enforced limit. Production has no CPU limit.
`STORM_CAPACITY_INITIAL_HEAP=1G` selects a smaller initial heap for an explicit
disposable candidate; absent or empty values preserve the 8G initial heap.
Only `1G` and `8G` are accepted. The maximum stays 8G and the container limit
stays 10GiB. Reports record selection provenance and actual JVM initial and
maximum bytes; mismatched declarations and mixed runtime fingerprints cannot
qualify together. This selector does not change production bootstrap settings.
`STORM_CAPACITY_WORKERS` changes only the disposable fixture's startup ceiling;
it must leave at least one of the selected CPUs for Paper. With no override, the
ceiling remains four, clipped to the CPU budget. Explicit comparison pairs are
3 CPUs/2 workers, 4/3, 6/4, 8/6 and 12/10. Evidence verifies the staged setting and
actual worker count from the JVM startup log.
It uses a 90-second baseline, 20-second settling period and
150 seconds of live measurement per size, rearming ordinary matches when
needed. Run each map twice. This does not change shipped match limits or
automatic presets.
The empty lobby prepares and admits the selected map through the ordinary
preparation path before the baseline; the frame-pacing check uses the same
readiness gate before positioning its camera.

Every size must keep each sampled ten-second tick p95 below 50ms and within
8ms of baseline, board lag p95 at most three ticks, governor level zero,
and no complete thinking cycles over 50ms, including queueing and all stage
boundaries. Perception age uses actual observation ticks,
including bots waiting for their first observation: p95 at most five ticks,
maximum ten ticks, and no pending first observations after settling. Heap
and container memory must stay below 90% of their limits. The container
peak includes startup and reset. Results and incremental checkpoints are saved under
`.cache/e2e/capacity/`, including arrival and reset tick windows, startup
telemetry, exact rosters and cleanup. Arrival, settling and reset costs remain
separate from the live measuring window.

`/rwfbots debug load reset` returns the current interval and starts the next
one together, preserving think jobs completed across that boundary. The load
harness uses it for continuous sampling; `/rwfbots debug reset` starts a fresh
phase without returning the previous interval.

`STORM_CAPACITY_RAY_BUDGET` changes only the disposable fixture's LOS budget
for calibration. `STORM_CAPACITY_PROBE_TOTAL` selects one size for a quick
probe; reports include separate verdicts for each tier, and an incomplete matrix
always fails the full 256-player release verdict. A tier verdict covers one run;
qualification still requires both maps, repetitions and native gameplay checks.
Full acceptance uses the shipped budget and all five sizes. These suites remain outside CI.

`capacity:qualify --manifest <file> --output <new-file>` replays the raw capacity
bars across both maps and two independent repetitions for each CPU/worker pair.
The version-1 manifest names the exact candidate binary, fixture, personality,
bot-configuration and runtime fingerprints, the two map/configuration
identities, and every report path relative to the manifest. Only complete
version-2 reports qualify. The reader checks original run/container/match
identities and measuring intervals, rejects overlapping runs and changed
inputs, and recomputes bars rather than trusting recorded pass labels. It
fingerprints actual server properties while excluding generated comments and
the per-boot `rcon.password` and `management-server-secret` credentials. Enabled
services, TLS, networking and simulation settings remain bound. Missing or empty
inputs fail identity capture; reports with the previous credential-dependent
properties inventory are rejected. JVM argument fingerprints retain argument
boundaries and heap flags, normalizing only the explicit CPU-count flag for
CPU comparisons; unsupported embedded newlines are rejected.
Each live match also retains its frozen host setting and actual installed bot
combat parameters separately from the declared experience. The candidate names
its host difficulty; mismatched bands, incomplete bot inventories and missing
original behavior observations cannot qualify. A Normal-host run supplies no
Hard-host capacity evidence.
Before boot, the disposable capacity profile enables match flow, host settings
and candidate visits in its private feature service and records all RWF flag
readbacks. Other RWF flags remain disabled in this candidate. Reports also bind
the actual authored settings, including style, variety and map and kit pools;
only the per-match random seed may vary between repetitions.
The qualifier reports load qualification separately for each tier and the complete matrix,
then chooses the smallest CPU pair supporting the highest qualified 64, 128 or
256 tier. Its result does not accept deployment: rendered combat, bounded map
loading, survival coexistence, MacBook frame pacing, manual quality and live
rollout remain independent requirements. `test:capacity-tools` exercises these
evidence boundaries without starting Minecraft.
For an incomplete calibration probe only, `STORM_CAPACITY_PROFILE=cpu|alloc|jfr`
captures another 90 seconds after the measuring window and saves
the profile locally under `.cache/e2e/capacity/profiles/`. CPU/allocation modes
use Spark. JFR mode uses Minecraft's native `jfr start/stop` commands and the
host JDK's `jfr` tool; the server image needs no JDK diagnostic executables.
The `storm.BotThink` events identify match generation, snapshot tick, cycle,
preparation, each parallel stage and ordered commit. Batch spans separate queue,
worker wall and thread CPU times; cycle CPU is unavailable because a cycle
crosses threads. Nested `tactics-bot` spans identify each individual proposal,
including recovery planning and ordered-commit conflict retries. Their `botId`
is the match-local combatant number; combine it with generation and snapshot
tick to correlate recorded inputs and decisions. Single-bot `retake-route`
spans also carry that ID; aggregate spans use `-1`. Per-bot wall and CPU times
are included in their enclosing batch or commit, so do not add nested spans to
aggregate durations. Built-in GC and execution samples share the same timeline.
The native recording configuration enables object counting at chunk boundaries,
which can trigger heap-inspection full collections during a long recording as
well as at start and stop. Check GC cause and chunk timing before attributing
those diagnostic pauses to application allocation or heap sizing.
The diagnostic also saves container CPU counters before and after profiling.
Disabled recordings allocate no stage markers or read the timing clock.
Raw JFR files can include JVM environment metadata and stay private; upload only
a sanitized analysis. The evidence labels
this diagnostic mode explicitly; profiled probes cannot establish release
acceptance. Compare clean measuring windows and keep the separate profiler
overhead out of capacity claims.

For a whole-window diagnostic without the native ObjectCount trigger, the
disposable fixture exposes private RCON commands
`storm-fixture-jfr start|status|stop <live-match-uuid> <unique-attempt-uuid>`.
It permits one attempt per server and requires the exact current Live match.
The server thread grants activation after preparation and validates the same
Live binding again after JFR starts; a changed or missing match invalidates the
capture. Starting on a worker cannot be atomic with a match transition, so an
invalidated start may briefly record before cleanup. Such an attempt cannot
report COMPLETE.

One owned worker loads `/flightrecorder-config.jfc` through the server
implementation class and requires SHA256
`7cf2a220574ade30738da8b50b9fc470331331911e84a99abacb06c5857176c9`.
Missing, malformed or different resources fail. The applied settings change
only `jdk.ObjectCount#enabled=false` and `storm.BotThink#enabled=true`.
Existing active or delayed recordings reject activation. A listener retains
later foreign RUNNING observations, and the worker also scans for active or
delayed recordings every 100 ms and before/after export. An observed foreign
recording invalidates the diagnostic; the fixture never stops it. Public JFR
offers no exclusive global recording lock: this cannot prevent a foreign
recording from starting, or observe a delayed recording created and closed
between scans. A foreign recording can combine settings and re-enable
ObjectCount before invalidation is observed. Retain that limit when auditing
the resulting event inventory and pauses.

The worker owns JFR settings, start, stop and all file I/O. It captures at most
300 seconds with a 250 MiB retained-chunk size limit; that JFR limit can exceed
its nominal bound by a chunk and can discard old chunks, so actual file size
and full measurement coverage still need inspection. Files remain private under
`plugins/TheStormFixtures/jfr/<attempt-uuid>/`: original `paper.jfc`,
`applied-settings.txt` and `capture.jfr`. Status includes applied settings,
hashes, actual times and a streamed event inventory. The output directory is
exclusive and cannot be reused.

Explicitly stop the exact attempt, poll until status is COMPLETE with
`workerAlive=false`, copy the closed readable file, and verify its reported
SHA256 **before** removing the server. COMPLETE requires successful explicit
stop after Live validation, CLOSED recording, readable export and worker
termination. Expiry or export failure cannot pass. Destination stop exports
and closes the recording; the fixture does not dump an already closed one.
The server thread never waits for the worker. Unexpected plugin disable marks
an unfinished attempt incomplete and requests asynchronous cleanup, while
still attempting the existing early fixture cleanup. That path cannot
guarantee export or worker termination before the fixture classloader closes.
The worker retains fixture support classes and the server implementation Class
until it exits; it has no Bukkit/plugin instance, product classes or product
callbacks, and uses the platform context classloader. Normal teardown must use
the explicit COMPLETE precondition. This recorder is solely diagnostic:
its reports are excluded from load qualification and production acceptance.

`test:capacity-native` boots the same disposable capacity profile with an
ordinary rendered Minecraft client. It joins a 256-combatant draft by default;
`STORM_CAPACITY_NATIVE_TOTAL` selects 64, 100, 128 or 192 for tier acceptance.
Before connecting the client, its existing fifteen-minute preparation wait reads
the fixture's `candidate-ready <mapId>` boolean: the empty Lobby must have exactly
that unclosed candidate ballot and completed candidate terrain visits. This does
not close the vote or activate navigation; navigation activates after ordinary
voting. The first arrival still receives its ninety-second vote, and the native
draft retains its 120-second admission bound. Timestamped status and candidate
replies remain under `.cache/e2e/capacity-native-preparation/`; the acceptance
receipt links their path and preparation timing. A connected client's failure
captures its status and a screenshot before teardown without replacing the
original failure.
It proves twenty ticks of ordinary forward movement, then observes normal combat
in place instead of holding blind forward input across floating terrain. It waits
for ordinary match completion and requires
the original recording to attribute the human's combat death to a bot, corroborated
by health loss observed in the native client. A passive server observer binds
to that same ordinary match and journals the human's health and absorption
before and after bot hits. Acceptance requires that killer's recorded attack
intent, applied melee or projectile damage, and direct combat death; poison,
environmental deaths and canceled hits that changed no health cannot satisfy
it. The observer never moves or damages a fighter. It also checks bot movement.
After the observer is armed, failures retain its raw timestamped sample and strict
schema/match validation alongside the native failure capture. Empty bot-hit data
alone does not establish an environmental cause of death; the original acceptance
failure remains authoritative if secondary evidence collection fails.
Screenshots, client commands, observations and the original recording remain
under `.cache/e2e/capacity-native/`. Run this on a machine able to launch the
client, separately from the load matrix so client rendering cannot affect its
measurements.

`test:capacity-frame-pacing` measures real renderer callback intervals on
macOS, first in an empty admitted map and then during the selected mixed
roster. It uses the same `STORM_CAPACITY_MAP` and
`STORM_CAPACITY_NATIVE_TOTAL` selectors. Both windows last sixty seconds at
the map's saved spectator viewpoint, with no screenshots or video capture
during timing. Receipts retain every render interval, stalled tail time,
focus and menu state, camera pose, graphics settings, runtime fingerprints
and Mac hardware identity. The comparison rejects changed viewpoints,
settings and client runtimes. Its report remains a measurement rather than
an automatic performance acceptance. Run it separately from server-load
qualification and inspect the resulting frame distribution.

For an already running instrumented client, `bun run client
frame-pacing-start --session <session.json> --args
'{"name":"baseline","durationMs":60000,"targetFrames":36000}'` starts a
bounded timing window; `frame-pacing-status` reads its completion and receipt
path. Video and pacing windows cannot overlap.

Filling a match: the `Director` drafts personalities from
`rwfbots/personalities/*.yml` (excluding names held by online humans or already drafted bots),
keeps the most balanceable of a few drafts, freezes competence from the selected
difficulty and recorded seed, and gives
each a kit from its weights over `draft.kits`; a personality whose weights
name none of those kits (its favourites ship later) still drafts and plays one
of them, chosen uniformly. The draft happens when the countdown starts, but
rwf walks the drafted bots into the lobby one by one, a seeded 1 to 8 seconds
apart (`rwf.domain.lobby.Arrivals`, squeezed into the first half of the
countdown so all are in before the start; personalities with the
`late_to_everything` quirk come last), each with the usual join message;
bots still on their way are released if the countdown stops. Ratings are
OpenSkill; after a match with a result every team goes
through one update and each bot's record (matches, wins, kills, deaths,
plants, defuses, mu, sigma, last seen) is written to
`rwfbots_personality_stats`. Humans play at the default rating.
Ratings still influence roster balance; ordinary difficulty no longer weakens
bots to target a human win rate. Personality variation stays within the
selected competence floor and remains fixed throughout the match. Controlled
legacy diagnostics retain their explicitly selected baseline profiles.

Configuration and content under `server/owned/plugins/TheStorm`:

- `rwfbots.yml`: think rates, governor thresholds, the lever curve table
  (pinned to `Lever.java`), the kits bots may draft, the LOS ray budget,
  trace recording and bot chat (`chat:`, below).
- `rwfbots/personalities/<id>.yml`: the personas (see its README): about
  512, spread across twelve archetypes (rusher, lurker, sniper,
  bomb diver, anchor, flanker, support, duelist, hunter, turtle, troll,
  tactician) and five skill bands. Play differs through the style, role,
  kit and lever values the generator derives from the archetype, and
  through the archetype itself (see Team play below). Each persona also
  carries a voice, chat lines per moment (plus pre-match lobby small talk),
  quirks, rivals and a bio, authored in `scripts/bots/enrichment/`; bot chat
  speaks the match and lobby lines, and three quirks also act in play.
- `rwf/lobby/nav.rwfnav`: the lobby's baked navigation, its places (spawn,
  team sides, kit alcoves, balcony) as sites; required, so a missing or
  unusable one stops the module (`NavFiles.loadLobby`, checked by
  `LobbyNav.problems`).
- `rwf/maps/<id>/nav.rwfnav`: the map's baked navigation artifact
  (`NavCodec` format, from the `rwfmap` tool), next to `map.yml` and
  `blocks.schem`. Its `blocksSha256` must equal the map's `blocksSha256`;
  the module compares them when the match chooses the map and runs that map
  humans-only, with a logged error, when the artifact is missing, corrupt,
  unplayable or baked from other blocks.

Bot chat. `BotChat` (`adapter.paper`) subscribes to rwf's `MatchEvents`,
reads each transition as chat moments (`app.ChatMoments`: a bot walking into
the lobby, the match going live, a death with its killer, a bomb finishing arming or being defused, the
end with its winner; bomb names as players read them, such as `Blue Team's
bomb` or `the nuke`) and hands them to one pure, seeded
`domain.chat.ChatDirector` per match, from its lobby to its end, which picks
who says which line and when. In the lobby a bot may greet as it walks in;
`HeardLines`, a chat tap, hands a human's Global or Team line there to the
director on the main thread and one bot may answer (a greet for a greeting such as hi, hey or o/,
a `lobby` line otherwise); idle time brings `lobby` small talk or a taunt at
a rival who is there too; and once, in the countdown's last 10 seconds, a bot
may remark on it. Lobby lines name no team (there are none yet), so lines
with `{team}` wait for the match. The director proposes greetings, kill/death
responses, plant/defuse calls, last-survivor calls, end lines and idle taunts.
Its authored-line eligibility includes `recentDeathSeconds`; physical typing
and delivery are checked separately against the current body and life. Each roll is
`chances.<moment>` times the personality's verbosity factor, small archetype
leanings (trolls taunt 2.5x, tacticians 0.25x), tone tags (loud or quiet
tags 1.25x or 0.75x) and chat quirks (`blames_lag`, `good_sport`,
`says_sorry`, `celebrates_early`, `loves_nuke`, `narrates`,
`calls_everything`), times `rivalBoost` for a kill, death or taunt aimed at a
rival or, for `holds_grudges`, at whoever last killed the bot; capped at 1. A
bot with `always_gg` always proposes a win or loss line, preferring one that
says gg; it still obeys delivery limits. The director's `botCooldownSeconds`,
`minGapMillis`, `maxLinesPerWindow`, `windowSeconds`, reaction range and
`maxDelayMillis` control proposals, and a line is not repeated within a match.
Proposals more than four seconds ahead are discarded. `SpeechControl` owns
final delivery: casual Global chat allows one line per 20 seconds and one per
bot per 45 seconds; tactical Team chat allows two lines per team per 15 seconds
and one per bot per 15 seconds. Identical text in the same channel/team is
deduplicated for 12 seconds. Placeholders are filled
with names as players see them (`{victim}`, `{killer}`, `{team}` as `Red
Team`, `{bomb}`). Each accepted proposal waits 400–900 ms, then takes
5–9 Unicode code points per second to type, clamped to 0.8–4 seconds. A typing
bot stops voluntary movement, attacks and item use, cancelling active drawing
or eating. Nearby teammates within 24 blocks and line of sight see a `typing…`
indicator; enemies and unassigned lobby viewers do not. Immediate danger,
recent injury, fuse work, shield commitment or horn casting cancel typing.
Death, departure, a changed life/phase, disabling chat or switching the flag
off clears unfinished speech and indicators. A completed line goes through
the chat module's `NpcChat`, so it
passes the same mutes, filters and repeat limits as a player's and respects
hidden channels and ignores: team calls (a plant, a defuse, the last of a
team) in Team chat, which only the bot's team hears, everything else in
Global, in the channel's format with the `✦` marker after the name and, once
teams exist, a `●` in the team colour before it. Either way only the human
players in the rwf world hear it (members and watchers, never the bot bodies
or anyone elsewhere), and no NPC line is relayed to Discord. A line chat
refuses is dropped. A tactical bot report reaches teammates' decision memory
only after its spoken line is successfully delivered. Warden listening-post
reports are automatic device observations. A new context is a new `ChatMoment`
with its own line pool and the same delivery limits.

`adapter.remote.FliptChatGate` evaluates the independent managed chat gate off
the main thread. `RwfBotsPaper` wires its refresh loop into the chat director;
the settings, targeting and environment values are in the feature flags
reference above. `verifyManagedChatFlag` checks the client's keys against
`packages/feature-flags` at build time.

Lobby life. Before the match the bots act like players waiting for it.
`LobbyTicker` (`adapter.paper`, driven by `BotTicker` while rwf's phase is
lobby or countdown) gives each bot a `KitPlan` as it walks in: it picks a
first kit, then makes 0 to 3 switches at least 5 s apart through the same
`BotActions.pickKit` path humans use, the last switch always to the kit the
director drafted, so balance never changes (eager temperaments switch more;
a bot with no time left just picks its drafted kit). Twice a second the
lobby goes to the `LobbyLoop` (`app`), which runs the pure
`domain.lobby.LobbyLife` planner for every bot on the compute pool, seeded
per match, bot and tick: wander to a random cell, walk up to someone (a
human, a rival, anyone) and stop 1.5 to 4 blocks short facing them, browse
the alcove of the next kit it will switch to, look around, tap sneak (often
the first thing a bot does is walk up to a human and tap sneak at them, the
Minecraft hello), hop, or hang out at a side of the room it favours.
`LobbyTemperament` weighs those from the archetype (trolls jump, sneak and
crowd people; tacticians browse kits and stand still; supports walk up to
others), the voice (chatty bots seek company) and the quirks
(`crouch_spam`, `bunny_hops`, `spins`). Walks follow the lobby's baked nav
graph, and `LobbySteering` turns each plan into the same `BodyCommand`s
(move, jump up steps, look, sneak) the match's reflexes use. Nothing can be
hurt in the lobby. When the match goes live the lobby loop stops and the
think loop takes over.

Team play. Every couple of seconds the team step deals a `Playbook`: one
slot per living bot for the team's strategy, at least four blocks apart.
Lane and flank slots sit at the team's push along their lane, which starts
halfway to the enemy bomb and moves further up with every deal until a
teammate sees an enemy close by; the planter holds its place on the line
until the push is far enough up, it is the last one alive or the bomb is
right there. TURTLE is drawn for at most one team in four; outside it at
most one bot of eight anchors. RUSH puts the planter up the middle with a
two-escort wedge behind it and the side lanes and flanks screening; SPLIT
sends the planter and an escort down one lane and a pair with a flank down
the other; TURTLE spreads anchors over distinct approaches to the own bomb
with overwatch and a planter round the far lane; HUNT sends sweeping pairs
towards the latest sightings. Lanes come from the baked approach routes plus
wide lanes forced through points either side of the straight line, which is
what spreads a team on an open map such as the training yard. The strategy
names the objective, so the nuke is played for, not walked into because it
is nearest. Slots go to bots by the Hungarian algorithm over archetype, role
and kit fit, path distance and a bonus for the slot already held, so
assignments stick. Tactics then take and hold the slot (ARM targets an unlit
bomb for the plant slot, a bot beside an unwatched bomb or the last survivor).
Unfinished lane, flank and sweep assignments stay committed through distant sightings,
cover stops and the gaps between movement bounds. Close contact, recent damage,
survival and defusing can interrupt them; an established fight continues, and
reaching the slot or becoming the last survivor releases the assignment.
A bot at its slot watches its angle and makes room for nearby teammates.
Once an enemy the bot saw itself is within 24 blocks it moves up from cover to cover, and
within 12 pairs alternate mover and holder; it holds its slot from cover,
claiming cover on the blackboard so teammates do not share it. At most two
bots chase one enemy unless it is nearly dead; bows keep their kit's band
(longbow and snipers 15 to 30 blocks), reach their assigned team position along
its lane when that position fits the band, then shoot from the edge of cover; the
Rewind kit uses its clock only when a model of rwf's Rewind ability says it
is ready and lands away from the threat. Every path a bot walks pays a per-bot
penalty per block of each primitive: seeded noise over patches of the map, a
toll on teammates' current paths and one for leaving its lane. Long jumps pay
for their full distance, so they cannot evade those costs by skipping intermediate
graph nodes. Teammates with one goal still take different ways. Formation steering
uses the playbook's slot spacing while accounting for closing teammates.
Archetypes bend the utilities, the decision temperature and
the fighting range, and add a push to the aggression lever at the draft;
`crouch_spam`, `late_to_everything` and `loves_nuke` act in play.

`/rwfbots debug [bot]` (`thestorm.rwfbots.admin`) prints the governor level,
think and staleness percentiles, the board counters and every bot's plan, or
one bot's levers, decision and refusals. `/rwfbots debug slots` lists each
team's objective and every bot's slot, and draws them for the sender for ten
seconds: a dust ring at each slot and a trail along each bot's route, in team
colours.

`/rwfbots debug load` returns compact interval measurements, including the
perception age of living bots, board lag, peak governor level, slow-job count
and heap peak. `/rwfbots debug reset` starts a new measuring interval. Perception
is served oldest first with stable slot ties, including initial perceptions;
one perception larger than the LOS budget is allowed to prevent starvation.

`bun run rwf:trails <recording.gz> --out <trails.png>` draws a match recording
from above: every combatant's path, solid until first contact (the first
landed sword blow or death), with each team's nearest-teammate distance before
first contact and over the first 20 s. The full-lane suite keeps its
recordings under `.cache/e2e/rwf/<matchId>/`.

Decision traces: with `traces.enabled`, every think step appends one
tab-separated `decision` line (tick, bot, epoch, option, plan label,
temperature, draw, quantized features, top utilities, path length) to
`plugins/TheStorm/rwfbots-traces/<matchId>.gz`, written off the main thread;
lines past `queueCapacity` are dropped and counted.

## Product metrics

The plugin's `core.analytics.ProductAnalytics` port records human sessions,
AFK-adjusted playtime and successful feature interactions. Gameplay modules
receive it through `ModuleContext`; tests explicitly use the disabled port or
a recording test implementation. Keep event properties bounded and free of
chat, arguments, locations and credentials. Minecraft UUID and player name are
the intentionally named identity.

Collection is boot-scoped behind the default-off managed flag
`the-storm-analytics-enabled` (`the-storm` namespace, beta and production
overrides enabled).
Bootstrap uses `POSTHOG_API_HOST`, `POSTHOG_PROJECT_TOKEN` and
`FLIPT_ENVIRONMENT`, supplied from the analytics registry by homelab CDK8s.
Missing or invalid bootstrap and failed flag evaluation leave collection off.
SQLite owns event-driven session checkpoints and the outgoing event queue.
Gameplay transitions and interactions advance playtime and trigger delivery;
disconnect closure runs after gameplay quit handlers. Delivery uses asynchronous
HTTP; network failure cannot block gameplay, and shutdown leaves unsent events
durable for the next enabled boot.

The private dashboard is declared in
`packages/homelab/src/tofu/posthog/storm-product-metrics.tf`. Interval events
are the source for time sums; session-end totals only measure completed session
length. All aggregates deduplicate stable event IDs and exclude beta captures.
See the wiki's PostHog explanation for accounting semantics and live acceptance.
