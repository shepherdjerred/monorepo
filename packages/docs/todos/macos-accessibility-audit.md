---
id: macos-accessibility-audit
type: todo
status: planned
board: true
verification: agent
disposition: active
---

# macOS app: 19 accessibility-audit findings

`performAccessibilityAudit()` was wired up in Phase 11 and ran against the Inbox
screen for the first time. It reported **19 issues on that one screen**, so the
audit calls are not yet in the committed flows: a suite that is red on arrival
gets ignored, and a suite whose audit has been narrowed until it passes is worse
than one with no audit at all.

This is the audit working. The plan calls it _"the highest value-per-line item in
the whole plan"_ and it justified that on its first run.

## What it found

Collected by running the audit with a handler that records every issue instead of
throwing on the first, against **Inbox only** — every other screen is unmeasured.

| Count | Issue                           |
| ----- | ------------------------------- |
| 11    | Element has no description      |
| 6     | Contrast failed / nearly passed |
| 2     | Action is missing               |

⚠️ **"Contrast failed" needs judgement, not obedience.** Several of these are
likely to be the deliberately de-emphasised treatments this app uses to mean
something: dimmed priority and recurrence marks on a retired row, `.secondary`
on a completed title, the muted token `✕`. Where the low contrast _is_ the
signal, the fix may be to give the element a description carrying the same
meaning rather than to raise its contrast and flatten a distinction the design
depends on. Decide per element; do not bulk-adjust colours to clear a count.

## A second finding, from the same run

**`AccessibilityIdentifier.detail(_:)` never reaches the accessibility tree.**
The detail pane renders as an unidentified `Group`, so a UI test cannot address
it. This is precisely the gotcha the plan warns about — an identifier applied to
a SwiftUI container is pushed down onto its child text elements and leaves the
container unidentified — and it means the detail half of the identifier module is
currently decorative.

`NavigationUITests` asserts on the **window title** instead, which is a real
oracle (it is what the user reads and what window restoration persists), with the
reason recorded at the call site. That is a workaround, not the fix.

## Remaining

- [ ] Attribute each of the 19 issues to a specific element; the audit reports a
      type and a description but the run above did not capture element identity.
- [ ] Fix the 11 missing descriptions. Expect most to be decorative glyphs that
      want `.accessibilityHidden(true)` rather than a label — a decoration that
      announces itself is as bad as a control that does not.
- [ ] Rule on each contrast finding individually, per the warning above.
- [ ] Fix the 2 missing actions.
- [ ] Fix `AccessibilityIdentifier.detail(_:)` so the container is addressable,
      then switch `NavigationUITests` back to asserting on it.
- [ ] Audit the screens that have never been measured: Board, the inspector,
      QuickAdd, Pomodoro, Time Report, Settings.
- [ ] Re-add `try app.performAccessibilityAudit()` to every flow once green, so
      the gate is permanent rather than a one-off sweep.

## Comment Log

- 2026-08-09: Found on the first run of the audit, during Phase 11. Recorded
  rather than fixed in place because attributing and fixing 19 issues across an
  unmeasured surface is its own pass, and because filtering the audit to get a
  green suite would have destroyed the only mechanism that found them.
