---
id: tasknotes-completion-undo-ui-fixes
type: plan
status: in-progress
board: false
---

# TaskNotes iOS UI and completion Undo fixes

## Summary

- Keep the normal-mode task context menu from collapsing its title and metadata.
- Replace the clipped search and settings icons with native, accessible toolbar
  actions.
- Make every in-app completion undoable through a transient LIFO stack with
  precise, non-spring motion.

## Implementation

- Give the task-content `Pressable` the remaining row width and isolate native
  menu gesture handling to the trailing 44-point overflow action, preserving
  context actions without collapsing text or consuming the first detail tap.
- Use SF Symbols in separate 44-point header targets with press feedback and a
  safe trailing inset.
- Capture exact inverse operations for status and recurring-occurrence
  completions. Group bulk completion into one Undo entry containing only the
  successful mutations.
- Keep Undo entries for five seconds of inactivity. Push and pop actions reset
  the timer; expiration clears the stack. Updating the active entry does not
  remount or replay the toast entrance.
- Replace the spring with a brief eased slide/fade and use opacity-only motion
  when Reduce Motion is enabled.

## Verification

- Unit-test status and recurrence restoration, non-completion exclusions, LIFO
  ordering, expiry, and grouped bulk behavior.
- Extend the ordered Maestro suite for visible task text, header navigation,
  plain/recurring/swipe/detail/bulk Undo, and two rapid LIFO Undo actions.
- Run focused typecheck, lint, unit, contract, release-bundle, and simulator E2E
  checks. Capture a screenshot for the corrected row/header and a short motion
  recording.
- Treat the next physical iOS 27 beta/TestFlight build as human acceptance; it
  is not evidence supplied by the local simulator run.

## Assumptions

- “All completions” covers actions initiated inside the app UI, not Widget,
  Siri, or remote Obsidian mutations that cannot display the in-app toast.
- One bulk completion is one Undo stack entry.
