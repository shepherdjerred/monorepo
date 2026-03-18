import Foundation
import Observation
import SwiftUI

/// A single tip with its app context, for flat rotation.
struct FlatTip: Identifiable, Sendable {
    let id: String
    let appName: String
    let appIcon: String
    let appColor: Color
    let appWebsite: String?
    let category: String
    let text: String
    let shortcut: String?
}

/// Central app state managing loaded tips and daily rotation.
@MainActor
@Observable
final class AppState {

    // MARK: - Properties

    private(set) var apps: [TipApp] = []
    private(set) var allTips: [FlatTip] = []
    var selectedAppId: String?

    private let defaults: UserDefaults
    private let lastShownDateKey = "lastShownDate"
    private let lastTipIndexKey = "lastTipIndex"

    private var lastShownDate: String
    private var lastTipIndex: Int

    var currentTipIndex: Int {
        guard !allTips.isEmpty else { return 0 }
        return lastTipIndex % allTips.count
    }

    var currentTip: FlatTip? {
        guard !allTips.isEmpty else { return nil }
        return allTips[currentTipIndex]
    }

    // Keep for backwards compat with BrowseWindow
    var currentApp: TipApp? {
        guard let tip = currentTip else { return nil }
        return apps.first { $0.name == tip.appName }
    }

    init(tipsDirectory: URL? = nil, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        lastShownDate = defaults.string(forKey: lastShownDateKey) ?? ""
        lastTipIndex = defaults.integer(forKey: lastTipIndexKey)

        if let tipsDirectory {
            loadTips(from: tipsDirectory)
        }
    }

    // MARK: - Loading

    func loadTips(from directory: URL) {
        do {
            apps = try TipParser.loadAll(from: directory)
            allTips = apps.flatMap { app in
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
            }.shuffled()

            advanceIfNewDay()

            if selectedAppId == nil {
                selectedAppId = currentApp?.id
            }
        } catch {
            print("Failed to load tips: \(error)")
        }
    }

    // MARK: - Rotation

    func advanceIfNewDay() {
        let result = RotationScheduler.advance(
            lastShownDate: lastShownDate,
            lastAppIndex: lastTipIndex,
            appCount: allTips.count
        )

        updateRotationState(index: result.index, dateString: result.dateString)
    }

    func showNextTip() {
        guard !allTips.isEmpty else { return }
        updateRotationState(index: (lastTipIndex + 1) % allTips.count, dateString: lastShownDate)
    }

    func showPreviousTip() {
        guard !allTips.isEmpty else { return }
        updateRotationState(index: (lastTipIndex - 1 + allTips.count) % allTips.count, dateString: lastShownDate)
    }

    private func updateRotationState(index: Int, dateString: String) {
        lastTipIndex = index
        lastShownDate = dateString
        defaults.set(index, forKey: lastTipIndexKey)
        defaults.set(dateString, forKey: lastShownDateKey)
    }
}
