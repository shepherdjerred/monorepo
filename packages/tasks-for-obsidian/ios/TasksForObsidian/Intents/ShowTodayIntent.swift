import AppIntents
import UIKit

@available(iOS 16.0, *)
struct ShowTodayIntent: AppIntent {
  static var title: LocalizedStringResource = "Show Today's Tasks"
  static var description: IntentDescription = "View tasks planned for or due today"
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    let url = URL(string: "tasknotes://today")!
    await UIApplication.shared.open(url)
    return .result()
  }
}
