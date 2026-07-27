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

- [ ] Inventory the widget, App Intent, and share-extension Swift sources and define which targets own each file.
- [ ] Add the widget extension target, product, build phases, entitlements, and app-extension embedding to the Xcode project.
- [ ] Add a share extension only if its implementation sources are present; otherwise split that feature into a separate todo.
- [ ] Configure shared App Group/capabilities consistently across the app and extensions.
- [ ] Add deterministic project validation for target membership and required build settings.
- [ ] Build the app and extensions for an iOS simulator and run affected repository verification.

## Comment Log

- 2026-07-27 — Board audit confirmed widget and Intent sources exist, but
  `project.pbxproj` defines only the main `TasksForObsidian` native target. The
  refreshed work avoids assuming that an unwritten share extension already
