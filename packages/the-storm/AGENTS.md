# The Storm plugin constraints

Java 25 Paper plugin built with Gradle from `plugin/`. See README.md for the
layout, layering table and commands.

- One plugin, many modules. New gameplay goes in `plugin/modules/<name>/`, never
  in `dist` or `core`. `core` holds only what several modules share.
- Keep `domain` packages pure (JDK + `core.result`). ArchUnit fails the build
  otherwise; do not weaken or narrow those rules to pass.
- Never block the main thread: no JDBC, jOOQ, file or network I/O in
  `adapter.paper`, and never `join()`/`get()` a database future there. Complete
  futures back onto the main thread with `Scheduler.mainThread()`.
- Take time and randomness from `ModuleContext` (`InstantSource`,
  `RandomGenerator`); no `System.currentTimeMillis`, `Instant.now()` or
  `new Random()` in modules.
- Parse config, content and player input once, at the adapter, into records
  with `StrictYaml`. No defaults or fallbacks for missing or unknown values.
- The plugin never writes files the repository owns (config and content YAML).
- Tests must not be skipped; MockBukkit gaps are fixed by moving logic into the
  pure domain or covered by the real-server integration tests.
- No `@SuppressWarnings`, `NOPMD` or `CHECKSTYLE:OFF`; the repository
  suppression check rejects them. Fix the finding instead.
- Change dependencies only in `plugin/gradle/libs.versions.toml`, then refresh
  locks and verification metadata (README.md).
- Copying from GPL/LGPL plugins is allowed with the upstream header kept;
  Citizens (OSL-3.0), Towny and unlicensed code are clean-room only.

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/the-storm
```
