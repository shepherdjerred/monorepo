import TaskNotesKit

@MainActor
internal struct FacetOccurrenceMaintenanceOperations {
    let ready: () async throws -> Bool
    let prepare: (@escaping () -> Bool, FacetOccurrenceAdmission) async -> Bool
    let overview: () async throws -> FacetOccurrenceOverview
    let apply: (FacetOccurrenceTarget, @escaping () -> Bool, FacetOccurrenceAdmission) async -> Bool
}

@MainActor
internal struct FacetOccurrenceTargetOperations {
    let savedID: () async throws -> String?
    let execute: (String) async throws -> Void
    let cleanup: (String) async throws -> Void
}
