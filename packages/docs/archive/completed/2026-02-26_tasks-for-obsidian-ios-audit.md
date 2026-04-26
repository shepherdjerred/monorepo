# iOS/RN Best Practices Audit: Tasks for Obsidian

## Status: Mostly Complete — Xcode config remaining

Last updated: 2026-04-05

---

## Completed Work

### Phase A — Foundations

All items done:

1. Accessibility — labels/roles/states on all interactive elements
2. Keyboard/SafeArea — KeyboardAvoidingView + SafeAreaView consumption
3. Performance — memo TaskRow/TaskCheckbox, fix toggleStatus closure, list perf props
4. Deep linking — URL scheme registered in Info.plist, AppDelegate URL handler, param validation
5. Auth — token wired into API headers via `Authorization: Bearer`, migrated to Keychain (`react-native-keychain`)
6. Error handling — 15s request timeouts via AbortController, Sentry crash reporting (`@sentry/react-native`), concurrency guard on sync
7. Touch targets — 44pt minimums on checkbox, pickers, buttons
8. iOS config — useAppState for foreground refresh, splash screen

### Phase B — Modern iOS UX

All items done: 9. Swipe actions — swipe-to-delete/complete on TaskRow via ReanimatedSwipeable 10. TipKit-style onboarding — JS tooltip component (`TipPopover`) for feature discovery

### Phase C — Native iOS features (JS deps)

All items done: 12. Context menus — zeego on TaskRow and KanbanCard 13. SF Symbols — `AppIcon` wrapper created with icon map, currently using Feather fallback (native module not in Xcode project)

### Phase D — Platform extensions (Swift files written, NOT wired into Xcode)

See "Remaining Work" below.

14. Home Screen widgets — Swift files on disk, JS bridge done
15. Siri Shortcuts — Swift intent files on disk
16. Live Activities — Swift files on disk, JS bridge done
17. Control Center — Swift file on disk

### Phase E — Code quality

All items done: 18. Tests — 172 tests across 7 files (result, status, priority, filters, dates, nlp, utils) 19. Type safety — Zod `.transform()` on all schemas for branded type inference, eliminated `as unknown as T` casts 20. Dedup — shared `useTaskListScreen` hook, single `ApiClientProvider` context

---

## Bugs Found Post-Implementation

| Bug                        | Root Cause                                                                                                             | Fix                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| App crashes on load        | `.toSorted()` is ES2023, not available in Hermes                                                                       | Replaced with `.sort()` across 10 files        |
| "Failed to connect" to API | Agent changed `NSAllowsArbitraryLoads` to `NSAllowsLocalNetworking` in Info.plist, blocking HTTP to Tailscale hostname | Reverted to `NSAllowsArbitraryLoads`           |
| Icons showing as triangles | `requireNativeComponent("SFSymbolView")` crashes when native module isn't registered                                   | Simplified AppIcon to always use Feather icons |

---

## Remaining Work: Features 5-8 (Xcode Project Configuration)

The Swift source files and JS bridges exist on disk but are **not functional** because they haven't been added to the Xcode project.

### What exists on disk

**Main app target files (need to be added to TasksForObsidian target):**

- `ios/TasksForObsidian/WidgetBridge.swift` + `.m` — RN native module for widget data
- `ios/TasksForObsidian/LiveActivityBridge.swift` + `.m` — RN native module for Live Activities
- `ios/TasksForObsidian/SFSymbolView.swift` + `SFSymbolViewManager.m` — SF Symbol native view
- `ios/TasksForObsidian/Intents/AddTaskIntent.swift` — Siri "Add task" intent
- `ios/TasksForObsidian/Intents/ShowTodayIntent.swift` — Siri "Show today" intent
- `ios/TasksForObsidian/Intents/TaskShortcutsProvider.swift` — Registers Siri phrases
- `ios/TasksForObsidian/TasksForObsidian.entitlements` — App Group capability

**Widget Extension files (need entirely new Xcode target):**

- `ios/TasksWidget/TasksWidgetBundle.swift` — Widget extension entry point
- `ios/TasksWidget/WidgetTaskData.swift` — Codable models
- `ios/TasksWidget/TodayTasksProvider.swift` — TimelineProvider
- `ios/TasksWidget/TodayTasksWidget.swift` — SwiftUI views (small/medium/large)
- `ios/TasksWidget/TimeTrackingAttributes.swift` — ActivityAttributes for Live Activities
- `ios/TasksWidget/TimeTrackingLiveActivity.swift` — Lock Screen + Dynamic Island views
- `ios/TasksWidget/QuickAddControl.swift` — iOS 18 Control Center widget
- `ios/TasksWidget/TasksWidget.entitlements` — App Group capability

**JS bridges (done, in src/native/):**

- `src/native/widget-bridge.ts` — Zod-validated bridge to WidgetBridge native module
- `src/native/live-activity-bridge.ts` — Zod-validated bridge to LiveActivityBridge native module
- `src/native/sync-widget.ts` — Computes widget data from task state

