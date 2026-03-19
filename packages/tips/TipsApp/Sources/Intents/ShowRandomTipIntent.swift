import AppIntents

struct ShowRandomTipIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Random Tip"
    static let description: IntentDescription = "Shows a random tip from the Tips app"

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let state = TipsAppContext.shared else {
            throw TipsIntentError.appNotRunning
        }

        state.showRandomTip()

        guard let tip = state.currentTip else {
            throw TipsIntentError.noTipsAvailable
        }

        return .result(value: tip.formattedText)
    }
}
