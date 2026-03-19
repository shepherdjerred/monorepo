import Foundation
import Observation
import SwiftUI

// MARK: - FlatTip

/// A single tip with its app context, for flat rotation.
struct FlatTip: Identifiable {
    let id: String
    let appName: String
    let appIcon: String
    let appColor: Color
    let appWebsite: String?
    let category: String
    let text: String
    let shortcut: String?
}

// MARK: - AppState

/// Central app state managing loaded tips and daily rotation.
@MainActor
@Observable
final class AppState {
    // MARK: Lifecycle

    init(
        tipsDirectory: URL? = nil,
        defaults: UserDefaults = .standard,
        reviewManager: ReviewManager = ReviewManager()
    ) {
        self.defaults = defaults
        self.reviewManager = reviewManager
        self.lastShownDate = defaults.string(forKey: self.lastShownDateKey) ?? ""

        if let tipsDirectory {
            self.loadTips(from: tipsDirectory)
        }
    }

    // MARK: Internal

    private(set) var apps: [TipApp] = []
    private(set) var allTips: [FlatTip] = []
    var selectedAppId: String?

    let reviewManager: ReviewManager

    var currentTip: FlatTip? {
        guard !self.tipHistory.isEmpty, self.tipHistory.indices.contains(self.historyIndex) else {
            return nil
        }
        return self.tipHistory[self.historyIndex]
    }

    var currentTipIndex: Int {
        guard let tip = currentTip else {
            return 0
        }
        return self.allTips.firstIndex(where: { $0.id == tip.id }) ?? 0
    }

    var currentApp: TipApp? {
        guard let tip = currentTip else {
            return nil
        }
        return self.apps.first { $0.name == tip.appName }
    }

    // MARK: - Favorites

    var favoriteTips: [FlatTip] {
        let ids = self.reviewManager.favoriteIds
        return self.allTips.filter { ids.contains($0.id) }
    }

    // MARK: - Loading

    func loadTips(from directory: URL) {
        do {
            self.apps = try TipParser.loadAll(from: directory)
            self.allTips = self.apps.flatMap { app in
                app.sections.flatMap { section in
                    section.items.map { item in
                        FlatTip(
                            id: "\(app.id)-\(section.id)-\(item.id)",
                            appName: app.name,
                            appIcon: app.icon,
                            appColor: app.color,
                            appWebsite: app.website,
                            category: section.heading,
                            text: item.text,
                            shortcut: item.shortcut
                        )
                    }
                }
            }
            .sorted { $0.id < $1.id }

            self.selectDailyTip()

            if self.selectedAppId == nil {
                self.selectedAppId = self.currentApp?.id
            }
        } catch {
            print("Failed to load tips: \(error)")
        }
    }

    // MARK: - Rotation

    func selectDailyTip() {
        let todayString = RotationScheduler.formatDate(.now)
        guard self.lastShownDate != todayString || self.tipHistory.isEmpty else {
            return
        }

        if let tip = TipSelector.selectNext(
            from: allTips,
            states: reviewManager.states
        ) {
            self.pushToHistory(tip)
        }

        self.lastShownDate = todayString
        self.defaults.set(todayString, forKey: self.lastShownDateKey)

        if let tip = currentTip {
            NotificationManager.scheduleDailyNotification(tip: tip)
        }
    }

    func showNextTip() {
        // If we're behind in history, go forward
        if self.historyIndex < self.tipHistory.count - 1 {
            self.historyIndex += 1
            return
        }

        // Otherwise select a new tip
        if let tip = TipSelector.selectNext(
            from: allTips,
            states: reviewManager.states,
            excludingId: currentTip?.id
        ) {
            self.pushToHistory(tip)
        }
    }

    func showPreviousTip() {
        guard self.historyIndex > 0 else {
            return
        }
        self.historyIndex -= 1
    }

    func showRandomTip() {
        let candidates = self.allTips.filter { tip in
            tip.id != self.currentTip?.id && !self.reviewManager.isLearned(tip.id)
        }
        if let random = candidates.randomElement() {
            self.pushToHistory(random)
        }
    }

    // MARK: - Review Actions

    func markCurrentTipLearned() {
        guard let tip = currentTip else {
            return
        }
        self.reviewManager.markLearned(tipId: tip.id)
        self.showNextTip()
    }

    func markCurrentTipShowAgain() {
        guard let tip = currentTip else {
            return
        }
        self.reviewManager.markShowAgain(tipId: tip.id)
        self.showNextTip()
    }

    func toggleCurrentTipFavorite() {
        guard let tip = currentTip else {
            return
        }
        self.reviewManager.toggleFavorite(tipId: tip.id)
    }

    // MARK: Private

    private let defaults: UserDefaults
    private let lastShownDateKey = "lastShownDate"

    private var lastShownDate: String

    /// History of recently shown tips for back/forward navigation.
    private var tipHistory: [FlatTip] = []
    private var historyIndex: Int = -1

    private let maxHistorySize = 20

    private func pushToHistory(_ tip: FlatTip) {
        // Truncate forward history if we navigated back
        if self.historyIndex < self.tipHistory.count - 1 {
            self.tipHistory = Array(self.tipHistory.prefix(self.historyIndex + 1))
        }

        self.tipHistory.append(tip)

        // Cap history size
        if self.tipHistory.count > self.maxHistorySize {
            self.tipHistory.removeFirst()
        }

        self.historyIndex = self.tipHistory.count - 1
    }
}
