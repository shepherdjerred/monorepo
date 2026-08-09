---
id: recurrence-local-utc-off-by-one
type: todo
status: awaiting-human
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

- [x] Fixed by constructing UTC midnight. The model's public signature takes a
      `Date`, so the string cannot be passed straight through; the conversion is
      now a single audited pair, `naiveDate` / `naiveYmd`, both UTC.
- [x] Audited the neighbouring call sites. `localTodayYmd()` stays local and is
      documented as "the user's today". `nextOccurrenceAfter` was the one real
      misuse — it formatted a constructed `Date` with `localTodayYmd`, so its
      day walk is now UTC millisecond arithmetic. Everything in `lib/dates.ts`
      and `lib/calendar.ts` parses local and formats local against the device's
      own calendar and is correct as written.
- [x] Added `src/domain/recurrence-timezone.test.ts`, which sets `Bun.env.TZ`
      itself across UTC, US Pacific, Tokyo and Kiritimati and asserts the
      offset it actually got, so the guard holds under UTC CI.
- [x] Differentially verified against the corpus, which asserts the _model's_
      UTC contract rather than the app's shifted behaviour. Real-vault
      confirmation is the acceptance step below.

## Human Verification

1. Set an iOS device or simulator to a UTC-positive timezone (Tokyo is enough;
   Kiritimati is the extreme) and point the app at a real vault holding a
   recurring task whose next occurrence is today.
2. Open Today. **Expected:** the task appears on its own occurrence day, not the
   day after, and tapping its checkbox leaves it checked on that same day.
3. Set the device back to US Pacific and confirm nothing regressed there.

Accept if both zones agree on the occurrence day; reject if either shows the
task a day off.

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
- 2026-08-08: Fixed in `packages/tasks-for-obsidian/src/domain/recurrence.ts`.
  Differentially checked the app's `occursOn` against every case in
  `packages/tasknotes-fixtures/recurrence/corpus.jsonl` (18,766 probes per zone)
  under UTC, `America/Los_Angeles`, `Asia/Tokyo` and `Pacific/Kiritimati`:
  10,783 mismatches per UTC-positive zone before the fix, zero after, in all four.
  The fix moves the app **toward** the corpus, as the corpus predicted. The unit
  suite is green under `TZ=UTC`, `TZ=Asia/Tokyo` and `TZ=Pacific/Kiritimati`.
