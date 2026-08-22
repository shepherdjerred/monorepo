# @tasknotes/fixtures

Language-neutral fixtures. **These corpora are the anti-drift mechanism**
between the TypeScript implementation in `packages/tasks-for-obsidian` and the
Rust core in `packages/tasknotes-core`: both run these exact files and must
produce identical results.

The package holds data only — no code, no dependencies — so the Rust crate can
consume it without the React Native app package existing.

```
schema/scenario.schema.json   # JSON Schema (draft 2020-12) for the sync format
scenarios/<id>.json           # one sync scenario per file; file name === `id`
recurrence/                   # the recurrence differential corpus (separate format)
```

The rest of this file documents the **sync scenario** format in `scenarios/`.

## Format

Every scenario is `{ setup, actions[], assertions[] }` over tagged unions —
`kind` for actions, assertions and values, `type` for dispatch inputs,
`method` for direct client calls, `by` for task references. Every object is
`additionalProperties: false`, so an unrecognised key is an error rather than
a silently dropped field.

Actions run in order. Assertions are declarative and run afterwards, against
either the final world or a named snapshot (`"at": "<name>"`).

### Vocabulary

Seventeen actions:

| Action                             | Meaning                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `store_restore`                    | load the queue, cached base and id aliases           |
| `server_seed`                      | put tasks into the fake server                       |
| `server_offline` / `server_online` | total outage on/off                                  |
| `server_fail_next`                 | inject a one-shot failure for one method             |
| `server_inject_edit`               | a concurrent Obsidian edit landing server-side       |
| `clock_set`                        | move the manual clock                                |
| `dispatch`                         | a user mutation; `as` binds the optimistic task id   |
| `sync_now`                         | drain + pull and wait; `as` binds the result         |
| `request_sync`                     | fire-and-forget trigger                              |
| `scheduler_fire_next`              | fire the oldest armed retry timer                    |
| `engine_dispose`                   | retire the engine (API client swapped)               |
| `retry_dead_letter`                | user taps Retry on a parked command                  |
| `client_call`                      | call the server directly, bypassing store and engine |
| `snapshot`                         | capture durable storage **and** observable state     |
| `relaunch`                         | rebuild the client from a snapshot's durable storage |
| `settle`                           | let already-triggered fire-and-forget work settle    |

Seventeen assertions: `result`, `result_field`, `results_field_equal`,
`pending_count`, `queue_pending_equals`, `task_count`, `task_field`,
`task_exists`, `dead_letter_count`, `dead_letter_field`, `last_sync_time`,
`engine_state`, `scheduler_pending`, `call_count`, `call_log`,
`task_id_is_temp`, `deterministic_end_state`.

### Three things worth knowing

**`relaunch` replaces the client only.** The clock and the fake server
survive, because the server is what remembers which `X-Mutation-Id` values it
already applied. A snapshot stays reusable after later actions have run, which
is how `crash-between-ack-and-dequeue-dedup` relaunches from _deliberately
stale_ durable state — the queue comes back holding a command the server has
already applied. `subway-mode-relaunch-and-converge` uses the other mode: a
fresh snapshot, taken at the moment of the crash.

**Errors are data.** An `AppError` serializes as
`{ kind, message, status? }` with `kind` one of `network`, `api`,
`validation`, `not_found`, `connection`. `status` is present exactly on `api`
and `not_found` (always `404`). A `not_found` message keeps the shape its
constructor produces, `"<resource> not found: <id>"`, so it can be taken apart
again.

**`local_naive` clocks are deliberate.** The fake server's legacy
`completeRecurringInstance` branch derives "today" with device-local calendar
getters. Those scenarios pin the clock to a local wall-clock time (noon), not
an absolute instant, so they reproduce identically in any timezone. Use
`epoch_ms` everywhere else.

## Regenerating the JSON Schema

`schema/scenario.schema.json` is **generated**, not hand-written. Its source of
truth is the Zod schema at
`packages/tasks-for-obsidian/src/data/sync/__tests__/fixtures/schema.ts`, and
`fixtures.test.ts` fails when the two drift. After changing the format:

```bash
cd packages/tasks-for-obsidian
UPDATE_FIXTURE_SCHEMA=1 bun run test src/data/sync/__tests__/fixtures.test.ts
```

## Deliberate coverage gaps

- **Promise reference identity is not portable.** The "concurrent syncNow
  calls coalesce" scenario asserts `expect(b).toBe(a)` — the same allocated
  result object — which no second implementation can honour. It stays
  TypeScript-only in
  `packages/tasks-for-obsidian/src/data/sync/__tests__/non-portable.test.ts`.
  Its portable half is covered by `reconnect-delivers-each-mutation-once`.
- **`discardDeadLetter` has no scenario.** The original suite never exercised
  it either, so no `discard_dead_letter` verb exists; add both together.
