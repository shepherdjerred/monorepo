# The Storm

The Paper plugin behind [The Storm](https://ts-mc.net), a community and economy
Minecraft server (originally 2014–2017, revived on the homelab's
`minecraft-tsmc`). All gameplay code lives in one plugin, `TheStorm.jar`, built
from `plugin/`.

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
```

Native-client acceptance uses
`bun run --cwd packages/the-storm test:client-native` on a machine capable of
running the Minecraft client. Sandbox gameplay scenarios use
`toolkit mc playtest run packages/the-storm/playtests/` against `storm-dev`;
follow the repository's `minecraft-harness` skill for sandbox ownership and
cleanup. These checks are also committer-run.

## Essentials command surface

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
including `rwf` and `rwfbots` (the rwf world is provisioned on live). The boot check, the
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

Arena restores keep the database snapshot until a later player login confirms
that Paper saved the restored inventory and its matching persistent-data marker
together. Players must reconnect before entering another arena after a restore;
this avoids a synchronous player-data write on the server tick.

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

The economy `Wallets` port supports a stable `KeyedTransfer` for compensating
payments. It stores the operation key with the ledger row, returns the same
receipt for an identical retry, and rejects reuse of the key with different
transfer details. `receiptFor` lets a caller reconcile an uncertain result.
Ordinary unkeyed transfers keep their existing behavior.

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
but the team that armed it, and a poison forces long matches to a result. The
rules are pure (`rwf.domain`); the Paper adapter carries out their effects at
20 Hz and seals the match world so every other module leaves it alone.

The world named in `rwf.yml` (`rwf`) must be provisioned by an operator through
Multiverse and loaded before TheStorm enables; a flat or void world is fine
because each map brings its own terrain. A missing world stops the server, like
the world module's worlds. The module never generates terrain itself.

The world is a vanilla superflat world with a single air layer and the
`the_void` biome (the same settings the e2e fixture plugin creates), not a
TheStorm `ChunkGenerator`, and it is not listed in `world.yml`. Multiverse
loads its worlds before TheStorm enables, and Bukkit refuses a plugin
generator whose plugin is not enabled yet, so a generator of ours would leave
Multiverse unable to load the world on every boot. `world.yml` lists only the
survival worlds the world module validates and offers to random teleport; the
rwf module already requires and seals its own world, and listing it there
would make the world module refuse to start while `rwf` is off.

Configuration and content live under `server/owned/plugins/TheStorm`:

- `rwf.yml`: the world, the fallback spectator point, how matches fill and
  start (`minHumans`, `targetCombatants`, `maxCombatants`, the 90 s countdown,
  the 30 s no-humans abort), the ported rule constants pinned to the code,
  rewards (3 win / 1 lose scaled by the human share, a daily cap, the minimum
  match length), recording and the load-test switch.
- `rwf/kits.yml`: the kits as the operator sees them, each with the `icon`
  material and the one to four `summary` lines the kit menu and the lobby's
  alcoves show; it must describe `KitBook` kit for kit or the module refuses
  to start.
- `rwf/maps/<id>/map.yml` and `blocks.schem`: a map's teams, spawns, bombs,
  nukes, region and the SHA-256 of its Sponge v3 schematic. The module pastes
  every map at enable and whenever the world's blocks stop matching the hash,
  20,000 blocks a tick with admission closed meanwhile. `training-yard` is a
  generated 64x16x64 sample; its generator lives in the module's test sources.
- `rwf/maps/<id>/nav.rwfnav` and `nav.summary.json`: the map's baked navigation
  data for the bots, produced offline by the `rwfmap` tool (see Maps below).
- `rwf/lobby/lobby.yml` and `blocks.schem`: the room every player and bot waits
  in before a match, with its region, spawn, team sides, one kit alcove per
  kit, the rules and match-board anchors, the watch balcony and the
  schematic's hash, plus its `nav.rwfnav` for the bots. It is generated by
  `rwf.domain.lobby.LobbyBuild` (a roofed 31x9x31 room at `128,64,16`, east of
  the maps) and pasted, verified and repaired exactly like a map.

### Maps

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
the world's blocks change. Commit all four files together.
`mise exec -- gradle verifyRwfMaps` (part of `check`, so CI runs it) re-bakes
every map in memory and fails if a committed `nav.rwfnav` or summary differs
byte for byte; the bake is deterministic, so a diff means the map, the block
table or the baker changed and the artifacts must be rebaked. A bake that
`NavArtifact.validate()` rejects (a spawn inside a wall, a bomb no spawn can
reach) fails too; fix the map, not the tool.

The lobby is generated rather than authored: `mise exec -- gradle
bakeRwfLobby` writes `rwf/lobby/blocks.schem` from `LobbyBuild`, refuses to
go further until `lobby.yml` declares its hash, then bakes the lobby's nav
files with its places (spawn, sides, alcoves, balcony) as sites and no bombs.
`verifyRwfLobby` (run by `verifyRwfMaps`, so by `check`) fails when the
schematic, `lobby.yml`'s layout or hash, or the nav files are not what the
generator and a fresh bake produce, or when any place cannot be reached from
the spawn. Change the room in `LobbyBuild`, rebake and commit all four files.

Commands: `/rwf join` (gated by the managed Flipt flag
`the-storm-rwf-enabled`; a missing `FLIPT_URL` or `FLIPT_ENVIRONMENT` keeps it
closed), `/rwf leave`, `/rwf kit <id>`, `/rwf who`, `/rwf spectate` and
`/rwf spectate next` (`thestorm.rwf.spectate`, granted by default, behind the
same Flipt flag), and for `thestorm.rwf.admin`: `/rwf admin status`,
`/rwf admin repair` (re-verifies the current map and the lobby between
matches, re-pasting whatever differs), `/rwf admin loadtest <n>` (only when `loadtest.enabled`)
and `/rwf admin showcase [count]`. Joining snapshots a player's belongings
through the shared crash-safe snapshot machinery and restores them on leave,
death, disconnect or the next login.

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
refuses while humans are in the match. The showcase is a flag on the runner,
not the domain: the countdown fills to `count`, the humans rule is off, and
humans may watch but not join. It plays, records and stores like any match
(bots are never paid, so it pays nobody) and the lobby after it is normal.

Matches are recorded under pseudonyms (positions, actions, results) to
`plugins/TheStorm/rwf-recordings/yyyy/MM/dd/<matchId>.rwfrec.gz` for review and
bot training; every joining human is told so on entry. Pseudonyms are
HMAC-SHA256 over the salt in `RWF_RECORDING_SALT`, which must be set when
`recording.enabled` is true. Recordings are pruned by age and size at enable.

A recording is gzipped UTF-8 text, one tab-separated row per line, written by
`RecordCodec` (format version 3; `RecordCodecTest` also preserves the version 2 golden copy). Tabs,
newlines and backslashes inside a field are escaped with a backslash. Ticks
count from the moment the match went live, at 50 ms each.

| Tag | Row                                                                                                                                                                                                                                                                                            | When                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `H` | version, match id, map id, map block SHA-256, seed, rules version                                                                                                                                                                                                                              | once, first                                                  |
| `R` | pseudonym, team, kit, bot (`true`/`false`)                                                                                                                                                                                                                                                     | once per combatant, after `H`                                |
| `E` | tick, kind, subject, detail                                                                                                                                                                                                                                                                    | each match event                                             |
| `F` | tick, pseudonym, x, y, z (1/32 block), yaw (0-255), pitch (-64..64), health (1/4 point), held slot, flags (sneak 1, sprint 2, fire 4, block 8)                                                                                                                                                 | humans every tick (20 Hz), bots every other tick (10 Hz)     |
| `N` | tick, pseudonym, keys (forward 1, back 2, left 4, right 8, jump 16, sneak 32, sprint 64), yaw (0-35999), pitch (-9000..9000), attack, use, hotbar slot (0-8), client sequence, acknowledged observation tick or -1, source (`HUMAN`, `AUTOMATED`, `MISSING`); angles in hundredths of a degree | humans only, every tick                                      |
| `O` | tick, pseudonym, observation contract id, normalized float values in contract order                                                                                                                                                                                                            | humans every tick when rwfbots provides its observation port |
| `I` | tick, pseudonym, kind, target                                                                                                                                                                                                                                                                  | each bot intent                                              |
| `X` | tick, winner or `-`, reason                                                                                                                                                                                                                                                                    | once, at the end                                             |
| `P` | pseudonym, credits                                                                                                                                                                                                                                                                             | once per paid human, after `X`                               |

The dedicated Fabric preview client sends complete `N` controls at 20 Hz through
`thestorm:rwf_input`. Its sequence and acknowledgement of
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

`F`, `N` and `O` rows are per-tick samples: when the writer falls more
than 20,000 samples behind, new ones are dropped and counted in
`rwf_match.dropped_frames`. Every other row is always written. A reader
reads versions 2 and 3 explicitly; version 2 lacks complete controls and is
excluded from training. Unknown versions and corrupt contracts fail validation.

For local human demonstrations, run `bun run client preview --rwf-duel` from
this package. It starts a disposable Paper server with one Trooper bot and a
six-second countdown. Join with `/rwf join`, select `/rwf kit trooper` before
the start, and play using the real keyboard and mouse. The regular preview
command keeps the full team setup for other-kit or team recordings. The server's
owned configuration stays unchanged. Stop with the printed session path:

```bash
bun run client stop --session .cache/client/<session>/session.json
bun run bots:dataset inspect .cache/client/<session>/recordings
bun run bots:dataset export .cache/client/<session>/recordings --output .cache/rwf-dataset
bun run test:learning
```

The launcher gracefully stops Paper and exports recordings into the session's
artifact directory before removing its container. The dataset exporter accepts
only human Trooper combat in two-combatant matches, sword selected, without an
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

```bash
uv sync --project tools/learning --locked
uv run --project tools/learning --locked python tools/learning/train.py .cache/rwf-dataset --output .cache/rwf-models/seed-17 --device mps --seed 17 --max-seconds 3600
uv run --project tools/learning --locked python tools/learning/export.py .cache/rwf-models/seed-17 --output .cache/rwf-models/seed-17-onnx
bun run test:learning
bun run lint:learning
bun run typecheck:learning
```

The trainer requires dataset export schema 2, which pins the three split files
by SHA-256. Re-export older datasets from their original human recordings.
It checks whole-match isolation, fresh observation acknowledgements and
continuous control sequences before training. The actor receives only the 34
fair observation values, uses a 128-unit LSTM, and produces five categorical
heads for movement, jump, sneak, sprint and attack. Memory resets at segment
boundaries and carries across truncated training windows; padding contributes
no loss. Validation selects the best checkpoint; test matches stay out of
optimization and checkpoint selection.

Choose `--device cpu` or `--device mps` explicitly. An unavailable MPS device
fails. Each BC invocation has a cooperative wall-clock limit (at most eight
hours), checked between training and validation windows. Reserve this time
within the pilot's per-seed budget; these tools do not implement its total
budget or PPO orchestration. Checkpoint and export directories must be new.
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

`rwflearn begin <seed> <red|blue> <authored|external>` requires an empty
training-yard lobby. `rwflearn state` returns a version-1 JSON envelope. Actor
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

Payouts go through an outbox in `rwf_match_player` and the economy's keyed
transfers (`rwf:<matchId>:<uuid>`), so a crash between the match ending and
the transfer pays exactly once on the next enable. Bots are never paid.

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
and in each kit alcove the kit's menu icon with its name and summary. They are
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
replaces one not yet consumed, and a CAS flag ensures at most one think job
runs on core's `ComputePool`. The job runs perception (10 Hz), the team step
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
judged. `plugin/modules/rwfbots/LOAD.md` holds the measured runs: 4 CPUs is
the tested shape.

Filling a match: the `Director` drafts personalities from
`rwfbots/personalities/*.yml` (never one whose name an online human uses),
keeps the most balanceable of a few drafts, shifts every bot's skill so the
median bot sits a little under the median human (`MatchShift`), and gives
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

Configuration and content under `server/owned/plugins/TheStorm`:

- `rwfbots.yml`: think rates, governor thresholds, the lever curve table
  (pinned to `Lever.java`), the kits bots may draft, the LOS ray budget,
  trace recording and bot chat (`chat:`, below).
- `rwfbots/personalities/<id>.yml`: the personas (see its README): about
  two hundred, spread evenly over twelve archetypes (rusher, lurker, sniper,
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
`LobbyChatListener` hands a human's chat there to the director on the main
thread and one bot may answer (a greet for a greeting such as hi, hey or o/,
a `lobby` line otherwise); idle time brings `lobby` small talk or a taunt at
a rival who is there too; and once, in the countdown's last 10 seconds, a bot
may remark on it. Lobby lines name no team (there are none yet), so lines
with `{team}` wait for the match. Eligible speakers are bots in the match, alive or dead for at
most `recentDeathSeconds` (end-of-match lines excepted): a greet from any bot
at the start, a kill line from the killer or a death line from the victim
(one of them), a plant or defuse line from a bomb worker, a line from the last
bot standing on a team, win or loss lines from every bot at the end, and an
idle taunt from a living bot about every `tauntEverySeconds`. Each roll is
`chances.<moment>` times the personality's verbosity factor, small archetype
leanings (trolls taunt 2.5x, tacticians 0.25x), tone tags (loud or quiet
tags 1.25x or 0.75x) and chat quirks (`blames_lag`, `good_sport`,
`says_sorry`, `celebrates_early`, `loves_nuke`, `narrates`,
`calls_everything`), times `rivalBoost` for a kill, death or taunt aimed at a
rival or, for `holds_grudges`, at whoever last killed the bot; capped at 1. A
bot with `always_gg` always says a win or loss line, preferring one that says
gg. A bot waits `botCooldownSeconds` between lines and never repeats a line
within a match; all bots together keep `minGapMillis` between lines and say
at most `maxLinesPerWindow` per `windowSeconds`, each line
`reactionMinMillis`..`reactionMaxMillis` after its moment, and a line the
limit would push past `maxDelayMillis` is dropped. Placeholders are filled
with names as players see them (`{victim}`, `{killer}`, `{team}` as `Red
Team`, `{bomb}`). A due line goes, as `[Name ✦]: line` (name in its team
colour, rwf's dim `✦` marker), to the human players in the rwf world only:
members and watchers, never Global, Discord or anyone elsewhere, and never
the bot bodies; in the lobby the name is white. Lines are not recorded. A new
context is a new `ChatMoment` with its own line pool; the director shares
every rule.

Chat is gated twice: `chat.enabled` in `rwfbots.yml` (false skips it
entirely) and the managed Flipt flag `the-storm-rwfbots-chat-enabled`
(namespace `the-storm`, beta on, prod off), evaluated by
`adapter.remote.FliptChatGate` off the main thread every
`flagRefreshSeconds` for the entity `the-storm-rwfbots-chat` with the rwf
world as context. The cached answer gates every line; the flag off, an
evaluation error, no answer yet or an unset `FLIPT_URL` or
`FLIPT_ENVIRONMENT` keeps bots silent. `verifyManagedChatFlag` checks the
client's keys against `packages/feature-flags` at build time.

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
Lane and flank routes stay committed through distant sightings and calls to help arm;
close contact, recent damage, survival and defusing can interrupt them.
A bot at its slot watches its angle and makes room for nearby teammates.
Once an enemy the bot saw itself is within 24 blocks it moves up from cover to cover, and
within 12 pairs alternate mover and holder; it holds its slot from cover,
claiming cover on the blackboard so teammates do not share it. At most two
bots chase one enemy unless it is nearly dead; bows keep their kit's band
(longbow and snipers 15 to 30 blocks), reach their assigned team position along
its lane when that position fits the band, then shoot from the edge of cover; the
Rewind kit uses its clock only when a model of rwf's Rewinder says it is
ready and lands away from the threat. Every path a bot walks pays a per-bot
penalty: seeded noise over patches of the map, a toll on teammates' current
paths and one for leaving its lane, so teammates with one goal still take
different ways. Archetypes bend the utilities, the decision temperature and
the fighting range, and add a push to the aggression lever at the draft;
`crouch_spam`, `late_to_everything` and `loves_nuke` act in play.

`/rwfbots debug [bot]` (`thestorm.rwfbots.admin`) prints the governor level,
think and staleness percentiles, the board counters and every bot's plan, or
one bot's levers, decision and refusals. `/rwfbots debug slots` lists each
team's objective and every bot's slot, and draws them for the sender for ten
seconds: a dust ring at each slot and a trail along each bot's route, in team
colours.

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
