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
world (`world`). Regions must resolve to that world's registry key. Board
draws keep a snapshot of their objective and reward data in SQLite so edits to
templates do not change quests already assigned to players. The content
currently includes 23 imported historical quests; additional anthology content
is tracked in the quest PR rather than this reference.

Quest state and pending world rewards commit in one SQLite transaction. Item
hand-ins are taken while the player is present; a failed state write returns
them immediately or at the next main-world join. The world reward outbox then
delivers actions in order when the player is online and records each delivery.
If a process stops after an action runs but before its receipt is written,
that action can be retried on the next join.

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
