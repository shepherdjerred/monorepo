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
The shipped `config.yml` registers 25 modules and enables 23 of them: `rwf`
and `rwfbots` stay off until the rwf world is provisioned. The boot check, the
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
inside the original 160 × 160 protected footprint. Broad rising streets connect
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
| Sneak within three blocks with line of sight    | Revives after five uninterrupted seconds, or three with Quick Revive      |
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

The first three rounds introduce the horde gradually. A solo opening has six
adult, unarmed zombies with eight HP and one HP native attack damage, arriving one every
three seconds with at most three alive. Rounds two and three add husks and
increase the count, health (10/12 HP), attack damage (1.5/2 HP), and concurrent limit. Baby zombies and
special enemy types arrive from round six onward. Opening zombies cannot summon
Hard-difficulty reinforcements beyond the planned wave.
Every starting class receives a wooden sword and full leather armor set; returning after a
bleedout retains the weaker chestplate-only kit and class tools. Round four has
12 enemies with six active solo; round five has four supports, at most two active,
and the first boss. Rounds six and seven have 16 and 18 enemies with caps seven
and eight. Each extra player adds three enemies and two active slots. Special
mobs spend 10–25% of the wave budget; ranged mobs begin at round six, have a
wind-up, at least three seconds between shots and limited concurrent slots.
Early ranged hits are capped at four raw HP and cannot inflict poison or slowness.

Standing survivors recover half a heart every five seconds after eight seconds
without damage, up to one-third of their current maximum health. Passive
recovery works during combat and resupply, without consuming food or applying
a potion effect. Food regeneration, potions, and class healing can heal above
that ceiling. Downed players and spectators do not receive passive recovery.

Every fifth round has a phased boss with three-second marked casts, line-of-sight
checks and recovery windows. Native boss attacks are replaced by authored spells.
Boss health is `(100 + 20 × round) × (1 + 0.65 × extra players)`, capped at 1,000;
round five therefore has 200/330/460/590 HP for one through four players, with
six/eight/ten-HP spells before armor across its three phases. Party size increases health and support
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
the food counter sells three bread for two emeralds. Shared routes cost quarry
12, foundry 20, infirmary 12, barracks 16, ramparts 20 and crypt 24 emeralds.
Click the same sign twice, 200 milliseconds to three seconds apart, to confirm.

Smugglers' Wharf and Signal Bluff each cost 20 emeralds after unlocking ramparts.
Both have two connections back to ramparts. Wharf docks and tunnels descend to Y 66/63;
bluff terraces and a rampart gallery rise to Y 85/88. The protected footprint remains unchanged.
Machines use barrels, jukeboxes, a generator and an anvil. Permanent interaction
holograms are absent. A single contextual action appears when looking at a fixture
within four blocks; unrelated class and plane status stays off the action bar.
Personal gathering glints appear only within six blocks while that material's
harvest budget remains. Purchased route signs disappear and return when the run resets.
Crafting, route unlocks, generator activation, and Pack-a-Punch play sounds and short
particle animations. Pickup cues name the team effect and its duration.

Fifteen gathering nodes cover twelve materials: wood, stone, wheat, iron, flint,
redstone, bone, glowstone, copper, string, nether wart, and blaze powder. Wood, stone,
and wheat each have two nodes; duplicates share two harvests per player per round.
Opening foundry permits an eight-emerald upgrade to 1.5× yield, and opening crypt
permits a sixteen-emerald upgrade to 2×. Upgrades affect everyone and reset per run.

The starting district and two later workshops have bank terminals. Materials and
emeralds use a shared run-local ledger; exact gear stacks use a private 54-slot locker.
Station crafting, machines, perks, and route purchases spend carried supplies first,
then shared supplies. The complete price is checked before any withdrawal. Reserved
box payments track their sources and refund at most once. Full-inventory material
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
weapon or equipped armor and offer compatible held-weapon enchantments. Recipes use
at most three material kinds plus emeralds; their outputs use the same tagged item
and payment paths as box rewards.

Restore power at the foundry with four iron and four redstone. Physical machines
sell Juggernog (24 emeralds, eight extra max HP), Stamin-Up (20, Speed I), Double
Tap (32, 25% extra weapon damage), and Quick Revive (16, three-second channels).
Quick Revive works before power and can grant a solo replacement self-revive,
after the current charge is used, at most twice per run. All perks disappear
immediately when downed, including a self-revive.

Plain arrows are shared bank supplies and can be withdrawn before using a bow.
The powered mystery box costs 16 emeralds: basic equipment 35%, enchanted
equipment 40%, special weapons 17%, and legendaries 8%. It starts in the market,
animates for three seconds, and reserves the revealed reward for its buyer for 15 seconds.
Unclaimed purchases refund to the original carried and banked sources; carried refunds
that cannot fit return to shared supplies. Rewards can be delivered to the private locker.
After six claims it moves to another authored site, including unopened districts.
Follow the magenta beacon to market, quarry, barracks, wharf or bluff. The beacon grants no buffs.
Ranged rewards include arrows; the Graviton includes redstone ammunition.