### What needs to happen in Xcode

1. **Add Swift/ObjC files to main app target**
   - Add WidgetBridge.swift, .m, LiveActivityBridge.swift, .m, SFSymbolView.swift, SFSymbolViewManager.m to TasksForObsidian target's Compile Sources
   - Add Intent files to TasksForObsidian target
   - Associate TasksForObsidian.entitlements with main target

2. **Create Widget Extension target**
   - File → New → Target → Widget Extension → name: `TasksWidget`
   - Bundle ID: `com.tasksforobsidian.TasksWidget` (or matching main app prefix)
   - Set deployment target to iOS 16.2
   - Add all `ios/TasksWidget/*.swift` files to this target
   - Associate TasksWidget.entitlements with widget target

3. **Configure App Groups**
   - Enable App Groups capability on both targets
   - Group name: `group.com.tasksforobsidian`
   - This is what allows the RN app to pass data to the widget via UserDefaults

4. **Code signing**
   - Widget extension needs its own provisioning profile
   - Must be signed with the same team as the main app

5. **Option: Use xcodeproj Ruby gem**
   - The `xcodeproj` gem (v1.27.0, installed via CocoaPods) can programmatically modify `project.pbxproj`
   - Can add files to existing target and create new targets
   - Avoids manual Xcode work

---

## New Dependencies Added

| Package                                                                                              | Purpose                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `zeego` + `react-native-ios-context-menu` + `react-native-ios-utilities` + `@react-native-menu/menu` | Native context menus on TaskRow and KanbanCard         |
| `react-native-keychain`                                                                              | Secure auth token storage (migrated from AsyncStorage) |
| `@sentry/react-native`                                                                               | Crash reporting (DSN not configured, disabled in dev)  |

---

## New Files Created

### Domain/Lib

- `src/domain/filters.ts` — Filter/sort logic
- `src/domain/saved-views.ts` — Saved view definitions
- `src/lib/errors.ts` — Error types
- `src/lib/secure-storage.ts` — Keychain wrapper with AsyncStorage migration
- `src/lib/icon-map.ts` — Feather → SF Symbol name mapping

### Components

- `src/components/common/AppIcon.tsx` — Platform icon wrapper (currently Feather-only)
- `src/components/common/TipPopover.tsx` — Animated onboarding tooltip
- `src/components/task/SwipeActions.tsx` — Swipe-to-delete/complete render functions
- `src/components/input/FilterModal.tsx` — Filter bottom sheet
- `src/components/input/FilterSortBar.tsx` — Filter/sort toolbar
- `src/components/input/SortPicker.tsx` — Sort option picker

### Hooks

- `src/hooks/use-tip.ts` — Persisted tip dismissal state
- `src/hooks/use-task-list-screen.ts` — Shared hook for filter/sort/delete across screens

### State

- `src/state/ApiClientContext.tsx` — Single shared TaskNotesClient provider

### Screens

- `src/screens/ContextDetailScreen.tsx`
- `src/screens/TagDetailScreen.tsx`
- `src/screens/SavedViewScreen.tsx`
- `src/screens/JobSearchKanbanScreen.tsx`

### Tests (172 tests total)

- `src/domain/result.test.ts`
- `src/domain/status.test.ts`
- `src/domain/priority.test.ts`
- `src/domain/filters.test.ts`
- `src/lib/dates.test.ts`
- `src/lib/nlp.test.ts`
- `src/lib/utils.test.ts`

### Native (Swift/ObjC — on disk, not in Xcode project)

- See "Remaining Work" section above

---

## Original Audit Plan

### Critical Findings (all addressed)

1. Zero test coverage → 172 tests
2. Zero accessibility markup → labels/roles/states added
3. No KeyboardAvoidingView → added to all input screens
4. No SafeAreaView → useSafeAreaInsets consumed
5. TaskRow not memoized → wrapped in React.memo
6. toggleStatus re-render issue → fixed closure dependencies
7. Auth token not sent → wired into Authorization header
8. Deep linking non-functional → URL scheme + AppDelegate handler
9. No swipe gestures → ReanimatedSwipeable added
10. Auth token in plaintext → migrated to Keychain

### High Findings (all addressed)

- SectionList perf props, inline closures, search debouncing, memo wrappers
- Navigation fixes, deep link validation
- Request timeouts, crash reporting, concurrency guards
- useAppState, touch targets, ATS config
- Hydration gate, edit conflict prevention
- Type casts eliminated, dedup, single client provider

### Modern iOS Features (5-8 partially done)

| #   | Feature             | JS Side | Swift Files | Xcode Config |
| --- | ------------------- | ------- | ----------- | ------------ |
| 5   | Home Screen Widgets | Done    | Written     | NOT DONE     |
| 6   | Live Activities     | Done    | Written     | NOT DONE     |
| 7   | Siri Shortcuts      | N/A     | Written     | NOT DONE     |
| 8   | Control Center      | N/A     | Written     | NOT DONE     |
