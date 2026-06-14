import AppIntents

struct GetDailyTipIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Today's Tip"
    static let description: IntentDescription = "Returns today's tip text"

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let state = QuickTipAppContext.shared else {
            throw TipsIntentError.appNotRunning
        }

        guard let tip = state.currentTip else {
            throw TipsIntentError.noTipsAvailable
        }

        return .result(value: tip.formattedText)
    }
}
