import AppIntents
import Foundation
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

  func perform() async throws -> some IntentResult & OpensIntent {
    guard let url = URL(string: "tasknotes://quick-add") else {
      throw QuickAddControlError.invalidURL
    }
    return .result(opensIntent: OpenURLIntent(url))
  }
}

@available(iOS 18.0, *)
private enum QuickAddControlError: Error {
  case invalidURL
}
