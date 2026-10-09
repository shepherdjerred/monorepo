import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Native field commits and authoritative observation") @MainActor
struct FacetInspectorDraftTests {
    @Test func titleCommitDoesNotFlushMarkdownAndKeepsOccurrenceForNextStatus() async throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let task = try edit(
            try #require(snapshot.tasks.first), ["occurrenceDate": .string("2026-10-05")])
        let observed = try edit(
            task,
            [
                "title": .string("Saved title"),
                "revision": .string(String(repeating: "b", count: 64)), "occurrenceDate": .null,
            ])
        let page = try replacing(snapshot, task: observed)
        var commands: [[String: FacetValue]] = []
        let operations = FacetInspectorOperations(
            execute: { command, id, admission in
                commands.append(command)
                admission.record(id)
                return true
            },
            read: { query in
                #expect(query.object?.fields["scope"] == .string("all"))
                #expect(query.object?.fields["today"] == .string("2026-10-05"))
                return page
            }, reload: {})
        let draft = FacetInspectorDraft(
            task: task, profileID: snapshot.profileId, operations: operations)
        let window = FacetWindowState(store: store)
        draft.title = "Saved title"
        draft.markdown = "Unsubmitted Markdown"
        #expect(await draft.commitTitle(store: store, window: window))
        #expect(commands[0]["body"] == nil)
        #expect(commands[0]["properties"] == .object(["title": .string("Saved title")]))
        #expect(draft.markdown == "Unsubmitted Markdown")
        #expect(draft.rowID == task.rowID)
        #expect(await draft.setStatus("doing", store: store, window: window))
        #expect(commands[1]["occurrenceDate"] == .string("2026-10-05"))
        #expect(commands[1]["expectedRevision"] == .string(observed.revision))
    }

    @Test func savedReceiptRetriesObservationWithoutExecutingAgain() async throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let task = try #require(snapshot.tasks.first)
        let saved = try edit(
            task,
            [
                "title": .string("Submitted title"),
                "revision": .string(String(repeating: "b", count: 64)),
            ])
        let page = try replacing(snapshot, task: saved)
        var executes = 0
        var reads = 0
        let draft = FacetInspectorDraft(
            task: task, profileID: snapshot.profileId,
            operations: FacetInspectorOperations(
                execute: { _, id, admission in
                    executes += 1
                    admission.record(id)
                    return true
                },
                read: { _ in
                    reads += 1
                    if reads == 1 { throw FacetContractError.unsupportedResponse }
                    return page
                }, reload: {}))
        let window = FacetWindowState(store: store)
        draft.title = "Submitted title"
        #expect(!(await draft.commitTitle(store: store, window: window)))
        #expect(draft.needsObservation)
        draft.title = "Newer typing"
        #expect(await draft.retry(store: store, window: window))
        #expect(executes == 1)
        #expect(reads == 2)
        #expect(draft.task.title == "Submitted title")
        #expect(draft.title == "Newer typing")
        #expect(!draft.needsObservation)
    }

    @Test func uncertainAdmissionKeepsExactEnvelopeAndRejectsReplacement() async throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let task = try #require(snapshot.tasks.first)
        var submissions: [(String, [String: FacetValue])] = []
        let draft = FacetInspectorDraft(
            task: task, profileID: snapshot.profileId,
            operations: FacetInspectorOperations(
                execute: { command, id, admission in
                    submissions.append((id, command))
                    admission.record(id)
                    return false
                },
                read: { _ in snapshot }, reload: {}))
        let window = FacetWindowState(store: store)
        draft.title = "Original submission"
        #expect(!(await draft.commitTitle(store: store, window: window)))
        let retained = try #require(draft.admittedMutationID)
        draft.title = "Newer buffer"
        #expect(!(await draft.commitTitle(store: store, window: window)))
        #expect(submissions.count == 1)
        #expect(!(await draft.retry(store: store, window: window)))
        #expect(submissions.count == 2)
        #expect(submissions[0].0 == retained && submissions[1].0 == retained)
        #expect(submissions[0].1 == submissions[1].1)
        #expect(draft.title == "Newer buffer")
    }

    @Test func openWorkflowValuesRemainVisibleAndSelectable() throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let task = try edit(
            try #require(snapshot.tasks.first),
            ["status": .string("waiting-on-client"), "priority": .string("custom-urgent")])
        let presentation = try FacetTaskPresentation(
            task: task, configuration: snapshot.configuration)
        #expect(presentation.status.value == "waiting-on-client")
        #expect(presentation.priority.value == "custom-urgent")
        #expect(presentation.status.configurationDiagnostic != nil)
        #expect(presentation.priority.configurationDiagnostic != nil)
        #expect(presentation.status.color == nil && presentation.priority.color == nil)
    }

    private func edit(_ task: FacetTask, _ changes: [String: FacetValue]) throws -> FacetTask {
        var fields = try #require(FacetJSON.parse(JSONEncoder().encode(task)).object?.fields)
        fields.merge(changes) { _, new in new }
        return try FacetFeatureProjection.decode(FacetTask.self, from: .object(fields))
    }
    private func replacing(_ snapshot: FacetSnapshot, task: FacetTask) throws -> FacetSnapshot {
        var fields = try #require(FacetJSON.parse(JSONEncoder().encode(snapshot)).object?.fields)
        fields["tasks"] = .array([try FacetJSON.parse(JSONEncoder().encode(task))])
        fields["totalCount"] = .integer(1)
        return try FacetFeatureProjection.decode(FacetSnapshot.self, from: .object(fields))
    }
}
