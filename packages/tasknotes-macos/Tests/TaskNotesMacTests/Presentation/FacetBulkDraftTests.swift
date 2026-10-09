import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Bulk selection and immutable admission") @MainActor
struct FacetBulkDraftTests {
    @Test func reviewedSelectionDoesNotClearNewQueryOrSelectionABA() throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let window = FacetWindowState(store: store)
        let first = try #require(snapshot.tasks.first)
        window.selectedTaskIDs = [first.rowID]
        let selection = try #require(
            FacetReviewedSelection(store: store, window: window, snapshot: snapshot))
        #expect(selection.tasks.first?.revision == first.revision)
        window.selectedTaskIDs = []
        window.selectedTaskIDs = [first.rowID]
        selection.clearIfCurrent(store: store, window: window)
        #expect(window.selectedTaskIDs == [first.rowID])
        let current = try #require(
            FacetReviewedSelection(store: store, window: window, snapshot: snapshot))
        window.search = "new query not loaded yet"
        current.clearIfCurrent(store: store, window: window)
        #expect(window.selectedTaskIDs == [first.rowID])
        window.search = ""
        let originalOwner = try #require(
            FacetReviewedSelection(store: store, window: window, snapshot: snapshot))
        store.selectedProfileID = "other-vault"
        originalOwner.clearIfCurrent(store: store, window: window)
        #expect(window.selectedTaskIDs == [first.rowID])
    }

    @Test func unchangedSelectionClearsAndCanceledFlushCanRetry() throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let window = FacetWindowState(store: store)
        window.selectedTaskIDs = [try #require(snapshot.tasks.first).rowID]
        let selection = try #require(
            FacetReviewedSelection(store: store, window: window, snapshot: snapshot))
        selection.clearIfCurrent(store: store, window: window)
        #expect(window.selectedTaskIDs.isEmpty)
        let draft = FacetBulkDraft()
        let operations = FacetBulkOperations(
            ownsProfile: { true }, execute: { _, _, _ in false }, isResolved: { _ in false })
        #expect(draft.begin([try baseTask()], action: .complete, operations: operations))
        draft.cancelBeforeDispatch()
        #expect(!draft.hasRetainedSubmission && !draft.isSubmitting)
        #expect(draft.begin([try baseTask()], action: .delete, operations: operations))
    }

    @Test func occurrenceCompletionRejectsDuplicateNotesBeforeAdmission() throws {
        let task = try baseTask()
        let first = try edit(
            task, ["isRecurring": .bool(true), "occurrenceDate": .string("2026-10-09")])
        let second = try edit(first, ["occurrenceDate": .string("2026-10-10")])
        let draft = FacetBulkDraft()
        var executes = 0
        let operations = FacetBulkOperations(
            ownsProfile: { true },
            execute: { _, _, _ in
                executes += 1
                return true
            },
            isResolved: { _ in false })
        #expect(!draft.begin([first, second], action: .complete, operations: operations))
        #expect(executes == 0 && !draft.hasRetainedSubmission && !draft.isSubmitting)
        #expect(draft.error?.contains("separately") == true)
        let missing = try edit(first, ["occurrenceDate": .null])
        #expect(!draft.begin([missing], action: .complete, operations: operations))
        #expect(draft.error?.contains("Agenda") == true && executes == 0)
        let command = try facetBulkCommand([first], action: .complete)
        #expect(
            command["commands"]?.array?.elements.first?.object?.fields["occurrenceDate"]
                == .string("2026-10-09"))
        #expect(
            command["commands"]?.array?.elements.first?.object?.fields["expectedRevision"]
                == .string(task.revision))
    }

    @Test func noteActionsDeduplicateOnlyIdenticalReviewedRevisions() throws {
        let first = try baseTask()
        let second = try edit(first, ["occurrenceDate": .string("2026-10-10")])
        for action in [
            FacetBulkAction.update("scheduled", .null), .update("priority", .string("high")),
            .delete,
        ] {
            let command = try facetBulkCommand([first, second], action: action)
            #expect(command["commands"]?.array?.elements.count == 1)
            let stale = try edit(second, ["revision": .string("another-reviewed-revision")])
            #expect(throws: FacetBulkError.self) {
                try facetBulkCommand([first, stale], action: action)
            }
        }
        let distinct = try edit(
            first, ["id": .string("second"), "path": .string("Tasks/Second.md")])
        let command = try facetBulkCommand([first, distinct], action: .complete)
        #expect(command["commands"]?.array?.elements.count == 2)
        #expect(
            command["commands"]?.array?.elements.last?.object?.fields["path"]
                == .string("Tasks/Second.md"))
    }

    @Test func synchronousAdmissionAndUncertainRetryKeepExactBatch() async throws {
        let task = try baseTask()
        let draft = FacetBulkDraft()
        var offered: [(String, [String: FacetValue])] = []
        var resolved = false
        let operations = FacetBulkOperations(
            ownsProfile: { true },
            execute: { command, id, admission in
                offered.append((id, command))
                admission.record(id)
                return false
            }, isResolved: { _ in resolved })
        #expect(draft.begin([task], action: .complete, operations: operations))
        #expect(!draft.begin([task], action: .delete, operations: operations))
        #expect(!(await draft.submit()))
        #expect(draft.admittedMutationID == offered[0].0)
        #expect(!draft.begin([task], action: .delete, operations: operations))
        #expect(draft.beginRetry())
        #expect(!(await draft.submit()))
        #expect(offered.count == 2 && offered[0].0 == offered[1].0 && offered[0].1 == offered[1].1)
        #expect(!(await draft.releaseResolved()))
        resolved = true
        #expect(await draft.releaseResolved())
        #expect(draft.begin([task], action: .delete, operations: operations))
    }

    @Test func profileSwitchBeforeDispatchDoesNotAdmitAndAppliedCannotResubmit() async throws {
        let task = try baseTask()
        let draft = FacetBulkDraft()
        var owned = true
        var executes = 0
        let operations = FacetBulkOperations(
            ownsProfile: { owned },
            execute: { _, id, admission in
                executes += 1
                admission.record(id)
                return true
            }, isResolved: { _ in false })
        #expect(draft.begin([task], action: .complete, operations: operations))
        owned = false
        #expect(!(await draft.submit()))
        #expect(executes == 0 && draft.admittedMutationID == nil && !draft.hasRetainedSubmission)
        owned = true
        #expect(draft.begin([task], action: .complete, operations: operations))
        #expect(await draft.submit())
        #expect(!(await draft.submit()))
        #expect(executes == 1 && !draft.hasRetainedSubmission)
    }

    private func baseTask() throws -> FacetTask {
        let store = try FacetSurfaceFixtures.store(.populated)
        return try edit(
            try #require(store.snapshot?.tasks.first),
            ["isRecurring": .bool(false), "occurrenceDate": .null])
    }

    private func edit(_ task: FacetTask, _ changes: [String: FacetValue]) throws -> FacetTask {
        var fields = try #require(FacetJSON.parse(JSONEncoder().encode(task)).object?.fields)
        fields.merge(changes) { _, new in new }
        return try FacetFeatureProjection.decode(FacetTask.self, from: .object(fields))
    }
}
