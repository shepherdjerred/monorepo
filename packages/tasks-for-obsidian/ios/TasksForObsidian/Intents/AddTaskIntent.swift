import AppIntents
import Foundation
import UIKit

@available(iOS 16.0, *)
struct AddTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Add a Task"
  static var description: IntentDescription = "Quickly add a new task"
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Task Title")
  var taskTitle: String?

  func perform() async throws -> some IntentResult {
    var components = URLComponents()
    components.scheme = "tasknotes"
    components.host = "quick-add"
    if let title = taskTitle {
      components.queryItems = [URLQueryItem(name: "initialText", value: title)]
    }
    guard let url = components.url else { throw AddTaskIntentError.invalidDeepLink }
    await UIApplication.shared.open(url)
    return .result()
  }
}

private enum AddTaskIntentError: Error {
  case invalidDeepLink
}
