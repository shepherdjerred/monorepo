import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Complete Browse vocabulary and occurrence groups") @MainActor
struct FacetVocabularyAndGroupsTests {
    @Test func vocabularyReadsAllPagesAndRestartsChangedVersionWithoutChangingWindowQuery()
        async throws
    {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let original = try #require(snapshot.tasks.first)
        let first = try task(original, properties: ["projects": .array([.string("First page")])])
        let second = try task(
            original, properties: ["projects": .array([.string("Other project")])])
        let window = FacetWindowState(store: store)
        window.scope = "today"
        window.search = "Only the focused task"
        window.savedQuery = ["tags": .array([.string("filtered")])]
        let before = try window.query()
        var reads = 0
        await window.reloadVocabulary(
            store: store, profileID: snapshot.profileId,
            read: { query in
                #expect(query.object?.fields["scope"] == .string("all"))
                #expect(query.object?.fields["text"] == nil && query.object?.fields["tags"] == nil)
                reads += 1
                let offset = query.object?.fields["offset"]
                let row = offset == .integer(0) ? first : second
                return try page(snapshot, task: row, version: reads == 1 ? 1 : 2, total: 2)
            })
        #expect(reads == 4)
        #expect(window.vocabulary["projects"] == ["First page", "Other project"])
        #expect(try window.query() == before)
    }

    @Test func repeatedNoteIDsConsumeOneOccurrencePerGroupEntry() throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let original = try #require(store.snapshot?.tasks.first)
        let first = try task(
            original,
            fields: [
                "occurrenceDate": .string("2026-10-05"), "effectiveDate": .string("2026-10-05"),
            ])
        let second = try task(
            original,
            fields: [
                "occurrenceDate": .string("2026-10-06"), "effectiveDate": .string("2026-10-06"),
            ])
        let byStatus = FacetTaskGroup(key: "open", taskIds: [original.id, original.id])
        #expect(
            FacetTaskGroupPresentation.tasks([first, second], in: byStatus, groupBy: "status").map(
                \.rowID) == [first.rowID, second.rowID])
        let byDay = FacetTaskGroup(key: "2026-10-06", taskIds: [original.id])
        #expect(
            FacetTaskGroupPresentation.tasks([first, second], in: byDay, groupBy: "effectiveDate")
                .map(\.rowID) == [second.rowID])
    }

    @Test func boardTransferPreservesOccurrenceRevisionAndVaultOwner() throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let selected = try #require(snapshot.tasks.first)
        let item = FacetBoardDragItem(
            profileID: snapshot.profileId, taskID: selected.id,
            occurrenceDate: selected.occurrenceDate, revision: selected.revision)
        #expect(item.task(in: snapshot)?.rowID == selected.rowID)
        let wrongOwner = FacetBoardDragItem(
            profileID: "another-vault", taskID: selected.id,
            occurrenceDate: selected.occurrenceDate, revision: selected.revision)
        let wrongRevision = FacetBoardDragItem(
            profileID: snapshot.profileId, taskID: selected.id,
            occurrenceDate: selected.occurrenceDate, revision: "stale")
        let wrongOccurrence = FacetBoardDragItem(
            profileID: snapshot.profileId, taskID: selected.id,
            occurrenceDate: "2099-12-31", revision: selected.revision)
        #expect(wrongOwner.task(in: snapshot) == nil)
        #expect(wrongRevision.task(in: snapshot) == nil)
        #expect(wrongOccurrence.task(in: snapshot) == nil)
    }

    @Test func paginationAcceptsDistinctOccurrencesAndRejectsDuplicateRowsOrChangedVersion() throws
    {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let original = try #require(snapshot.tasks.first)
        let first = try task(original, fields: ["occurrenceDate": .string("2026-10-05")])
        let second = try task(original, fields: ["occurrenceDate": .string("2026-10-06")])
        let firstPage = try page(snapshot, task: first, version: 1, total: 2)
        let nextPage = try page(snapshot, task: second, version: 1, total: 2)
        #expect(
            try firstPage.appending(nextPage).tasks.map(\.rowID) == [first.rowID, second.rowID])
        #expect(throws: FacetContractError.unsupportedResponse) {
            try firstPage.appending(firstPage)
        }
        let changedVersion = try page(snapshot, task: second, version: 2, total: 2)
        #expect(throws: FacetContractError.unsupportedResponse) {
            try firstPage.appending(changedVersion)
        }
    }

    private func task(
        _ original: FacetTask, properties: [String: FacetValue] = [:],
        fields changes: [String: FacetValue] = [:]
    ) throws -> FacetTask {
        var fields = try #require(FacetJSON.parse(JSONEncoder().encode(original)).object?.fields)
        var metadata = original.properties
        metadata.merge(properties) { _, replacement in replacement }
        fields["properties"] = .object(metadata)
        fields.merge(changes) { _, replacement in replacement }
        return try FacetFeatureProjection.decode(FacetTask.self, from: .object(fields))
    }

    private func page(_ original: FacetSnapshot, task: FacetTask, version: Int64, total: Int64)
        throws -> FacetSnapshot
    {
        var fields = try #require(FacetJSON.parse(JSONEncoder().encode(original)).object?.fields)
        fields["tasks"] = .array([try FacetJSON.parse(JSONEncoder().encode(task))])
        fields["version"] = .integer(version)
        fields["totalCount"] = .integer(total)
        return try FacetFeatureProjection.decode(FacetSnapshot.self, from: .object(fields))
    }
}
