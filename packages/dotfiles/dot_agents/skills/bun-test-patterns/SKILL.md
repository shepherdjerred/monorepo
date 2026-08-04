---
name: bun-test-patterns
description: Current Bun test runner guidance for discovery, isolation, parallelism, sharding, changed tests, mocks, timers, snapshots, coverage, DOM Testing Library, and integration teardown. Use when writing, reviewing, or configuring tests run by `bun test`.
---

# Bun Test Patterns

Test one coherent behavior with strong assertions, make shared state explicit, and choose concurrency, isolation, or parallel workers deliberately. A passing runtime test does not replace TypeScript type-checking.

## Current baseline

Verified against Bun 1.3.14 on 2026-08-03:

```bash
bun --version
bun test --help
```

Bun 1.3.13 added file isolation, worker-process parallelism, deterministic sharding, and Git-aware changed-test selection. Bun 1.3.14 fixed isolation/parallel crashes and a `--changed` false negative involving tsconfig path aliases. Use 1.3.14 or newer for those features.

Read [references/releases.md](references/releases.md) for the 64-page research ledger and first-party documentation contradictions. Read [references/runner-and-configuration.md](references/runner-and-configuration.md) for discovery, execution, retries, reporters, coverage, lifecycle, snapshots, and timers. Read [references/mocks-and-types.md](references/mocks-and-types.md) for mock lifecycle, module boundaries, and `expectTypeOf`. Read [references/dom-and-integrations.md](references/dom-and-integrations.md) for Happy DOM, Testing Library, Prisma, servers, and resource teardown.

## Execution dimensions

| Mode | Scope | Boundary |
| --- | --- | --- |
| Default | Files and tests sequential in one process | Global/module state can cross file boundaries |
| `--concurrent` / `test.concurrent` | Async tests overlap within files | Default maximum concurrency is 20; concurrent tests cannot use `onTestFinished` |
| `--isolate` | Fresh global per file in one process | Drains microtasks and cleans sockets, timers, and subprocesses between files |
| `--parallel=N` | Files run in worker processes | Implies isolation; choose N from CI resources |
| `--shard=M/N` | Deterministic path-sorted round-robin partition | One-based shard index; every shard must run |

Isolation changes cross-file leak risk, but it does not excuse missing cleanup inside a test.

## Discovery and exact paths

Current canonical discovery includes `test`, `spec`, and test-directory conventions across JavaScript, JSX, TypeScript, TSX, MJS, CJS, MTS, and CTS.

Positional arguments are substring filters. Prefix an exact relative path:

```bash
bun test ./src/math.test.ts
```

Do not call a positional value a glob. Use documented config/CLI ignore patterns for path selection.

## Selection and flake diagnosis

```bash
bun test --changed
bun test --changed=origin/main
bun test --randomize --seed 12345
bun test --rerun-each 20
bun test --retry 1
bun test --bail=1
```

`--changed` includes staged, unstaged, and untracked Git changes or compares against a supplied ref. With watch mode, selection is rebuilt each restart.

Retries can mask flakes. Keep zero as the normal gate; use a narrow retry only with captured reporting and remediation. Reproduce randomized failures with the printed seed.

`test.only()` restricts the run only when `bun test --only` is used. Do not leave focused tests as an implicit gate.

## Configuration

Current coverage threshold shape is plural and fractional:

```toml
[test]
coverage = true
coverageThreshold = { lines = 0.80, functions = 0.80, statements = 0.80 }
```

`branch` is not a documented threshold field. `timeout` is a CLI or per-test value, not a documented `[test]` key.

Other current settings include root and path ignores, `concurrentTestGlob`, randomization and seed, retry/rerun, coverage reporters, test-file exclusion, and coverage path ignores.

## Lifecycle and cleanup

Use async hooks when cleanup returns a promise. `onTestFinished` runs after `afterEach` but is unavailable in concurrent tests.

Restore timers, spies, environment, servers, clients, databases, and temporary files in the narrowest owner. The default runner shares process state between files.

Required CI configuration must fail fast. Do not use `skipIf(!process.env.DATABASE_URL)` to silently remove a suite CI is expected to run. `process.env.CI` is a string; compare explicit values rather than treating `"false"` as false.

## Assertions

Use as many strong assertions as prove one behavior. Avoid weak truthiness when an exact value, status, state transition, or side effect is available.

Supported Bun-specific matchers include `toBePositive`, `toContainAllKeys`, `toInclude`, and singular `toSatisfy`. These claimed matchers do not exist: `toIncludeAllMembers`, `toIncludeAnyMembers`, and `toSatisfyAll`.

For arrays:

```typescript
expect(received).toEqual(expect.arrayContaining(expected));
expect(received).toHaveLength(expected.length);
expect(received.some(predicate)).toBe(true);
expect(received.every(predicate)).toBe(true);
```

## Mocks

Mock semantics differ:

- `clearAllMocks`: call history only.
- `resetAllMocks`: call history and implementations.
- `restoreAllMocks` / `mock.restore`: restore spies/functions.
- None of these undo `mock.module` overrides.

Define mock signatures that match calls:

```typescript
const calculate = mock((first: string, second: string) => 42);
expect(calculate("a", "b")).toBe(42);
```

Prefer dependency injection or a complete module mock registered before the first import. Importing the real module to spread a partial mock already executes its side effects.

## Type tests

`expectTypeOf` is a runtime no-op. `bun test` can pass when an intended type relation is wrong. Put type assertions in a file included by the project checker and run:

```bash
bunx tsc --noEmit
```

In this monorepo, use the package's focused typecheck task.

## Timers and dates

Use `jest.useFakeTimers`, timer advancement/run/clear/count helpers, and `setSystemTime` for deterministic time. Always restore real timers and time in cleanup, especially in shared-process mode.

## Snapshots

An empty call lets Bun insert an inline snapshot:

```typescript
expect(result).toMatchInlineSnapshot();
```

Use property matchers for nondeterministic IDs/timestamps. Keep snapshots focused and review updates. Never update snapshots automatically merely because CI failed.

## DOM interaction

Prefer the dedicated Bun Testing Library setup with explicit `expect.extend(matchers)` and type declaration merging. Use `user-event` for realistic async interactions:

```typescript
const user = userEvent.setup();
await user.click(button);
```

Use `fireEvent` only for low-level events user-event cannot model.

## Integration safety

- Validate a dedicated ephemeral database identity before destructive cleanup. Do not run unrestricted `deleteMany()` against an environment-selected database.
- Prefer transactions or unique per-test records.
- Await `server.stop()`. Use forced stop only when tests must close active traffic immediately.
- Close Prisma, SQL, Redis, HTTP, file, worker, and timer resources in their owner.
- Do not skip required integration tests because an artifact or credential is missing; build/provision the prerequisite or fail with a clear error.

## Review checklist

- Verify Bun 1.3.14+ and current CLI help.
- Use exact `./path` selection and current discovery extensions.
- Distinguish concurrent tests, file isolation, parallel workers, and sharding.
- Keep retry zero normally and capture randomization seeds.
- Use the current fractional coverage schema.
- Restore timers/spies and understand that module mocks persist.
- Type mock signatures correctly and register module mocks before import.
- Run an actual TypeScript checker for type tests.
- Prefer user-event and explicit jest-dom setup.
- Protect databases and await async server/client teardown.
