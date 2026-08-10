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

### ⚠️ Re-run with element identities, 2026-08-09 — two earlier guesses were wrong

The first pass recorded only issue _types_. Re-running with
`issue.element` captured shows what they are about, and it is not what was
assumed above.

**The two missing actions are not the task row and the sidebar row.** They are
`red.sjer.tasknotes.query.filter` and `red.sjer.tasknotes.query.sort` — both
SwiftUI `Menu`s, reported as _"missing accessibility action support equivalent to
click/tap inputs"_. The rows were never flagged.

**Most "no description" findings are containers, several of them created by the
identifier fix itself.** Adding `.accessibilityElement(children: .contain)` makes
a container a real element in the tree, and an unlabelled container is then
reported. The panes we own have since been labelled. What remains at the same
frames as `NavigationSplitView`'s own columns, the window group, and `List`'s
per-`Section` wrappers is **framework-generated scaffolding this app cannot
label**, which means the audit may not be reducible to zero from our side alone.
That has to be settled before it can be a permanent gate — see Remaining.

**The contrast findings, with their subjects:**

| Subject                              | Reading                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| "No projects yet", "No contexts yet" | sidebar empty states, `.tertiary`                                                     |
| sync-banner detail text              | `.tertiary` over a `.quaternary` fill — the one predicted as a _genuine_ failure      |
| "23 tasks"                           | the list count, `.secondary`, _nearly_ passed                                         |
| a task title                         | a retired row drawn `.secondary` — deliberate signal                                  |
| "No Selection"                       | the inspector's empty state                                                           |
| "Inbox" / "TaskNotes"                | both at the window-title frame; likely the titlebar measured against its own material |

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

- [x] ~~Attribute each of the 19 issues to a specific element.~~ Done 2026-08-09;
      see the re-run above. Two assumptions were wrong.
- [ ] **Decide whether the audit can be a gate at all.** Several "no description"
      findings sit on `NavigationSplitView` columns, the window group and `List`'s
      `Section` wrappers — SwiftUI's own scaffolding, which this app cannot label.
      If they cannot be cleared, the choice is between scoping
      `performAccessibilityAudit(for:)` to the types we _can_ satisfy — an
      explicit, reviewable narrowing — and leaving the audit out entirely. ⚠️ What
      is not acceptable is a per-element ignore list, which is the "filter until
      it passes" shape this project has refused twice.
- [ ] Give the two `Menu`s (`query.filter`, `query.sort`) an accessibility action.
- [ ] Fix the 11 missing descriptions. Expect most to be decorative glyphs that
      want `.accessibilityHidden(true)` rather than a label — a decoration that
      announces itself is as bad as a control that does not.
- [ ] Rule on each contrast finding individually, per the warning above.
- [x] ~~Fix `AccessibilityIdentifier.detail(_:)` so the container is
      addressable.~~ Done 2026-08-09 across 11 files. ⚠️ The defect was worse than
      "the container is unidentified": SwiftUI pushed the identifier down and it
      **replaced** the descendants' own identifiers, so the list, heading, count
      and sync banner all answered to `detail.<section>` and none to their own
      names.
- [ ] Switch `NavigationUITests` off the window-title workaround back to
      asserting on `detail(_:)`, and delete `waitForTitle` if nothing else uses
      it. Needs a UI run to verify, which needs an unlocked screen.
- [ ] Audit the screens that have never been measured: Board, the inspector,
      QuickAdd, Pomodoro, Time Report, Settings.
- [ ] Re-add `try app.performAccessibilityAudit()` to every flow once green, so
      the gate is permanent rather than a one-off sweep.

## Comment Log

- 2026-08-09: Found on the first run of the audit, during Phase 11. Recorded
  rather than fixed in place because attributing and fixing 19 issues across an
  unmeasured surface is its own pass, and because filtering the audit to get a
  green suite would have destroyed the only mechanism that found them.
- 2026-08-09: The identifier half is fixed and committed. The audit half stalled
  on an environmental limit worth recording: **XCUITest cannot activate an
  application while the screen is locked** — every flow fails with _"Failed to
  activate … (current state: Running Background)"_, which reads like a broken app
  rather than a locked Mac. Confirmed via `CGSSessionScreenIsLocked` with
  `loginwindow` frontmost. Check that before debugging a UI-test failure that
  appeared without a code change; four runs were spent blaming a launch script.
