import Foundation

// MARK: - TipSelector

/// Selects the next tip to show based on a three-bucket priority system.
enum TipSelector {
    // MARK: Internal

    /// Select the next tip to show.
    ///
    /// Priority:
    /// 1. "Show again" tips that are due (showAgainDate <= today)
    /// 2. Unseen tips (no entry in states dictionary) — random pick
    /// 3. Future "show again" tips — nearest date first
    ///
    /// Learned tips are excluded entirely.
    static func selectNext(
        from allTips: [FlatTip],
        states: [String: TipState],
        excludingId: String? = nil,
        today: Date = .now
    ) -> FlatTip? {
        let todayString = RotationScheduler.formatDate(today)

        let candidates = allTips.filter { tip in
            tip.id != excludingId && states[tip.id]?.status != .learned
        }

        if let due = selectDueTip(from: candidates, states: states, before: todayString) {
            return due
        }

        let unseenTips = candidates.filter { states[$0.id] == nil }
        if let random = unseenTips.randomElement() {
            return random
        }

        return self.selectFutureTip(from: candidates, states: states, after: todayString)
    }

    /// Compute the next "show again" date based on how many times the user has already deferred.
    /// Cooldown doubles: 3, 6, 12, 24 days (capped at 30).
    static func nextShowAgainDate(count: Int, from today: Date = .now) -> String {
        let baseDays = 3
        let days = min(baseDays * (1 << count), 30)
        guard let nextDate = Calendar.current.date(byAdding: .day, value: days, to: today) else {
            return RotationScheduler.formatDate(today)
        }
        return RotationScheduler.formatDate(nextDate)
    }

    // MARK: Private

    private static func selectDueTip(
        from candidates: [FlatTip],
        states: [String: TipState],
        before todayString: String
    ) -> FlatTip? {
        candidates
            .filter { tip in
                guard let state = states[tip.id],
                      state.status == .showAgain,
                      let showDate = state.showAgainDate
                else {
                    return false
                }
                return showDate <= todayString
            }
            .min { (states[$0.id]?.showAgainDate ?? "") < (states[$1.id]?.showAgainDate ?? "") }
    }

    private static func selectFutureTip(
        from candidates: [FlatTip],
        states: [String: TipState],
        after todayString: String
    ) -> FlatTip? {
        candidates
            .filter { tip in
                guard let state = states[tip.id],
                      state.status == .showAgain,
                      let showDate = state.showAgainDate
                else {
                    return false
                }
                return showDate > todayString
            }
            .min { (states[$0.id]?.showAgainDate ?? "") < (states[$1.id]?.showAgainDate ?? "") }
    }
}
