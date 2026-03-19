import AppIntents

struct SearchTipsIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Tips"
    static let description: IntentDescription = "Search for tips matching a query"

    @Parameter(title: "Query")
    var query: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let state = TipsAppContext.shared else {
            throw TipsIntentError.appNotRunning
        }

        let lowercasedQuery = self.query.lowercased()
        let matches = state.allTips.filter { tip in
            tip.text.lowercased().contains(lowercasedQuery)
                || tip.appName.lowercased().contains(lowercasedQuery)
                || tip.category.lowercased().contains(lowercasedQuery)
                || (tip.shortcut?.lowercased().contains(lowercasedQuery) ?? false)
        }

        guard !matches.isEmpty else {
            return .result(value: "No tips found matching \"\(self.query)\".")
        }

        let results = matches.prefix(5).map { tip in
            "\(tip.appName) — \(tip.formattedText)"
        }

        return .result(value: results.joined(separator: "\n"))
    }
}
