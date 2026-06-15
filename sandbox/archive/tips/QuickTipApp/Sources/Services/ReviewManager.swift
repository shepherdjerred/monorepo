import Foundation
import os

/// Manages persistence of per-tip review state (favorites, learned, show-again).
@MainActor
@Observable
final class ReviewManager {
    // MARK: Lifecycle

    init(storageDirectory: URL? = nil, enableCloudSync: Bool = true) {
        let appSupportDir = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first
        let fallback = appSupportDir?.appendingPathComponent("QuickTipApp", isDirectory: true)
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("QuickTipApp", isDirectory: true)
        let dir = storageDirectory ?? fallback

        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("tip_state.json")
        self.load()

        if enableCloudSync {
            self.startCloudSync()
        }
    }

    // MARK: Internal

    private(set) var states: [String: TipState] = [:]

    var favoriteIds: Set<String> {
        Set(self.states.filter(\.value.isFavorite).map(\.key))
    }

    var learnedCount: Int {
        self.states.values.count(where: { $0.status == .learned })
    }

    // MARK: - Queries

    func state(for tipId: String) -> TipState {
        self.states[tipId] ?? TipState()
    }

    func isFavorite(_ tipId: String) -> Bool {
        self.states[tipId]?.isFavorite ?? false
    }

    func isLearned(_ tipId: String) -> Bool {
        self.states[tipId]?.status == .learned
    }

    // MARK: - Mutations

    func toggleFavorite(tipId: String) {
        var tipState = self.state(for: tipId)
        tipState.isFavorite.toggle()
        self.states[tipId] = tipState
        self.save()
    }

    func markLearned(tipId: String) {
        var tipState = self.state(for: tipId)
        tipState.status = .learned
        tipState.showAgainDate = nil
        self.states[tipId] = tipState
        self.save()
    }

    func markShowAgain(tipId: String, today: Date = .now) {
        var tipState = self.state(for: tipId)
        tipState.status = .showAgain
        tipState.showAgainDate = TipSelector.nextShowAgainDate(count: tipState.showAgainCount, from: today)
        tipState.showAgainCount += 1
        self.states[tipId] = tipState
        self.save()
    }

    func resetLearnedTips() {
        for key in self.states.keys where self.states[key]?.status == .learned {
            self.states[key]?.status = .unseen
        }
        self.save()
    }

    // MARK: Private

    private static let cloudKey = "tipStates"

    private let fileURL: URL

    // MARK: - Persistence

    private func load() {
        do {
            let data = try Data(contentsOf: self.fileURL)
            let store = try JSONDecoder().decode(TipStateStore.self, from: data)
            self.states = store.states
            Logger.persistence.info("Loaded \(store.states.count) tip states")
        } catch {
            let tipsError = TipsError.persistenceLoadFailed(url: self.fileURL, underlying: error)
            Logger.persistence.info("\(tipsError.description)")
        }
    }

    private func save() {
        do {
            let store = TipStateStore(states: self.states)
            let data = try JSONEncoder().encode(store)
            try data.write(to: self.fileURL, options: .atomic)
            Logger.persistence.debug("Saved \(self.states.count) tip states")
        } catch {
            let tipsError = TipsError.persistenceSaveFailed(url: self.fileURL, underlying: error)
            Logger.persistence.error("\(tipsError.description)")
        }
        self.syncToCloud()
    }

    // MARK: - iCloud Sync

    private func startCloudSync() {
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: NSUbiquitousKeyValueStore.default,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.mergeCloudState()
            }
        }
        NSUbiquitousKeyValueStore.default.synchronize()
        self.mergeCloudState()
    }

    private func syncToCloud() {
        do {
            let store = TipStateStore(states: self.states)
            let data = try JSONEncoder().encode(store)
            NSUbiquitousKeyValueStore.default.set(data, forKey: Self.cloudKey)
            Logger.persistence.debug("Synced \(self.states.count) tip states to iCloud")
        } catch {
            Logger.persistence.error("Failed to sync to iCloud: \(error)")
        }
    }

    private func mergeCloudState() {
        guard let data = NSUbiquitousKeyValueStore.default.data(forKey: Self.cloudKey),
              let cloudStore = try? JSONDecoder().decode(TipStateStore.self, from: data)
        else {
            return
        }

        var merged = self.states
        for (key, cloudState) in cloudStore.states {
            if let localState = merged[key] {
                // Keep the more "advanced" state
                if self.statusRank(cloudState.status) > self.statusRank(localState.status) {
                    merged[key] = cloudState
                } else if cloudState.isFavorite, !localState.isFavorite {
                    merged[key]?.isFavorite = true
                }
            } else {
                merged[key] = cloudState
            }
        }

        if merged != self.states {
            self.states = merged
            self.save()
            Logger.persistence.info("Merged cloud state: \(merged.count) total tip states")
        }
    }

    private func statusRank(_ status: TipStatus) -> Int {
        switch status {
        case .unseen:
            0
        case .showAgain:
            1
        case .learned:
            2
        }
    }
}
