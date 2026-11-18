# Facet iOS constraints

This package owns the native SwiftUI iOS application (**Facet**), WidgetKit
extension (`TasksWidget`), and Siri / App Intents (`AddTaskIntent`,
`ShowTodayIntent`), consuming `TaskNotesKit` and `TaskNotesFacetUI` from
`packages/tasknotes-macos`.

- Preserve the registered Apple bundle identifier
  (`org.reactjs.native.example.TasksForObsidian`), App Group
  (`group.com.tasksforobsidian`), widget kind (`TodayTasksWidget`), background
  task identifier (`org.reactjs.native.example.TasksForObsidian.sync`), and
  `tasknotes://` URL scheme for App Store / TestFlight continuity.
- Never open `FacetSQLiteDatabase` inside the App Group container; keep SQLite in
  the app-private `Application Support/Facet/facet-sync.sqlite3` directory so
  background suspension cannot trigger `0xdead10cc` termination.
- The App Group holds only `FacetWidgetSnapshot.json` and `FacetIntentActions`
  capture files — never bearer tokens or SQLite files.
- Bearer API tokens live in Keychain with
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` so `BGProcessingTaskRequest`
  sync can authenticate while the device is locked after first unlock.
- All Swift sources under `ios/` obey `../tasknotes-macos/.swiftlint.yml`
  (Swift 6, `-warnings-as-errors`, no `try?`, no `print(`, no `default:` in
  switches).
