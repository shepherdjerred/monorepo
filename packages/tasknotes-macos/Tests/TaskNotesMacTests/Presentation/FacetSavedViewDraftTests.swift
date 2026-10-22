import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Saved-view admission and observation") @MainActor
struct FacetSavedViewDraftTests {
    @Test func uncertainSaveKeepsBothIdentitiesAndRejectsEditedReplacement() async throws {
        let draft = FacetSavedViewDraft()
        var offered: [(String, [String: FacetValue])] = []
        let operations = FacetSavedViewOperations(
            ownsProfile: { true },
            execute: { command, id, admission in
                offered.append((id, command))
                admission.record(id)
                return false
            }, observe: { [] }, isResolved: { _ in false })
        let command: [String: FacetValue] = [
            "kind": .string("save_view"), "id": .string("fixed-view"),
            "view": .object(["name": .string("Original")]),
        ]
        #expect(draft.begin(command, operations: operations))
        #expect(draft.isSubmitting)
        #expect(!(draft.begin(["kind": .string("restore_default_views")], operations: operations)))
        #expect(await draft.submit() == nil)
        #expect(draft.admittedMutationID == offered[0].0)
        #expect(
            !draft.begin(
                ["kind": .string("save_view"), "id": .string("replacement")], operations: operations
            ))
        #expect(draft.beginRetry())
        #expect(await draft.submit() == nil)
        #expect(offered.count == 2)
        #expect(offered[0].0 == offered[1].0 && offered[0].1 == offered[1].1)
        #expect(!(await draft.releaseResolved()))
        #expect(draft.hasRetainedSubmission)
    }

    @Test func appliedSaveOnlyRepeatsObservationAndPreadmissionFailureAllowsEditing() async throws {
        let draft = FacetSavedViewDraft()
        var executes = 0
        var reads = 0
        let operations = FacetSavedViewOperations(
            ownsProfile: { true },
            execute: { _, id, admission in
                executes += 1
                admission.record(id)
                return true
            },
            observe: {
                reads += 1
                if reads == 1 { throw FacetContractError.unsupportedResponse }
                return []
            }, isResolved: { _ in true })
        #expect(draft.begin(["kind": .string("restore_default_views")], operations: operations))
        #expect(await draft.submit() == nil)
        #expect(draft.needsObservation)
        #expect(draft.beginRetry())
        #expect(await draft.submit() != nil)
        #expect(executes == 1 && reads == 2)
        #expect(!draft.hasRetainedSubmission)
        let rejected = FacetSavedViewOperations(
            ownsProfile: { true }, execute: { _, _, _ in false },
            observe: { [] }, isResolved: { _ in false })
        #expect(draft.begin(["kind": .string("restore_default_views")], operations: rejected))
        #expect(await draft.submit() == nil)
        #expect(!draft.hasRetainedSubmission)
        #expect(draft.begin(["kind": .string("save_view")], operations: rejected))
    }
}
