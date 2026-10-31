import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@MainActor
struct FacetOccurrenceStoreTests {
    @Test func offscreenMaintenanceSettlesSilentlyAndRecreatesLaterDeletedChild() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { removeFixture(root) }
        let visible = root.appendingPathComponent("visible")
        let offscreen = root.appendingPathComponent("offscreen")
        try FileManager.default.createDirectory(at: visible, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: offscreen, withIntermediateDirectories: true)
        let engine = try await FacetEngine.open(
            directory: root.appendingPathComponent("engine"), secrets: ComponentKeys())
        let selected = try await engine.registerLocal(directory: visible, approveStandard: true)
        let background = try await engine.registerLocal(directory: offscreen, approveStandard: true)
        _ = try await engine.refresh(profileID: selected.id)
        _ = try await engine.refresh(profileID: background.id)
        try await engine.execute(
            profileID: background.id,
            command: .object([
                "kind": .string("create"),
                "properties": .object([
                    "title": .string("Synthetic series"),
                    "recurrence": .string("DTSTART:20261024;FREQ=DAILY"),
                    "scheduled": .string("2026-10-24"),
                    "occurrenceMaterialization": .string("rolling"),
                ]),
            ]))
        let instant = try #require(ISO8601DateFormatter().date(from: "2026-10-24T12:00:00Z"))
        let zone = try #require(TimeZone(identifier: "UTC"))
        let store = FacetStore(clock: SystemClock(timeZone: zone, instant: { instant }))
        store.engine = engine
        store.profiles = [selected, background]
        store.selectedProfileID = selected.id
        store.requestOccurrenceMaintenance(profileID: background.id)
        await store.occurrenceWorker?.value
        #expect(store.occurrenceQueue.isSettled)
        #expect(store.occurrenceWorker == nil)
        #expect(store.occurrenceIssues[background.id] == nil)
        #expect(store.selectedProfileID == selected.id)
        #expect(store.appliedFeedback == nil)
        #expect(store.savedNotice == nil)
        let first = try await children(engine, profileID: background.id)
        #expect(first.count == 15)
        let removed = try #require(first.first)
        let childFile = offscreen.appendingPathComponent(removed.path)
        try FileManager.default.removeItem(at: childFile)
        store.requestOccurrenceMaintenance(profileID: background.id)
        await store.occurrenceWorker?.value
        #expect(store.occurrenceQueue.isSettled)
        #expect(store.occurrenceIssues[background.id] == nil)
        #expect(try await children(engine, profileID: background.id).count == first.count)
        #expect(FileManager.default.fileExists(atPath: childFile.path))
        #expect(store.appliedFeedback == nil)
        try await engine.close()
    }

    private func children(_ engine: FacetEngine, profileID: String) async throws -> [FacetTask] {
        try await engine.snapshot(profileID: profileID, query: .object([:])).tasks.filter {
            $0.properties["recurrenceParent"] != nil
        }
    }

    private func removeFixture(_ directory: URL) {
        do { try FileManager.default.removeItem(at: directory) } catch {
            Issue.record("Occurrence fixture cleanup failed: \(error)")
        }
    }
}
