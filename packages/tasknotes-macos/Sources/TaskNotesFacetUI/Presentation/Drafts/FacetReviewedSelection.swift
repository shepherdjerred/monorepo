import Foundation
import TaskNotesKit

/// Reviewed rows are captured before a flush or sheet can suspend the caller.
@MainActor internal struct FacetReviewedSelection: Identifiable {
    let id = UUID()
    let profileID: String
    let tasks: [FacetTask]
    private let engine: FacetEngine?
    private let rows: Set<FacetTaskRowID>
    private let selectionGeneration: UInt64
    private let queryGeneration: UInt64
    private let query: FacetValue?
    private let queryState: FacetValue

    init?(store: FacetStore, window: FacetWindowState, snapshot: FacetSnapshot) {
        guard store.selectedProfileID == snapshot.profileId, !window.selectedTaskIDs.isEmpty else {
            return nil
        }
        tasks = snapshot.tasks.filter { window.selectedTaskIDs.contains($0.rowID) }
        guard tasks.count == window.selectedTaskIDs.count else { return nil }
        profileID = snapshot.profileId
        engine = store.engine
        rows = window.selectedTaskIDs
        selectionGeneration = window.selectionGeneration
        queryGeneration = window.generation
        query = window.displayedQuery
        queryState = Self.queryState(window)
    }

    func clearIfCurrent(store: FacetStore, window: FacetWindowState) {
        guard store.engine === engine, store.selectedProfileID == profileID,
            window.selectedTaskIDs == rows, window.selectionGeneration == selectionGeneration,
            window.generation == queryGeneration, window.displayedQuery == query,
            Self.queryState(window) == queryState
        else { return }
        window.selectedTaskIDs = []
    }

    private static func queryState(_ window: FacetWindowState) -> FacetValue {
        .object([
            "scope": .string(window.scope), "text": .string(window.search),
            "status": .string(window.status), "priority": .string(window.priority),
            "completed": .bool(window.showCompleted), "archived": .bool(window.includeArchived),
            "board": .bool(window.board), "saved": .object(window.savedQuery),
            "view": window.selectedViewID.map(FacetValue.string) ?? .null,
        ])
    }
}
