# tasks-for-obsidian (Facet for iOS)

**Facet** for iOS and iPadOS — pure native SwiftUI client sharing `TaskNotesKit`
(SQLite3 + `/api/v1/sync`) and `TaskNotesFacetUI` with
[`packages/tasknotes-macos`](../tasknotes-macos).

The package directory and Apple bundle/App Group identifiers remain
`tasks-for-obsidian` / `org.reactjs.native.example.TasksForObsidian` /
`group.com.tasksforobsidian` to preserve existing TestFlight, App Store, Keychain,
WidgetKit, and Siri Shortcuts registrations.

First-party code is GPL-3.0-only; bundled license notices are generated from
`packages/tasknotes-macos/scripts/generate-native-notices.ts --ios`.

## Features & Targets (`ios/project.yml`)

- **`TasksForObsidian` (`ios/Facet/` + `ios/TasksForObsidian/Intents/`)**:
  - The app opens on **Today**. Its four tabs are **Inbox**, **Today**,
    **Upcoming**, and **Browse**. Browse contains projects, labels, filters,
    boards, completed tasks, and settings. Search reads the whole local workspace.
  - Floating Quick Add highlights recognized phrases and supports consecutive
    entries above the keyboard. Upcoming supplies the selected date for capture.
    Swipe a task right to complete or left to reschedule, or open its detail sheet.
  - Background sync (`FacetBackgroundTasks` via `BGProcessingTaskRequest`) syncing
    with `/api/v1/sync` and refreshing widget timelines.
  - Siri & Shortcuts intents (`AddTaskIntent`, `ShowTodayIntent`,
    `TaskShortcutsProvider`) queueing captures into `FacetIntentQueue` when run.
- **`TasksWidget` (`ios/TasksWidget/`)**:
  - Small, Medium, and Large `TodayTasksWidget` + iOS 18 Control Center
    `QuickAddTaskControl` reading 33-day rolling projections from
    `FacetWidgetSnapshot.json`.
- **`FacetPresentationTests` & `TasksForObsidianUITests`**:
  - Native Swift Testing unit tests and XCUITest smoke target.

## Building & Verifying Locally

```bash
bun install --frozen-lockfile
cd packages/tasks-for-obsidian

bun run ios:native:generate    # xcodegen generate --spec ios/project.yml --project ios
bun run check:ios-native-deps  # verify Xcode Cloud & native workspace invariants
bun run lint:swift             # SwiftLint --strict across ios/
bun run format:swift:check     # xcrun swift-format lint
bun run test                   # Vitest suite for iOS helper scripts
bun run typecheck && bun run lint

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/TasksForObsidian.xcodeproj \
  -scheme TasksForObsidian \
  -destination 'generic/platform=iOS Simulator' \
  -configuration Release \
  -derivedDataPath .build/xcode \
  CODE_SIGNING_ALLOWED=NO build
```

See [AGENTS.md](AGENTS.md) for package-specific constraints.
