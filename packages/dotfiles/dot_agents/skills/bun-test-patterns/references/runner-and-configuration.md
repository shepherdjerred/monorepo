# Bun test runner and configuration

Read this when configuring discovery, concurrency, isolation, parallelism, sharding, changed tests, coverage, reporters, lifecycle, timers, or snapshots.

## Defaults and new modes

Canonical runtime/discovery pages describe the default sequential single-process model. Bun 1.3.13 release notes and current CLI help add optional `--isolate`, `--parallel`, `--shard`, and `--changed`; the main docs have not fully caught up.

`--parallel` implies isolation. `--concurrent` overlaps async tests within files and uses `--max-concurrency`; it is a different dimension.

## Configuration

Use documented keys such as `root`, `pathIgnorePatterns`, `concurrentTestGlob`, `randomize`, `seed`, `retry`, `rerunEach`, `coverage`, `coverageReporter`, `coverageSkipTestFiles`, and `coveragePathIgnorePatterns`.

Coverage thresholds are fractions for `lines`, `functions`, and `statements`.

## Reporters

Bun provides console, dots, and JUnit reporting. Configure output paths intentionally and preserve failure exit status.

## Lifecycle

Hooks can be synchronous or async. Preload files establish global setup. `onTestFinished` runs after `afterEach` and is not available for concurrent tests.

## Timers

Fake-timer APIs include activation, real-timer restoration, time advancement, running all or pending timers, clearing timers, and counting pending timers. `setSystemTime` controls the mocked clock.

## Todo and skip

Do not use skip as incomplete-work tracking. `test.todo` can be deliberate tracked work; run `bun test --todo` periodically because an unexpectedly passing todo fails that mode.

## Primary documentation

- [Test runner](https://bun.com/docs/test)
- [Writing tests](https://bun.com/docs/test/writing-tests)
- [Discovery](https://bun.com/docs/test/discovery)
- [Configuration](https://bun.com/docs/test/configuration)
- [Runtime behavior](https://bun.com/docs/test/runtime-behavior)
- [Lifecycle](https://bun.com/docs/test/lifecycle)
- [Dates and times](https://bun.com/docs/test/dates-times)
- [Snapshots](https://bun.com/docs/test/snapshots)
- [Coverage](https://bun.com/docs/test/code-coverage)
- [Reporters](https://bun.com/docs/test/reporters)
- [Concurrent test glob](https://bun.com/docs/guides/test/concurrent-test-glob)
- [Bail](https://bun.com/docs/guides/test/bail)
- [Rerun each](https://bun.com/docs/guides/test/rerun-each)
- [Watch mode](https://bun.com/docs/guides/test/watch-mode)
- [Timeout](https://bun.com/docs/guides/test/timeout)
- [Todo tests](https://bun.com/docs/guides/test/todo-tests)
- [Coverage threshold](https://bun.com/docs/guides/test/coverage-threshold)
