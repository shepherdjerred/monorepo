import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct QuickAddTaskControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "QuickAddTaskControl") {
      ControlWidgetButton(action: QuickAddControlIntent()) {
        Label("Add Task", systemImage: "plus.circle.fill")
      }
    }
    .displayName("Quick Add Task")
    .description("Add a new task to Tasks for Obsidian.")
  }
}

@available(iOS 18.0, *)
struct QuickAddControlIntent: ControlConfigurationIntent {
  static var title: LocalizedStringResource = "Quick Add Task"
  static var isDiscoverable: Bool = true
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    return .result()
  }
}
