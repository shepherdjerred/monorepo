import Foundation
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@Suite("FacetLiveServerSyncTests", .serialized)
struct FacetLiveServerSyncTests {
    private struct SeededIDs {
        let projectId: String
        let sectionId: String
        let labelId: String
        let filterId: String
        let taskId: String
        let reminderId: String
    }

    @Test("End-to-end /api/v1/sync round-trip: auth, temp_id_mapping, nullable clear, recurrence")
    @MainActor
    func liveSyncAgainstSpawnedServer() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }

        let scratch = try TemporaryDirectory()
        let dbA = try FacetSQLiteDatabase(
            fileURL: scratch.url.appending(path: "clientA/facet-sync.sqlite3")
        )
        let storeA = FacetLocalStore(database: dbA)

        let unauthClient = FacetAPIClient(baseURL: server.baseURL, authToken: "wrong-token")
        await #expect(throws: FacetAPIError.self) {
            try await storeA.sync(client: unauthClient)
        }
        #expect(storeA.lastError != nil)

        let client = FacetAPIClient(baseURL: server.baseURL, authToken: server.authToken)
        let localIDs = Self.seedInitialWorkspace(into: storeA)
        try await storeA.sync(client: client)
        #expect(storeA.outbox.isEmpty)
        #expect(storeA.lastError == nil)

        let serverTaskId = try Self.verifyMappedEntities(in: storeA, local: localIDs)
        try await Self.verifySecondClientDeltaAndClearing(
            scratch: scratch,
            storeA: storeA,
            client: client,
            serverTaskId: serverTaskId
        )
        await dbA.close()
    }

    @MainActor
    private static func seedInitialWorkspace(into store: FacetLocalStore) -> SeededIDs {
        let project = store.addProject(name: "Platform", color: "teal", isFavorite: true)
        let section = store.addSection(projectId: project.id, name: "Cutover")
        let label = store.addLabel(name: "apple", color: "blue", isFavorite: true)
        let filter = store.addFilter(
            name: "Apple Cutover",
            query: "#Platform & @apple",
            color: "grape",
            isFavorite: true
        )
        let task = store.addTask(
            FacetTaskDraft(
                title: "Verify SQLite sync",
                projectId: project.id,
                sectionId: section.id,
                description: "End-to-end check",
                priority: .p1,
                dueDate: "2026-06-15",
                recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
                labelIds: [label.id]
            )
        )
        let reminder = store.addReminder(
            taskId: task.id,
            reminderType: "absolute",
            dueDatetime: "2026-06-15T09:00:00Z"
        )
        return SeededIDs(
            projectId: project.id,
            sectionId: section.id,
            labelId: label.id,
            filterId: filter.id,
            taskId: task.id,
            reminderId: reminder.id
        )
    }

    @MainActor
    private static func verifyMappedEntities(
        in store: FacetLocalStore,
        local: SeededIDs
    ) throws -> String {
        let serverProjectId = try #require(store.lastTempIdMapping[local.projectId])
        let serverSectionId = try #require(store.lastTempIdMapping[local.sectionId])
        let serverLabelId = try #require(store.lastTempIdMapping[local.labelId])
        let serverFilterId = try #require(store.lastTempIdMapping[local.filterId])
        let serverTaskId = try #require(store.lastTempIdMapping[local.taskId])
        let serverReminderId = try #require(store.lastTempIdMapping[local.reminderId])

        let syncedTask = try #require(store.tasks.first { $0.id == serverTaskId })
        #expect(syncedTask.project_id == serverProjectId)
        #expect(syncedTask.section_id == serverSectionId)
        #expect(syncedTask.label_ids == [serverLabelId])
        #expect(store.filters.contains { $0.id == serverFilterId })
        #expect(store.reminders.contains { $0.id == serverReminderId })
        return serverTaskId
    }

    @MainActor
    private static func verifySecondClientDeltaAndClearing(
        scratch: TemporaryDirectory,
        storeA: FacetLocalStore,
        client: FacetAPIClient,
        serverTaskId: String
    ) async throws {
        let dbB = try FacetSQLiteDatabase(
            fileURL: scratch.url.appending(path: "clientB/facet-sync.sqlite3")
        )
        let storeB = FacetLocalStore(database: dbB)
        try await storeB.sync(client: client)
        #expect(storeB.tasks.contains { $0.id == serverTaskId && $0.title == "Verify SQLite sync" })

        let completionInstant = try #require(ViewerCalendar.parseISO8601("2026-06-15T12:00:00Z"))
        storeA.completeTask(id: serverTaskId, at: completionInstant)
        try await storeA.sync(client: client)
        try await storeB.sync(client: client)

        let clientBRecurring = try #require(storeB.tasks.first { $0.id == serverTaskId })
        #expect(clientBRecurring.completed == false)
        #expect(clientBRecurring.due_date == "2026-06-22")

        storeB.updateTask(
            id: serverTaskId,
            patch: FacetTaskPatch(sectionId: .clear, recurrenceRule: .clear)
        )
        try await storeB.sync(client: client)
        try await storeA.sync(client: client)

        let clearedOnA = try #require(storeA.tasks.first { $0.id == serverTaskId })
        #expect(clearedOnA.section_id == nil)
        #expect(clearedOnA.recurrence_rule == nil)
        #expect(clearedOnA.is_recurring == false)
        await dbB.close()
    }
}
