import Foundation
import Observation
import TaskNotesKit

/// Read-only metadata belongs to the original editor, engine and vault.
@Observable @MainActor internal final class FacetDependencyEditorState {
    private(set) var metadata: FacetDependencyEditor?
    private(set) var error: String?
    private(set) var isLoading = false
    private var generation: UInt64 = 0

    func load(
        ownsDraft: () -> Bool, read: () async throws -> FacetValue
    ) async {
        generation += 1
        let request = generation
        metadata = nil
        error = nil
        isLoading = true
        defer { if generation == request { isLoading = false } }
        guard ownsDraft() else {
            error = "Return to this editor’s original vault before loading relationship options."
            return
        }
        do {
            let value = try await read()
            guard generation == request, !_Concurrency.Task.isCancelled else { return }
            guard ownsDraft() else {
                error =
                    "The original vault is no longer selected. Your dependency draft is retained."
                return
            }
            try FacetSchema.bundled().validate(value, definition: "dependencyEditor")
            metadata = try FacetFeatureProjection.decode(FacetDependencyEditor.self, from: value)
        } catch {
            guard generation == request, !_Concurrency.Task.isCancelled else { return }
            self.error = FacetFailureDiagnostic(error).action
        }
    }

    func invalidate() {
        generation += 1
        metadata = nil
        error = nil
        isLoading = false
    }
}
