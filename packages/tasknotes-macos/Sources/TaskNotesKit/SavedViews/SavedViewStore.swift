internal import Observation
public import TaskNotesUniFFI

// `UserDefaults` is public because it appears in this type's initializer, which
// a test with its own suite has to be able to name. `Data` and `UUID` follow it:
// Swift requires every import of a module within one file to agree on its
// access level, and disagreeing is an error rather than a warning here.
public import struct Foundation.Data
public import struct Foundation.UUID
public import class Foundation.UserDefaults

/// The saved views, and the only thing that persists them.
///
/// ## Why `UserDefaults` rather than the core's storage
///
/// The core's `QueueStorage` and `TaskCacheStorage` hold *vault* state — the
/// command queue, the task cache, the id aliases — all of which the core reads
/// and writes and all of which have to survive a reinstall for correctness. A
/// saved view is neither: it is a window preference, the core has never heard
/// of it, and routing it through a host trait the core owns would mean the
/// core carried a type it cannot use. `UserDefaults` is the platform's answer
/// for exactly this, it is per-user and per-app inside the sandbox, and it
/// participates in the same backup and sync story as every other preference.
///
/// ## Corrupt data is reported, never quietly discarded
///
/// If the stored document does not decode, this does **not** reset to the
/// defaults and carry on: somebody's views would vanish with no explanation,
/// which is the silent-fallback-on-bad-data pattern the repository bans. The
/// failure is published on ``lastError`` for the UI to show, the list comes up
/// empty, and the unreadable bytes are copied to a backup key first — so a
/// later write cannot destroy them and they can be recovered by hand.
@MainActor
@Observable
public final class SavedViewStore {
    /// The views, in the order the sidebar lists them.
    public private(set) var views: [SavedView] = []

    /// The last failure reading or writing the store, for a banner.
    ///
    /// Separate from the task store's `lastStoreError`: a broken saved view has
    /// nothing to do with the vault, and merging the two would let a preference
    /// problem render as a sync problem.
    public private(set) var lastError: CoreError?

    private let defaults: UserDefaults

    /// The store as persisted, loading whatever is already there.
    ///
    /// Seeds ``SavedView/defaults`` only when the key has never been written —
    /// not when it decodes to an empty array. Deleting your last saved view has
    /// to stay deleted, and "absent" and "empty" are different states precisely
    /// so that it can.
    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        load()
    }

    public func view(id: SavedView.ID) -> SavedView? {
        views.first { $0.id == id }
    }

    /// Keep a screen's narrowing as a new view, and return it.
    ///
    /// - Parameters:
    ///   - name: what to call it. Trimmed; an empty name is refused rather than
    ///     stored, because a nameless row in the sidebar is unclickable in
    ///     practice.
    ///   - symbol: which of the closed set of symbols to draw.
    ///   - draft: what to keep. Its filters become the view's base and its
    ///     search and sort become where the screen starts.
    ///   - id: the new view's identity. A parameter with a default so a test can
    ///     pin it; nothing else should pass one.
    /// - Returns: the stored view, or `nil` when the name was empty.
    @discardableResult
    public func save(
        name: String,
        symbol: SavedViewSymbol,
        draft: SavedViewDraft,
        id: SavedView.ID = UUID().uuidString
    ) -> SavedView? {
        let trimmed = name.trimmingWhitespace()
        guard !trimmed.isEmpty else {
            lastError = .Validation(message: "a saved view needs a name")
            return nil
        }
        let view = SavedView(id: id, name: trimmed, symbol: symbol, draft: draft)
        views.append(view)
        persist()
        return view
    }

    /// Replace a view in place, keeping its position and its id.
    public func update(_ view: SavedView) {
        guard let index = views.firstIndex(where: { $0.id == view.id }) else { return }
        views[index] = view
        persist()
    }

    public func remove(id: SavedView.ID) {
        views.removeAll { $0.id == id }
        persist()
    }

    /// Put the two shipped views back, without disturbing anything already
    /// stored under their ids.
    ///
    /// The escape hatch for somebody who deleted Job Search and wants it back,
    /// and the one thing that would otherwise need a reinstall.
    public func restoreDefaults() {
        let known = Set(views.map(\.id))
        views.append(contentsOf: SavedView.defaults.filter { !known.contains($0.id) })
        persist()
    }

    /// Clear a failure the reader has seen.
    public func clearError() {
        lastError = nil
    }

    // ── Persistence ────────────────────────────────────────────────────────

    private func load() {
        guard let data = defaults.data(forKey: Self.storageKey) else {
            views = SavedView.defaults
            persist()
            return
        }
        switch CoreErrors.capturing({ () throws(CoreError) -> [SavedView] in
            try SavedViewRecord.decode(data)
        }) {
        case .success(let stored):
            views = stored
        case .failure(let error):
            // Kept, not overwritten. The next `persist()` replaces the primary
            // key; this copy is what makes that recoverable.
            defaults.set(data, forKey: Self.backupKey)
            lastError = error
            views = []
        }
    }

    private func persist() {
        switch CoreErrors.capturing({ () throws(CoreError) -> Data in
            try SavedViewRecord.encode(views)
        }) {
        case .success(let data):
            defaults.set(data, forKey: Self.storageKey)
        case .failure(let error):
            lastError = error
        }
    }

    private static let storageKey = "red.sjer.tasknotes.savedViews"

    /// Where an unreadable document is parked so a write cannot destroy it.
    private static let backupKey = "red.sjer.tasknotes.savedViews.unreadable"
}
