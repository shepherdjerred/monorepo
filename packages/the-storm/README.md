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

Towns protection loads persisted claims before registering listeners. If a town
save fails, it reloads persisted state before accepting another change. If that
reload also fails, the server shuts down because its in-memory protection state
may no longer reflect stored claims. A denied join or respawn relocates only to
an already loaded, permitted location; when none exists, the player is
disconnected rather than triggering terrain generation in the arrival event.

The world module requires every world in `server/owned/plugins/TheStorm/world.yml`
to be provisioned and loaded before TheStorm enables. A missing world stops the
server rather than generating terrain during plugin startup. Keep the world
module disabled until an operator has provisioned `wilds` (large biomes),
`peaks` (amplified), and `mining` (normal), and confirmed their loaded names and
presets. The plugin checks the loaded name and NORMAL environment; Paper does
not expose reliable preset metadata for an existing world, so preset acceptance
remains an operator check. A mining reset must likewise make the replacement
world available before TheStorm enables again.

### Main-world crier

The world module also owns an on-demand `/crier` bulletin. Its separate
`world.yml` `crier.enabled` setting ships as `false`; the world module itself
also remains disabled in `config.yml`. The `/crier` command registers with the
module and evaluates `the-storm-crier-enabled` in Flipt for each player. Both
the typed file safety gate and the managed flag must allow the command; a
missing or failed Flipt evaluation leaves it unavailable. The managed flag is
enabled in beta and defaults off in production; Java flag IDs are checked
against the shared inventory during Gradle compilation. Once enabled, the
command works only for players in `world`. It reports observed weather and
game time, then rotates one historical Storm fact by full game day. The archive
notes come from
the recovered Storm history (old spawn landmarks, the Bridge Hobo quest, the
2015 Easter hunt, and Braxton's bank). It makes no claim that those landmarks
or quests exist in the current world. There is no timer or automatic broadcast.

`world.yml` also keeps `ambient.enabled` off. When enabled, a player arriving
within the configured radius and height of the `world` spawn hears one crier
bark, grounded in current weather and a rotating archival fact. Join, world
entry, and movement into the spawn area can trigger it, at most once per
Pacific date per player. The last-heard date persists on the player. This is
new authored behavior inspired by the old windmill and Storm history, not a
recovered NPC script. It has no recurring task or server-wide broadcast.

## Conventions

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
The selected landing chunk has a reference-counted plugin ticket through the
warmup, charge, and teleport so the final move does not reload it on the main
thread.

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

## Grave recovery

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
