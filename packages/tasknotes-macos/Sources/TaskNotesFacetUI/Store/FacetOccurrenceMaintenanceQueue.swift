import Foundation

/// Requests arriving during discovery or draining remain dirty. There is no
/// parent/day cache: deleting a generated child must make its parent eligible again.
@MainActor
internal struct FacetOccurrenceMaintenanceQueue {
    private var pending: [String] = []
    private var requested: Set<String> = []
    private(set) var active: String?

    mutating func request(_ profileID: String) {
        if requested.insert(profileID).inserted { pending.append(profileID) }
    }

    mutating func next() -> String? {
        guard active == nil, !pending.isEmpty else { return nil }
        let profileID = pending.removeFirst()
        requested.remove(profileID)
        active = profileID
        return profileID
    }

    mutating func finish() { active = nil }
    var isSettled: Bool { active == nil && pending.isEmpty }
}
