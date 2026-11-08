import AppIntents

@available(iOS 16.0, *)
struct ShowTodayIntent: AppIntent {
  static let title: LocalizedStringResource = "Show Today's Tasks"
  static let description: IntentDescription = "View tasks planned for or due today"
  static let openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult & OpensIntent {
    guard let url = URL(string: "tasknotes://today") else { throw ShowTodayIntentError.invalidURL }
    return .result(opensIntent: OpenURLIntent(url))
  }
}

private enum ShowTodayIntentError: Error { case invalidURL }
