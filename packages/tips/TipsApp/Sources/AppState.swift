import Foundation
import Observation
import SwiftUI

/// Central app state managing loaded tips and daily rotation.
@Observable
final class AppState {

    // MARK: - Properties

    private(set) var apps: [TipApp] = []
    var selectedAppId: String?

    @ObservationIgnored
    @AppStorage("lastShownDate") private var lastShownDate: String = ""

    @ObservationIgnored
    @AppStorage("lastAppIndex") private var lastAppIndex: Int = 0

    var currentAppIndex: Int {
        guard !apps.isEmpty else { return 0 }
        return lastAppIndex % apps.count
    }

    var currentApp: TipApp? {
        guard !apps.isEmpty else { return nil }
        return apps[currentAppIndex]
    }

    // MARK: - Loading

    func loadTips(from directory: URL) {
        do {
            apps = try TipParser.loadAll(from: directory)
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
            lastAppIndex: lastAppIndex,
            appCount: apps.count
        )
        lastAppIndex = result.index
        lastShownDate = result.dateString
    }

    func showNextApp() {
        guard !apps.isEmpty else { return }
        lastAppIndex = (lastAppIndex + 1) % apps.count
        selectedAppId = currentApp?.id
    }

    func showPreviousApp() {
        guard !apps.isEmpty else { return }
        lastAppIndex = (lastAppIndex - 1 + apps.count) % apps.count
        selectedAppId = currentApp?.id
    }
}
