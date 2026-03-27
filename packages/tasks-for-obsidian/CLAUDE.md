# Tasks for Obsidian

React Native 0.83 bare workflow app (no Expo) for iOS/Android. Syncs with the TaskNotes Obsidian plugin via its HTTP API. Uses Metro bundler, Hermes engine, and New Architecture.

## Quick Reference

```bash
bun install                          # Install JS deps
bun run pod-install                  # Install iOS native deps (CocoaPods)
bun run ios                          # Build + launch on simulator
bun run ios --simulator="iPhone 16 Pro"  # Specific simulator
bun run start                        # Start Metro bundler (separate terminal)
bun run typecheck                    # Type check
bunx eslint . --max-warnings=0       # Lint
bun test                             # Tests
```

## iOS First-Time Setup

```bash
bun install
bun run pod-install
bun run ios
```

If `pod install` fails, check prerequisites:

- Xcode installed with iOS simulator runtimes
- CocoaPods installed (`gem install cocoapods`)
- `ios/.xcode.env.local` must point to a valid Node binary — currently hardcoded to mise-managed Node. Update with `echo "export NODE_BINARY=$(mise where node)/bin/node" > ios/.xcode.env.local` if the path is wrong.

## iOS Build Troubleshooting

Try these in order (least to most destructive):

1. **Reset Metro cache**: `bun run start --reset-cache`
2. **Reinstall pods**: `bun run pod-install`
3. **Clean Xcode derived data**: `rm -rf ~/Library/Developer/Xcode/DerivedData/TasksForObsidian-*`
4. **Deintegrate + reinstall pods**: `cd ios && pod deintegrate && pod install`
5. **Nuclear clean**: `bun run clean:ios` (removes ios/build, ios/Pods, DerivedData, then reinstalls pods)

### Specific Failures

- **"Node not found" during Xcode build phase**: The `ios/.xcode.env.local` file has a hardcoded Node path. Fix: `echo "export NODE_BINARY=$(mise where node)/bin/node" > ios/.xcode.env.local`
- **Pod version conflicts**: `cd ios && pod cache clean --all && pod deintegrate && pod install`
- **Code signing errors on physical device**: Must be configured in Xcode — open `ios/TasksForObsidian.xcworkspace`, set the development team under Signing & Capabilities for both `TasksForObsidian` and `TasksWidget` targets.

## Debugging & Logs

### How the human gets you logs

The human will typically be running the app and hit a problem. Ask them to run one of these in a terminal and then give you the log file:

**Build failures** — captures the full xcodebuild output:

```bash
bun run ios 2>&1 | tee /tmp/ios-build.log
```

**JS runtime logs** — Metro console output (console.log, console.warn, console.error, React errors):

```bash
bun run start 2>&1 | tee /tmp/metro.log
```

**Native device logs** — Swift print() statements, native crashes, system messages from the simulator:

```bash
xcrun simctl spawn booted log stream --predicate 'process == "TasksForObsidian"' --level debug 2>&1 | tee /tmp/device.log
```

**Physical device logs** — if the app is running on a real iPhone connected via USB:

```bash
idevicesyslog --process TasksForObsidian 2>&1 | tee /tmp/device.log
```

(Requires `brew install libimobiledevice`)

Then the human tells you: "read /tmp/ios-build.log" or "read /tmp/metro.log" etc.

### Debugging tools

- **React Native DevTools**: Press `j` in Metro terminal to open Chrome-based debugger (console, breakpoints, React component tree). This replaced Flipper.
- **Xcode console**: For native Swift/ObjC logs — human opens `ios/TasksForObsidian.xcworkspace` in Xcode and runs from there.
- **Shake gesture / Cmd+D in simulator**: Opens React Native dev menu (reload, DevTools, performance monitor).

### MCP servers (optional, for full "closing the loop")

These let you directly build, see screenshots, and interact with the simulator:

