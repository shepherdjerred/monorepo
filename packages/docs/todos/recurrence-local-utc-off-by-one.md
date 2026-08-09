---
id: recurrence-local-utc-off-by-one
type: todo
status: planned
board: true
verification: human
disposition: active
source_marker: false
---

# Recurring tasks are a day late for users east of Greenwich

## Summary

`packages/tasks-for-obsidian/src/domain/recurrence.ts` builds a **local-midnight**
`Date` and hands it to `@tasknotes/model`, which reads it back with **UTC** getters.
In any UTC-positive timezone that is the previous calendar day, so every recurring
task's occurrence — and its completion checkbox — is off by one.

Found during Phase 0c of the native macOS port while building a recurrence parity
corpus. This is a **pre-existing bug in the shipping iOS app**, not something the
port introduced.

## Mechanism

`localDate()` (`recurrence.ts:121`) does:

```ts
return new Date(y, m - 1, d); // LOCAL midnight
```

and passes it to `shouldShowRecurringTaskOnDate` (`recurrence.ts:117`). The model
resolves dates entirely in UTC: it strips `DTSTART:`, substitutes
`Date.UTC(y, m, d, 0, 0, 0, 0)`, and formats results with `getUTC*`. It never sets
`tzid`.

In Tokyo (UTC+9), local midnight on 2026-01-05 is `2026-01-04T15:00Z`, so
`getUTCDate()` returns **4**.

## Reproduction

Confirmed independently across four zones with
`{recurrence: "FREQ=WEEKLY;BYDAY=MO", scheduled: "2026-01-05"}` (a Monday):

| TZ                    | `occursOn(…, "2026-01-05")` | `occursOn(…, "2026-01-06")` |
| --------------------- | --------------------------- | --------------------------- |
| `UTC`                 | `true` ✅                   | `false`                     |
| `America/Los_Angeles` | `true` ✅                   | `false`                     |
| `Asia/Tokyo`          | **`false`** ❌              | **`true`** ❌               |
| `Pacific/Kiritimati`  | **`false`** ❌              | **`true`** ❌               |

`getEffectiveTaskStatus` shifts identically, so the checkbox state is wrong too —
not just the list membership.

## Why it survived

UTC-negative zones are unaffected: local midnight is still the same UTC calendar
day. The maintainer is in US Pacific, so the bug is invisible in normal use and in
CI (which runs UTC). Only users east of Greenwich see it.

## Remaining

- [ ] Decide the fix: make `localDate()` construct a UTC midnight (`Date.UTC(...)`)
      to match what the model reads, **or** stop round-tripping through `Date` at
      the boundary entirely and pass the `YYYY-MM-DD` string through.
- [ ] Audit the other `new Date(y, m-1, d)` / `getFullYear`-style call sites in
      `recurrence.ts` and `lib/dates.ts` for the same local-vs-UTC mismatch.
      `localTodayYmd()` (`recurrence.ts:39`) is _intentionally_ local — the
      distinction is that it means "the user's today", not "a date on the rrule
      timeline". Confirm which callers want which.
- [ ] Add a regression test that runs the recurrence suite under at least one
      UTC-positive timezone (`TZ=Asia/Tokyo`). CI currently runs UTC only, which
      is why no existing test catches this.
- [ ] Verify against a real vault before shipping — the corpus asserts the _model's_
      UTC contract, not the app's current shifted behaviour.

## Notes for the Rust port

The Phase 2 hand-rolled engine is specified as **naive-date arithmetic with no
timezone**, which is the correct contract and matches the model. The corpus at
`packages/tasknotes-fixtures/recurrence/` deliberately encodes that contract, **not**
the app's shifted behaviour — so the Rust engine will be correct and the TypeScript
app will disagree with it until this is fixed. That disagreement is expected and is
this bug, not a parity failure.

## Comment Log

- 2026-08-08: Filed. Found by the Phase 0c corpus agent, confirmed independently
  across four timezones. Not fixed inline because it is outside the macOS port's
  scope and touches shipping iOS behaviour that deserves its own change and its own
  verification.
