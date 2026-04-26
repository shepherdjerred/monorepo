# Tasks for Obsidian iOS Target Wiring

## Status

Not Started. This replaces the completed 2026-02-26 iOS audit, which is archived as historical context.

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
