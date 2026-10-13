import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Applied deletion retires only the owning clean inspector") @MainActor
struct FacetInspectorRetirementTests {
    @Test(arguments: [false, true])
    func appliedDeleteRetiresBeforeOrAfterResultPrunesSelection(pruned: Bool) async throws {
        let context = try Context()
        let original = context.draft()
        var inspector: FacetInspectorDraft? = original
        let deletion = FacetBulkDraft()
        var executions = 0
        let operations = FacetBulkOperations(
            ownsProfile: { true },
            execute: { command, id, admission in
                executions += 1
                admission.record(id)
                #expect(
                    command["commands"]?.array?.elements.first?.object?.fields["kind"]
                        == .string("delete_checked"))
                if pruned {
                    context.window.selectedTaskIDs = []
                    context.window.generation += 1
                }
                return true
            }, isResolved: { _ in false })
        #expect(deletion.begin(context.selection.tasks, action: .delete, operations: operations))
        if await deletion.submit(), context.canRetire(original, current: inspector) {
            inspector = nil
        }
        #expect(executions == 1 && inspector == nil)
    }

    @Test func uncertainDeleteKeepsInspectorAndExactAdmission() async throws {
        let context = try Context()
        let original = context.draft()
        var inspector: FacetInspectorDraft? = original
        let deletion = FacetBulkDraft()
        let operations = FacetBulkOperations(
            ownsProfile: { true },
            execute: { _, id, admission in
                admission.record(id)
                return false
            }, isResolved: { _ in false })
        #expect(deletion.begin(context.selection.tasks, action: .delete, operations: operations))
        if await deletion.submit(), context.canRetire(original, current: inspector) {
            inspector = nil
        }
        #expect(inspector === original)
        #expect(deletion.admittedMutationID != nil && deletion.hasRetainedSubmission)
    }

    @Test func replacementDraftNewSelectionAndSelectionABASurvive() throws {
        let context = try Context()
        let original = context.draft()
        #expect(!context.canRetire(original, current: context.draft()))
        #expect(!context.canRetire(nil, current: original))
        #expect(!context.canRetire(original, current: nil))
        context.window.selectedTaskIDs = [
            FacetTaskRowID(taskID: "new-selection", occurrenceDate: nil)
        ]
        #expect(!context.canRetire(original, current: original))
        context.window.selectedTaskIDs = [context.task.rowID]
        #expect(!context.canRetire(original, current: original))
        context.window.selectedTaskIDs = []
        #expect(!context.canRetire(original, current: original))
    }

    @Test func profileTaskAndEngineChangesKeepTheInspector() async throws {
        let switched = try Context()
        let previous = switched.draft()
        switched.store.selectedProfileID = "another-profile"
        #expect(!switched.canRetire(previous, current: previous))
        switched.store.selectedProfileID = switched.snapshot.profileId
        #expect(!switched.canRetire(previous, current: previous))
        let context = try Context()
        let original = context.draft()
        let otherProfile = FacetInspectorDraft(task: context.task, profileID: "another-profile")
        #expect(!context.canRetire(otherProfile, current: otherProfile))
        var fields = try #require(
            FacetJSON.parse(JSONEncoder().encode(context.task)).object?.fields)
        fields["path"] = .string("Tasks/Moved.md")
        let moved = try FacetFeatureProjection.decode(FacetTask.self, from: .object(fields))
        let otherPath = FacetInspectorDraft(task: moved, profileID: context.snapshot.profileId)
        #expect(!context.canRetire(otherPath, current: otherPath))
        let scratch = try ScratchDirectory()
        let replacement = try await FacetEngine.open(
            directory: scratch.url, secrets: ComponentKeys())
        context.store.engine = replacement
        #expect(!context.canRetire(original, current: original))
        try await replacement.close()
    }

    @Test func newTypingAndRetainedSaveRemainOwned() async throws {
        let context = try Context()
        let original = context.draft()
        original.title += " newer typing"
        #expect(!context.canRetire(original, current: original))
        original.revert()
        original.markdown += "\nnew notes"
        #expect(!context.canRetire(original, current: original))
        var saving: FacetInspectorDraft?
        let retained = FacetInspectorDraft(
            task: context.task, profileID: context.snapshot.profileId,
            operations: FacetInspectorOperations(
                execute: { _, id, admission in
                    #expect(saving?.isSaving == true)
                    #expect(!context.canRetire(saving, current: saving))
                    admission.record(id)
                    return false
                }, read: { _ in context.snapshot }, reload: {}))
        saving = retained
        #expect(!(await retained.setStatus("doing", store: context.store, window: context.window)))
        #expect(!retained.isSaving && retained.admittedMutationID != nil)
        #expect(!context.canRetire(retained, current: retained))
    }

    @MainActor private struct Context {
        let store: FacetStore
        let snapshot: FacetSnapshot
        let task: FacetTask
        let window: FacetWindowState
        let selection: FacetReviewedSelection

        init() throws {
            let testStore = try FacetSurfaceFixtures.store(.populated)
            let testSnapshot = try #require(testStore.snapshot)
            let testTask = try #require(testSnapshot.tasks.first)
            let testWindow = FacetWindowState(store: testStore)
            testWindow.selectedTaskIDs = [testTask.rowID]
            store = testStore
            snapshot = testSnapshot
            task = testTask
            window = testWindow
            selection = try #require(
                FacetReviewedSelection(store: testStore, window: testWindow, snapshot: testSnapshot)
            )
        }

        func draft() -> FacetInspectorDraft {
            FacetInspectorDraft(task: task, profileID: snapshot.profileId)
        }

        func canRetire(_ submitted: FacetInspectorDraft?, current: FacetInspectorDraft?) -> Bool {
            selection.canRetireDeletedInspector(
                submitted: submitted, current: current, store: store, window: window)
        }
    }
}
