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

## Modules

Every module implements `StormModule` and is listed in `dist`'s `Modules`
(a test fails if one is missing). `plugins/TheStorm/config.yml` must name every
module under `modules:` with `true` or `false`; a missing or unknown key stops
the plugin. The repository owns that file; the plugin never writes it.

Inside a module, packages are layered:

| Package         | May use                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`        | The JDK, core's `Result`, and its own module's `domain` and `app` value types. No Paper, Adventure, jOOQ, Jackson, JDBC, network or other modules |
| `app`           | Use cases and the ports other modules may call                                                                                                    |
| `adapter.paper` | Listeners and commands. Main thread only, so no JDBC, jOOQ, file or network I/O                                                                   |
| `adapter.db`    | jOOQ repositories over the module's own tables                                                                                                    |

Modules reach each other only through the other module's `app` package, and
schedule main-thread work only through `core.schedule.Scheduler`. ArchUnit
tests in `architecture/` enforce all of this.

## Quest content

The `quests` module reads authored quests, board templates, regions, factions,
and hooks from `server/owned/plugins/TheStorm/quests/`. Its runtime settings are
in `server/owned/plugins/TheStorm/quests.yml`. Content is validated against the
loaded Minecraft registries and NPC directory when the module starts; invalid
content stops startup with file and field errors. The objective, condition, and
action syntax is defined by `quests/domain/content/Dsl.java`.

Quest offers, commands, and progress are restricted to the configured main
world (`world`). Regions must resolve to that world's registry key. Board and
NPC offers use the same eligibility checks: prerequisites and repeat
cooldowns are evaluated against player state before an offer appears. NPC
dialogue gives story and track quests priority, then rotates offers of equal
priority in a stable order for each player and local day. Hand-ins and active
choices remain ahead of new offers.

Board draws keep a snapshot of their objective and reward data in SQLite so edits
to templates do not change quests already assigned to players. Shipped content
counts and references are checked when the quest module is built.

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

## Conventions

The economy `Wallets` port supports a stable `KeyedTransfer` for compensating
payments. It stores the operation key with the ledger row, returns the same
receipt for an identical retry, and rejects reuse of the key with different
transfer details. `receiptFor` lets a caller reconcile an uncertain result.
Ordinary unkeyed transfers keep their existing behavior.

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
- Code copied from GPL/LGPL plugins keeps its license header.
