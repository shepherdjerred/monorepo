import AppIntents

struct ShowTipForAppIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Tip for App"
    static let description = IntentDescription("Shows a tip for a specific app")

    @Parameter(title: "App Name")
    var appName: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let state = QuickTipAppContext.shared else {
            throw TipsIntentError.appNotRunning
        }

        let matchingTips = state.allTips.filter {
            $0.appName.localizedCaseInsensitiveContains(self.appName)
        }

        guard let tip = matchingTips.randomElement() else {
            throw TipsIntentError.noTipsAvailable
        }

        return .result(value: "\(tip.appName): \(tip.formattedText)")
    }
}
