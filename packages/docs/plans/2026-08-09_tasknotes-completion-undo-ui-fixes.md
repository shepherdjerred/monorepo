---
id: tasknotes-completion-undo-ui-fixes
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
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

## Human Verification

- On the next physical iPhone build using the iOS 27 beta, confirm task titles
  and metadata remain visible in normal mode and the Search and Settings header
  actions are aligned and tappable.
- Complete tasks from the list, detail, swipe, and bulk surfaces. Confirm Undo
  stays visible for about five seconds, restores each task in LIFO order, and
  enters and exits without repeated vertical bouncing with Reduce Motion both
  off and on.
- Accept the change only if those behaviors match the simulator evidence; on
  failure, record the device model, iOS build, app build, and affected surface.

## Assumptions

- “All completions” covers actions initiated inside the app UI, not Widget,
  Siri, or remote Obsidian mutations that cannot display the in-app toast.
- One bulk completion is one Undo stack entry.