Legendary choices are equally weighted: Stormcaller chains damage to two nearby enemies;
Frostbite slows up to four ordinary enemies; Graviton spends one redstone to pull up to
five ordinary enemies every five seconds. Pack-a-Punch increases legendary strength.
Effects require line of sight and respect boss protections; native Breeze ranged deflection remains.
Special weapons are the Repeater (four carried arrows per second while holding
use), Whirlwind (two-target melee cleave with a two-second recovery), Tidebreaker
(Loyalty III trident with a two-target impact wave), and Riftblade (a four-block
dash through open ground with a six-second recovery). Release, weapon switching,
downing, and leaving stop Repeater fire. Releasing does not also fire a vanilla shot.
Held-use state is checked every server tick against a single 250ms firing
deadline. An early tick cannot postpone a shot by another complete firing period,
and delayed ticks do not cause catch-up bursts. Real-server cadence tests observe
native projectile launches and acknowledged release/weapon switching; Mineflayer's
local physics ticks are not a server clock.
Pack-a-Punch upgrades the held run weapon for 12/24/36 emeralds, fully repairs
it, adds compatible damage and durability enchantments, and preserves stronger
existing enchantments. Damage multipliers are 1.15/1.35/1.55;
projectiles retain the upgrade and Double Tap strength at firing time.
Tier two adds a short cleave to melee weapons, piercing to arrows, and an impact
wave to thrown tridents. Returning tridents are delivered back to their owner
when the round clears; run projectiles are removed when their owner leaves.

Three plane parts are scattered through quarry, foundry and ramparts.
Each player carries one part and installs it at the airstrip. Leaving
returns undelivered cargo. Power plus all three parts permits a flight to the
offshore forge. Players board individually over five seconds; rounds continue
and enemies redeploy toward occupied areas with their health and counts intact.
A return station operates independently. Later departures require three fuel
pickups and at least one cleared round since the previous departure.

Defeated enemies can drop Max Ammo, Double Emeralds (30 seconds), Insta-Kill
(15 seconds), Nuke, or Carpenter. Drops have an 8% chance, a shared 30-second
cooldown, and at most one pickup outstanding for 20 seconds. Nuke and Insta-Kill
exclude bosses. Carpenter repairs barricades and supplies modest team healing.

Debug rounds 1–1,000 use the ordinary shared lobby and ready countdown. Teammates
join without debug permission. Presets use starter equipment at 1–3, iron at
4–7, Pack-a-Punch I at 8–14, II at 15–24 and III at 25+, with matching supplies,
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

Rustworks occupies x=1920–2111, z=2112–2311, y=68–103; its exit pad is x=1918,
z=2132, y=72–74. Provisioning targets use the map ID: `/rustworks preview`,
`/rustworks apply <token>`, and `/rustworks restore <token>`. Disable Rustworks
in its own configuration before provisioning. Previews retain the same wilderness,
block-budget, backup, and ownership checks as Settlement; do not enable it until
the map has been installed and verified. Its region does not overlap Settlement.

Arena startup loads its configured region chunks asynchronously before checking
loot chest blocks or clearing remnants of an interrupted game. Admission stays
closed if any chunk or chest is unavailable. Vault rewards stay in the database
while delivered items and their receipt await a player-data save; a later login
retires those rows. A reward whose whole item bundle does not fit remains queued
until the player frees inventory space.

## Conventions

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

Paid random teleports save an attempt in the QoL database before their keyed
charge. The attempt remains until the teleport succeeds or a keyed refund is
committed. Module startup and player joins reconcile unfinished attempts against
the economy ledger. If a process stops after teleport delivery but before the
attempt is cleared, recovery may refund a delivered teleport; it never drops a
known charge without either delivery or compensation.
The cooldown is recorded before loading destination chunks, so a cancelled
warmup, failed search, or refused charge cannot repeat costly scans immediately.
The selected landing chunk has a reference-counted plugin ticket through the
warmup, charge, and teleport so the final move does not reload it on the main
thread.

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

- `rwf.yml`: the world, the lobby and spectator points, how matches fill and
  start (`minHumans`, `targetCombatants`, `maxCombatants`, the 90 s countdown,
  the 30 s no-humans abort), the ported rule constants pinned to the code,
  rewards (3 win / 1 lose scaled by the human share, a daily cap, the minimum
  match length), recording and the load-test switch.
- `rwf/kits.yml`: the kits as the operator sees them; it must describe
  `KitBook` kit for kit or the module refuses to start.
- `rwf/maps/<id>/map.yml` and `blocks.schem`: a map's teams, spawns, bombs,
  nukes, region and the SHA-256 of its Sponge v3 schematic. The module pastes
  every map at enable and whenever the world's blocks stop matching the hash,
  20,000 blocks a tick with admission closed meanwhile. `training-yard` is a
  generated 64x16x64 sample; its generator lives in the module's test sources.
