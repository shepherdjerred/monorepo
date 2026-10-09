import Foundation
public import Observation

/// Profile changes, native close and termination share the same vetoable flush.
@Observable @MainActor public final class FacetDraftCoordinator {
    public static let shared = FacetDraftCoordinator()
    private struct Entry {
        let owner: ObjectIdentifier
        let profileID: String
        let flush: @MainActor () async -> Bool
        let isDirty: @MainActor () -> Bool
    }
    private var entries: [UUID: Entry] = [:]
    private var generation = 0
    public private(set) var isTransitioning = false
    public init() {}
    public var isEmpty: Bool { entries.isEmpty }
    internal func register(
        _ id: UUID, owner: FacetStore, profileID: String,
        isDirty: @escaping @MainActor () -> Bool = { false },
        flush: @escaping @MainActor () async -> Bool
    ) {
        entries[id] = Entry(
            owner: ObjectIdentifier(owner), profileID: profileID, flush: flush, isDirty: isDirty)
        generation += 1
    }
    internal func unregister(_ id: UUID) {
        entries.removeValue(forKey: id)
        generation += 1
    }
    public func flushAll() async -> Bool {
        guard !isTransitioning else { return false }
        isTransitioning = true
        defer { isTransitioning = false }
        return await drain { _ in true }
    }
    internal func flush(owner: FacetStore, profileID: String? = nil) async -> Bool {
        await transition(owner: owner, profileID: profileID) {}
    }
    internal func transition(
        owner: FacetStore, profileID: String? = nil, operation: @MainActor () async -> Void
    ) async -> Bool {
        guard !isTransitioning else { return false }
        isTransitioning = true
        defer { isTransitioning = false }
        guard
            await drain({
                $0.owner == ObjectIdentifier(owner)
                    && (profileID == nil || $0.profileID == profileID)
            })
        else { return false }
        await operation()
        return true
    }
    private func drain(_ matches: (Entry) -> Bool) async -> Bool {
        while true {
            let observed = generation
            let current = entries.values.filter(matches)
            for entry in current { guard await entry.flush() else { return false } }
            // A suspended flush may have gained another window. Drain it before
            // invalidating the shared engine; a newer dirty buffer vetoes teardown.
            if observed != generation { continue }
            return !entries.values.filter(matches).contains { $0.isDirty() }
        }
    }
}
