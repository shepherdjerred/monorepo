import AppKit
import Foundation
import SwiftUI
import TaskNotesFacetUI
import TaskNotesKit
import TaskNotesMac
import TaskNotesTestSupport
import Testing

@Suite("Facet Todoist Workspace & Visual Snapshots")
@MainActor
struct FacetWorkspaceAndSnapshotTests {
    private struct SeededWorkspace {
        let store: FacetStore
        let projectId: String
        let taskId: String
    }

    private static func seededStore() throws -> SeededWorkspace {
        let database = try FacetSQLiteDatabase(inMemoryNamed: ":memory:")
        let fixedInstant = try #require(ViewerCalendar.parseISO8601("2026-06-15T09:30:00Z"))
        let calendar = ViewerCalendar(today: "2026-06-15", timeZone: .gmt, instant: fixedInstant)
        let local = FacetLocalStore(database: database)
        let inboxId = seedInboxProject(in: local)

        let store = FacetStore(
            localStore: local,
            tokenStore: InMemoryTokenStore(token: "test-token"),
            serverConfig: FacetServerConfiguration(
                suiteName: "red.sjer.facet.snapshot.\(UUID().uuidString)"
            ),
            calendar: calendar,
            isIsolatedLaunch: true
        )
        return populateWorkspace(store: store, inboxId: inboxId)
    }

    private static func seedInboxProject(in local: FacetLocalStore) -> String {
        let inbox = local.addProject(name: "Inbox", color: "charcoal")
        local.projects[0] = Project(
            id: inbox.id,
            user_id: "user-1",
            name: "Inbox",
            color: "charcoal",
            parent_id: nil,
            child_order: 0,
            is_inbox: true,
            is_favorite: false,
            is_archived: false,
            is_deleted: false,
            created_at: inbox.created_at,
            updated_at: inbox.updated_at
        )
        return inbox.id
    }

    private static func populateWorkspace(store: FacetStore, inboxId: String) -> SeededWorkspace {
        let project = store.createProject(name: "Apple Cutover", color: "blue", isFavorite: true)
        let readySection = store.createSection(projectId: project.id, name: "Ready")
        let progressSection = store.createSection(projectId: project.id, name: "In Progress")
        let syncLabel = store.createLabel(name: "sqlite", color: "teal", isFavorite: true)
        _ = store.createFilter(
            name: "High Priority Today",
            query: "p1 & (today | overdue)",
            color: "red",
            isFavorite: true
        )
        _ = store.localStore.addTask(
            FacetTaskDraft(
                title: "Delete legacy UniFFI bridge",
                projectId: project.id,
                sectionId: readySection.id,
                description: "Remove `TaskNotesUniFFI` target and Rust XCFramework scripts.",
                priority: .p2,
                dueDate: "2026-06-14",
                labelIds: [syncLabel.id]
            )
        )
        let inspected = store.localStore.addTask(
            FacetTaskDraft(
                title: "Verify /api/v1/sync + SQLite WAL",
                projectId: project.id,
                sectionId: progressSection.id,
                description: "### Acceptance\n- Atomic `BEGIN IMMEDIATE`\n- `temp_id_mapping`",
                priority: .p1,
                dueDate: "2026-06-15",
                recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
                labelIds: [syncLabel.id]
            )
        )
        _ = store.localStore.addTask(
            FacetTaskDraft(
                title: "Write release verification notes",
                projectId: inboxId,
                priority: .p3,
                dueDate: "2026-06-17"
            )
        )
        store.selectedTaskId = inspected.id
        store.showsInspector = true
        return SeededWorkspace(store: store, projectId: project.id, taskId: inspected.id)
    }

    @Test("Todoist views, Kanban board moves, Undo, and deep links update state cleanly")
    func workspaceQueriesAndBoardMoves() throws {
        let seeded = try Self.seededStore()
        let store = seeded.store

        #expect(store.inboxCount == 1)
        #expect(store.todayCount == 2)
        #expect(store.todayGroups.count == 2)
        #expect(store.todayGroups[0].isOverdue == true)
        #expect(store.todayGroups[1].tasks.map(\.id) == [seeded.taskId])
        #expect(store.upcomingWeekSlots.count == 7)

        let projectColumns = store.boardColumns(forProject: seeded.projectId)
        #expect(projectColumns.map(\.title) == ["No section", "Ready", "In Progress"])

        store.moveTaskOnBoard(
            taskId: seeded.taskId,
            to: .projectNoSection(projectId: seeded.projectId)
        )
        #expect(store.task(for: seeded.taskId)?.section_id == nil)

        let boardURL = try #require(URL(string: "tasknotes://kanban"))
        store.handleURL(boardURL)
        #expect(store.destination == .board)
        #expect(store.priorityBoardColumns.count == 4)
    }

    @Test(
        "Renders Todoist workspace, Project Kanban board, Quick Add, and Settings in Light & Dark")
    func rendersWorkspaceAndBoardsSnapshots() throws {
        for appearance in SnapshotAppearance.allCases {
            let seededToday = try Self.seededStore()
            seededToday.store.destination = .section(.today)
            let todayShot = try OffscreenSnapshot.write(
                FacetRootView(store: seededToday.store),
                named: "facet-macos-today-workspace",
                size: CGSize(width: 1180, height: 740),
                appearance: appearance
            )
            #expect(todayShot.byteCount > 15_000)
            #expect(todayShot.distinctColors >= 8)

            let seededBoard = try Self.seededStore()
            seededBoard.store.destination = .project(id: seededBoard.projectId)
            seededBoard.store.setLayout(.board, forProject: seededBoard.projectId)
            seededBoard.store.showsInspector = false
            let boardShot = try OffscreenSnapshot.write(
                FacetRootView(store: seededBoard.store),
                named: "facet-macos-project-board",
                size: CGSize(width: 1180, height: 720),
                appearance: appearance
            )
            #expect(boardShot.byteCount > 12_000)
            #expect(boardShot.distinctColors >= 6)

            let captureShot = try OffscreenSnapshot.write(
                FacetCaptureForm(store: seededToday.store, close: {}),
                named: "facet-macos-quick-add",
                size: CGSize(width: 560, height: 190),
                appearance: appearance
            )
            #expect(captureShot.byteCount > 3_000)

            let settingsShot = try OffscreenSnapshot.write(
                NavigationStack {
                    FacetSettingsAndOnboardingView(store: seededToday.store, embeddedInTab: true)
                },
                named: "facet-macos-settings",
                size: CGSize(width: 560, height: 480),
                appearance: appearance
            )
            #expect(settingsShot.byteCount > 6_000)
        }
    }
}