- **XcodeBuildMCP** (`github.com/getsentry/XcodeBuildMCP`): Structured JSON build/test output instead of raw xcodebuild logs. Prevents context overflow.
- **ios-simulator-mcp** (`github.com/joshuayoes/ios-simulator-mcp`): Take screenshots, tap elements, read accessibility tree from the simulator.

## Simulator Commands

```bash
xcrun simctl list devices                              # List simulators
xcrun simctl boot "iPhone 16 Pro"                      # Boot a simulator
xcrun simctl shutdown all                              # Shutdown all simulators
xcrun simctl openurl booted "tasknotes://today"        # Test deep links
xcrun simctl openurl booted "tasknotes://quick-add"    # Test quick add
xcrun simctl io booted screenshot /tmp/sim.png         # Take screenshot
xcrun simctl io booted recordVideo /tmp/demo.mp4       # Record (Ctrl+C to stop)
xcrun simctl erase booted                              # Factory reset simulator
```

## Deep Linking

URL scheme: `tasknotes://`

Routes: `inbox`, `today`, `upcoming`, `browse`, `quick-add`, `search`, `settings`, `pomodoro`, `time-report`, `kanban`, `task/:taskId`, `project/:projectName`, `context/:contextName`, `tag/:tagName`, `view/:viewId`

Test: `xcrun simctl openurl booted "tasknotes://today"`

## Architecture

- **domain/** — Pure types, Zod schemas, Result<T,E>, errors (no React imports)
- **data/** — API client (Zod-validated), AsyncStorage cache, sync engine, mutation queue
- **state/** — React contexts: TaskContext, SettingsContext, SyncContext, TimeTrackingContext, ApiClientContext
- **hooks/** — Custom hooks bridging state to UI (kebab-case filenames)
- **screens/** — Full-screen views (Today, Inbox, Upcoming, Browse, TaskDetail, Settings, etc.)
- **components/** — Reusable UI (TaskRow, TaskList, FAB, ConnectionBanner, ErrorBoundary, etc.)
- **navigation/** — React Navigation: NativeStack + BottomTabs, deep linking config in `linking.ts`
- **native/** — Bridge modules to Swift: widget-bridge.ts, live-activity-bridge.ts, sync-widget.ts
- **styles/** — Dark/light color themes
- **lib/** — Utility functions: NLP parsing, date helpers, feedback (haptics + sounds), secure storage

## Patterns

- **Zod schemas** validate every API response — no `as T` casts
- **Branded types** for IDs: `TaskId`, `ProjectName`, `ContextName`, `TagName`
- **Result<T, AppError>** for expected failures — no try/catch for business logic
- **Error types**: NetworkError, ApiError, ValidationError, NotFoundError, ConnectionError
- **Native bridges** use Zod to validate NativeModules at runtime, silently no-op when unavailable
- **No logging in source code** — the codebase has zero console.log calls. Errors surface via UI (Alerts, ConnectionBanner) or Sentry (production only)
- Follows `packages/clauderon/mobile/` conventions: bare React Native, context-based state, class-based API client
- Strict tsconfig: noUncheckedIndexedAccess, exactOptionalPropertyTypes, noPropertyAccessFromIndexSignature

## iOS Native Features

These require Xcode (not just `bun run ios`) for full testing:

- **Widgets** (`ios/TasksWidget/`): TodayTasksWidget (S/M/L), QuickAddControl (iOS 18+ Control Center). Data synced via WidgetBridge → shared UserDefaults (app group: `group.com.tasksforobsidian`).
- **Live Activities** (`ios/TasksForObsidian/LiveActivityBridge.swift`): Time tracking on lock screen + Dynamic Island. iOS 16.2+.
- **Siri Intents** (`ios/TasksForObsidian/Intents/`): AddTaskIntent, ShowTodayIntent — voice commands and Shortcuts app.
- **SF Symbols** (`ios/TasksForObsidian/SFSymbolView.swift`): Native UIView for system icons, exposed to JS via RCTViewManager.
- **App Groups**: `group.com.tasksforobsidian` — shared between main app and widget extension.

To test widgets: build in Xcode, select the TasksWidget scheme, choose a widget size from the preview.
