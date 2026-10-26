import Observation

/// Navigation events can arrive before a vault opens, and the same widget URL
/// can be opened repeatedly. A pending request never overrides a newer choice
/// or crosses the owning vault while a draft is being admitted.
@Observable @MainActor internal final class FacetMobileNavigation {
    var route: String {
        didSet { if route != oldValue { generation += 1 } }
    }
    private var generation: UInt64 = 0

    init(route: String) { self.route = route }

    @discardableResult func requestToday(
        ownsOwner: () -> Bool, admitNavigation: () async -> Bool
    ) async -> Bool {
        generation += 1
        let request = generation
        guard ownsOwner(), await admitNavigation(), ownsOwner(), request == generation,
            !_Concurrency.Task.isCancelled
        else { return false }
        route = "today"
        return true
    }
}
