import CoreTransferable
import TaskNotesKit
import UniformTypeIdentifiers

internal struct FacetBoardDragItem: Codable, Transferable, Sendable {
    let profileID: String
    let taskID: String
    let occurrenceDate: String?
    let revision: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .facetBoardRow)
    }
    func task(in snapshot: FacetSnapshot) -> FacetTask? {
        guard profileID == snapshot.profileId else { return nil }
        return snapshot.tasks.first {
            $0.id == taskID && $0.occurrenceDate == occurrenceDate && $0.revision == revision
        }
    }
}

extension UTType {
    nonisolated fileprivate static let facetBoardRow = UTType(exportedAs: "red.sjer.facet.task-row")
}
