import AppIntents
import UIKit

@available(iOS 16.0, *)
struct AddTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Add a Task"
  static var description: IntentDescription = "Quickly add a new task"
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Task Title")
  var taskTitle: String?

  func perform() async throws -> some IntentResult {
    if let title = taskTitle, let encoded = title.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
      let url = URL(string: "tasknotes://quick-add?initialText=\(encoded)")!
      await UIApplication.shared.open(url)
    } else {
      let url = URL(string: "tasknotes://quick-add")!
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}
