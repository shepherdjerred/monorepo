import AppKit
import Foundation
import SwiftUI
import TaskNotesKit
import TaskNotesMac
import TaskNotesTestSupport
import Testing

@testable import TaskNotesFacetUI

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
        let project = store.createProject(name: "Print Studio", color: "blue", isFavorite: true)
        let readySection = store.createSection(projectId: project.id, name: "Ready")
        let progressSection = store.createSection(projectId: project.id, name: "In Progress")
        let syncLabel = store.createLabel(name: "studio", color: "teal", isFavorite: true)
        _ = store.createFilter(
            name: "High Priority Today",
            query: "p1 & (today | overdue)",
            color: "red",
            isFavorite: true
        )
        _ = store.localStore.addTask(
            FacetTaskDraft(
                title: "Change the air filter",
                projectId: project.id,
                sectionId: readySection.id,
                description: "Check the spare in the supply cabinet.",
                priority: .p2,
                dueDate: "2026-06-14",
                labelIds: [syncLabel.id]
            )
        )
        let inspected = store.localStore.addTask(
            FacetTaskDraft(
                title: "Review the first print proof",
                projectId: project.id,
                sectionId: progressSection.id,
                description: "Check the margins and paper weight before ordering the full run.",
                priority: .p1,
                dueDate: "2026-06-15",
                recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
                labelIds: [syncLabel.id]
            )
        )
        _ = store.localStore.addTask(
            FacetTaskDraft(
                title: "Order new sketchbooks",
                projectId: inboxId,
                priority: .p3,
                dueDate: "2026-06-17"
            )
        )
        store.selectedTaskId = inspected.id
        return SeededWorkspace(store: store, projectId: project.id, taskId: inspected.id)
    }

    @Test("Workspace search includes undated tasks and subtask notes from other lists")
    func searchFromToday() throws {
        let store = try Self.seededStore().store
        store.destination = .section(.inbox)
        let task = try #require(store.createQuickTask(rawInput: "Pick up groceries"))
        let child = try #require(store.createSubtask(parentTask: task, title: "Buy milk"))
        store.patchTask(id: child.id, patch: FacetTaskPatch(description: "Grocery list"))
        store.destination = .section(.today)
        #expect(
            store.workspaceTasks(matching: "groceries", includeCompleted: false).map(\.id) == [
                task.id
            ])
        #expect(
            store.workspaceTasks(matching: "grocery list", includeCompleted: false).map(\.id) == [
                child.id
            ])
        store.toggleTaskCompletion(child)
        #expect(store.workspaceTasks(matching: "milk", includeCompleted: false).isEmpty)
        #expect(
            store.workspaceTasks(matching: "milk", includeCompleted: true).map(\.id) == [child.id])
    }

    @Test("A stale Undo notice cannot reverse an intervening task change")
    func undoUsesPresentedReceipt() throws {
        let store = try Self.seededStore().store
        let task = try #require(store.createQuickTask(rawInput: "Buy milk"))
        let receipt = try #require(store.toastReceiptID)
        store.patchTask(id: task.id, patch: FacetTaskPatch(priority: .p1))
        store.undoAction(for: receipt)
        #expect(store.task(for: task.id)?.priority == .p1)
        store.toggleTaskCompletion(task)
        store.undoAction(for: store.toastReceiptID)
        #expect(store.task(for: task.id)?.completed == false)
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

            var context = FacetTaskPatch()
            context.appendComment = CommentUpload(
                comment: TaskComment(
                    id: UUID().uuidString, body: "Waiting for the paper samples from the printer.",
                    created_at: "2026-06-15T08:00:00Z", file_name: nil),
                attachment_base64: nil)
            seededToday.store.localStore.updateTask(id: seededToday.taskId, patch: context)
            let task = try #require(seededToday.store.task(for: seededToday.taskId))
            let detail = try OffscreenSnapshot.write(
                FacetTaskInspectorView(task: task, store: seededToday.store),
                named: "facet-macos-task-detail",
                size: CGSize(width: 740, height: 520),
                appearance: appearance
            )
            #expect(detail.byteCount > 12_000)

            let upcoming = try Self.seededStore().store
            upcoming.destination = .section(.upcoming)
            let schedule = try OffscreenSnapshot.write(
                FacetRootView(store: upcoming),
                named: "facet-macos-upcoming",
                size: CGSize(width: 1180, height: 740),
                appearance: appearance
            )
            #expect(schedule.byteCount > 15_000)
        }
    }

    @Test("Renders the board, capture panel and settings in both appearances")
    func rendersSecondarySurfaces() throws {
        for appearance in SnapshotAppearance.allCases {
            let store = try Self.seededStore().store
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
                FacetCaptureForm(store: store, close: {}),
                named: "facet-macos-quick-add",
                size: CGSize(width: 560, height: 218),
                appearance: appearance
            )
            #expect(captureShot.byteCount > 3_000)

            let settingsShot = try OffscreenSnapshot.write(
                NavigationStack {
                    FacetSettingsAndOnboardingView(store: store, embeddedInTab: true)
                },
                named: "facet-macos-settings",
                size: CGSize(width: 560, height: 480),
                appearance: appearance
            )
            #expect(settingsShot.byteCount > 6_000)
        }
    }
}
