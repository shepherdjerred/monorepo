---
id: plan-2026-04-25-tasks-for-obsidian-ios-target-wiring
type: plan
status: planned
board: true
verification: agent
disposition: active
---

# Tasks for Obsidian iOS Target Wiring

## Goal

Wire the already-created native iOS pieces into the Xcode project so the widget, share extension, AppIntent bridge, and native modules build as first-class targets.

## Work Items

- Add the widget and extension targets to the Xcode project.
- Register the existing native bridge files in the correct targets.
- Verify the app, widget, and extension build from Xcode and command line.
- Keep the archived audit as the reference for completed JS, Swift, and Objective-C work.

## Acceptance

- `xcodebuild` can build the app and new targets.
- The app still runs without requiring generated or local-only files.
- The archived audit remains linked only as background, not as an active plan.

## Remaining

- [ ] Complete and verify the work described in `Tasks for Obsidian iOS Target Wiring`.