- `rwf/maps/<id>/nav.rwfnav` and `nav.summary.json`: the map's baked navigation
  data for the bots, produced offline by the `rwfmap` tool (see Maps below).

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

Commands: `/rwf join` (gated by the managed Flipt flag
`the-storm-rwf-enabled`; a missing `FLIPT_URL` or `FLIPT_ENVIRONMENT` keeps it
closed), `/rwf leave`, `/rwf kit <id>`, `/rwf who`, `/rwf spectate` and
`/rwf spectate next` (`thestorm.rwf.spectate`, granted by default, behind the
same Flipt flag), and for `thestorm.rwf.admin`: `/rwf admin status`,
`/rwf admin repair`, `/rwf admin loadtest <n>` (only when `loadtest.enabled`)
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
`RecordCodec` (format version 2; `RecordCodecTest` holds a golden copy). Tabs,
newlines and backslashes inside a field are escaped with a backslash. Ticks
count from the moment the match went live, at 50 ms each.

| Tag | Row                                                                                                                                                          | When                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `H` | version, match id, map id, map block SHA-256, seed, rules version                                                                                            | once, first                                              |
| `R` | pseudonym, team, kit, bot (`true`/`false`)                                                                                                                   | once per combatant, after `H`                            |
| `E` | tick, kind, subject, detail                                                                                                                                  | each match event                                         |
| `F` | tick, pseudonym, x, y, z (1/32 block), yaw (0-255), pitch (-64..64), health (1/4 point), held slot, flags (sneak 1, sprint 2, fire 4, block 8)               | humans every tick (20 Hz), bots every other tick (10 Hz) |
| `N` | tick, pseudonym, keys (forward 1, back 2, left 4, right 8, jump 16, sneak 32, sprint 64), yaw (0-35999), pitch (-9000..9000), both in hundredths of a degree | humans only, every tick                                  |
| `I` | tick, pseudonym, kind, target                                                                                                                                | each bot intent                                          |
| `X` | tick, winner or `-`, reason                                                                                                                                  | once, at the end                                         |
| `P` | pseudonym, credits                                                                                                                                           | once per paid human, after `X`                           |

`N` keys are the movement keys the client last reported through Paper's
`PlayerInputEvent`; a player who has reported nothing since logging in holds
nothing. `F` and `N` rows are per-tick samples: when the writer falls more
than 20,000 samples behind, new ones are dropped and counted in
`rwf_match.dropped_frames`. Every other row is always written. A reader
refuses any version other than its own instead of guessing at old rows.

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

Filling a match: the `Director` drafts personalities from
`rwfbots/personalities/*.yml` (never one whose name an online human uses),
keeps the most balanceable of a few drafts, shifts every bot's skill so the
median bot sits a little under the median human (`MatchShift`), and gives
each a kit from its weights over `draft.kits`; a personality whose weights
name none of those kits (its favourites ship later) still drafts and plays one
of them, chosen uniformly. Each bot picks that kit when it joins. Ratings are OpenSkill; after a match with a result every team goes
through one update and each bot's record (matches, wins, kills, deaths,
plants, defuses, mu, sigma, last seen) is written to
`rwfbots_personality_stats`. Humans play at the default rating.

Configuration and content under `server/owned/plugins/TheStorm`:

- `rwfbots.yml`: think rates, governor thresholds, the lever curve table
  (pinned to `Lever.java`), the kits bots may draft, the LOS ray budget and
  trace recording.
- `rwfbots/personalities/<id>.yml`: the personas (see its README): about
  two hundred, spread evenly over twelve archetypes (rusher, lurker, sniper,
  bomb diver, anchor, flanker, support, duelist, hunter, turtle, troll,
  tactician) and five skill bands. The archetype is content only; play
  differs through the style, role, kit and lever values the generator
  derives from it. Each persona also carries a voice, chat lines per
  moment, quirks, rivals and a bio, authored in `scripts/bots/enrichment/`;
  the module validates them but does not speak them yet.
- `rwf/maps/<id>/nav.rwfnav`: the map's baked navigation artifact
  (`NavCodec` format, from the `rwfmap` tool), next to `map.yml` and
  `blocks.schem`. Its `blocksSha256` must equal the map's `blocksSha256`;
  the module compares them when the match chooses the map and runs that map
  humans-only, with a logged error, when the artifact is missing, corrupt,
  unplayable or baked from other blocks.

`/rwfbots debug [bot]` (`thestorm.rwfbots.admin`) prints the governor level,
think and staleness percentiles, the board counters and every bot's plan, or
one bot's levers, decision and refusals.

Decision traces: with `traces.enabled`, every think step appends one
tab-separated `decision` line (tick, bot, epoch, option, plan label,
temperature, draw, quantized features, top utilities, path length) to
`plugins/TheStorm/rwfbots-traces/<matchId>.gz`, written off the main thread;
lines past `queueCapacity` are dropped and counted.
