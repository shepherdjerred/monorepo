import Foundation

/// Manages persistence of per-tip review state (favorites, learned, show-again).
@MainActor
@Observable
final class ReviewManager {
    // MARK: Lifecycle

    init(storageDirectory: URL? = nil) {
        let appSupportDir = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first
        let fallback = appSupportDir?.appendingPathComponent("TipsApp", isDirectory: true)
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("TipsApp", isDirectory: true)
        let dir = storageDirectory ?? fallback

        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("tip_state.json")
        self.load()
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

    // MARK: Private

    private let fileURL: URL

    // MARK: - Persistence

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let store = try? JSONDecoder().decode(TipStateStore.self, from: data)
        else {
            return
        }
        self.states = store.states
    }

    private func save() {
        let store = TipStateStore(states: states)
        guard let data = try? JSONEncoder().encode(store) else {
            return
        }
        try? data.write(to: self.fileURL, options: .atomic)
    }
}
