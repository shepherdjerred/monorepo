import AppIntents
import Foundation
import TaskNotesKit

@available(iOS 16.0, *)
struct AddTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Add a Task"
  static let description: IntentDescription = "Quickly add a new task"
  static let openAppWhenRun: Bool = true

  @Parameter(title: "Task Title")
  var taskTitle: String?

  func perform() async throws -> some IntentResult & ProvidesDialog & OpensIntent {
    var dialog: IntentDialog = "Open Facet to enter your task."
    var components = URLComponents()
    components.scheme = "tasknotes"
    components.host = "quick-add"
    if let title = taskTitle, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      guard
        let group = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: "group.com.tasksforobsidian")
      else {
        throw AddTaskIntentError.unavailableContainer
      }
      let queue = try FacetIntentQueue(
        directory: group.appendingPathComponent("FacetIntentActions"))
      let capture = try queue.enqueue(title: title)
      dialog = "Queued for your selected vault. Facet will finish saving when it opens."
      components.host = "queued-capture"
      components.queryItems = [URLQueryItem(name: "actionID", value: capture.id)]
    }
    guard let url = components.url else { throw AddTaskIntentError.invalidDeepLink }
    return .result(opensIntent: OpenURLIntent(url), dialog: dialog)
  }
}

private enum AddTaskIntentError: Error {
  case invalidDeepLink
  case unavailableContainer
}
