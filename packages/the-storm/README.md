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
| `plugin/build-logic/`              | Convention plugins: compiler strictness, formatting, PMD, tests, jOOQ codegen                                          |
| `plugin/gradle/libs.versions.toml` | Every dependency and plugin version                                                                                    |
| `server/`                          | The `minecraft-tsmc` server image: pinned jars, config bundle and patches (see `server/README.md`)                     |

## Commands

Gradle comes from mise (`.mise.toml`); there is no wrapper.

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/the-storm
cd packages/the-storm/plugin
mise exec -- gradle check                  # everything, including PMD and JaCoCo
mise exec -- gradle spotlessApply          # format
mise exec -- gradle :dist:runServer        # local Paper 26.2 with the plugin
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

| Package            | May use                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`           | The JDK, core's `Result`, and its own module's `domain` and `app` value types. No Paper, Adventure, jOOQ, Jackson, JDBC, network or other modules                |
| `app`              | Use cases and the ports other modules may call                                                                                                                   |
| `adapter.paper`    | Listeners and commands. Main thread only, so no JDBC, jOOQ, file or network I/O                                                                                  |
| `adapter.db`       | jOOQ repositories over the module's own tables                                                                                                                   |
| `adapter.citizens` | `rwfbots` only: the single package allowed to use Citizens, and only `net.citizensnpcs.api` and `net.citizensnpcs.trait`. Main thread only, like `adapter.paper` |

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

Commands: `/rwf join` (gated by the managed Flipt flag
`the-storm-rwf-enabled`; a missing `FLIPT_URL` or `FLIPT_ENVIRONMENT` keeps it
closed), `/rwf leave`, `/rwf kit <id>`, `/rwf who`, and for
`thestorm.rwf.admin`: `/rwf admin status`, `/rwf admin repair` and
`/rwf admin loadtest <n>` (only when `loadtest.enabled`). Joining snapshots a
player's belongings through the shared crash-safe snapshot machinery and
restores them on leave, death, disconnect or the next login.

Matches are recorded under pseudonyms (positions, actions, results) to
`plugins/TheStorm/rwf-recordings/yyyy/MM/dd/<matchId>.rwfrec.gz` for review and
bot training; every joining human is told so on entry. Pseudonyms are
HMAC-SHA256 over the salt in `RWF_RECORDING_SALT`, which must be set when
`recording.enabled` is true. Recordings are pruned by age and size at enable.

Payouts go through an outbox in `rwf_match_player` and the economy's keyed
transfers (`rwf:<matchId>:<uuid>`), so a crash between the match ending and
the transfer pays exactly once on the next enable. Bots are never paid.

Bots are optional: the module declares the `BotRoster` port and looks it up
when a countdown starts; the `rwfbots` module provides it. Bots act only
through the `CombatantActions` port, which validates reach, line of sight and
the hit window as it would for a human before acting through the server API.
`MatchView` and `MatchEvents` publish the read model and transitions.
