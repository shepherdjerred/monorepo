import AppIntents

@available(iOS 16.0, *)
struct TaskShortcutsProvider: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddTaskIntent(),
      phrases: [
        "Add a task in \(.applicationName)",
        "Create a task in \(.applicationName)",
        "New task in \(.applicationName)",
      ],
      shortTitle: "Add Task",
      systemImageName: "plus.circle.fill"
    )
    AppShortcut(
      intent: ShowTodayIntent(),
      phrases: [
        "What's due today in \(.applicationName)",
        "Show today's tasks in \(.applicationName)",
        "Today in \(.applicationName)",
      ],
      shortTitle: "Today's Tasks",
      systemImageName: "calendar"
    )
  }
}
