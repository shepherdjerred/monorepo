import Foundation
import SwiftUI
import TaskNotesKit
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesMac

@Suite("Standalone task surfaces", .serialized)
@MainActor
struct FacetTaskSurfaceSnapshotTests {
    @Test(arguments: SnapshotAppearance.allCases)
    func taskEditor(appearance: SnapshotAppearance) throws {
        let snapshot = try snapshot()
        let task = try #require(snapshot.tasks.first)
        let result = try OffscreenSnapshot.write(
            FacetTaskEditor(
                store: store(snapshot), task: task, profileID: snapshot.profileId,
                statuses: [("open", "Open"), ("done", "Done")],
                priorities: [("normal", "Normal"), ("high", "High")]
            )
            .environment(\.locale, Locale(identifier: "en_US"))
            .environment(\.timeZone, try #require(TimeZone(secondsFromGMT: 0))),
            named: "facet-task-editor", size: CGSize(width: 1000, height: 1100),
            appearance: appearance)
        #expect(result.distinctColors > 8)
        #expect(result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
    }

    @Test(arguments: SnapshotAppearance.allCases)
    func taskBrowser(appearance: SnapshotAppearance) throws {
        let snapshot = try snapshot()
        let result = try OffscreenSnapshot.write(
            NavigationStack {
                FacetTaskBrowser(
                    store: store(snapshot), snapshot: snapshot, board: .constant(false)
                )
                .navigationTitle("Tasks")
            }
            .environment(\.locale, Locale(identifier: "en_US"))
            .environment(\.timeZone, try #require(TimeZone(secondsFromGMT: 0))),
            named: "facet-task-browser", size: CGSize(width: 800, height: 280),
            appearance: appearance)
        #expect(result.distinctColors > 8)
        #expect(result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
    }

    private func store(_ snapshot: FacetSnapshot) -> FacetStore {
        let store = FacetStore()
        store.selectedProfileID = snapshot.profileId
        store.snapshot = snapshot
        return store
    }

    private func snapshot() throws -> FacetSnapshot {
        let value = try FacetFeatureProjection.parseJSON(
            """
            {"schemaVersion":1,"profileId":"local-vault","version":1,
             "tasks":[{"id":"Tasks/Plan release.md","path":"Tasks/Plan release.md",
               "title":"Plan release","status":"open","priority":"high",
               "completed":false,"revision":"\(String(repeating: "a", count: 64))",
               "properties":{"due":"2026-10-12","scheduled":"2026-10-09",
                 "dateCreated":"2026-10-08T12:00:00Z","projects":["Work"],
                 "contexts":["desk"],"tags":["release"],"recurrence":"FREQ=WEEKLY",
                 "reminders":[],"blockedBy":[]},
               "body":"Prepare the release checklist.","isRecurring":true,
               "isBlocked":false,"isBlocking":false,"isPending":false,
               "occurrenceDate":null,"effectiveDate":null}],
             "totalCount":1,"pendingCount":0,"pendingTaskIds":[],"conflictCount":0,
             "configuration":{},"problems":[],"views":[],"groups":[]}
            """)
        return try FacetFeatureProjection.decode(FacetSnapshot.self, from: value)
    }
}

@Suite("Current Facet surfaces, rendered offscreen", .serialized)
@MainActor
struct FacetGallerySnapshotTests {
    @Test(arguments: FacetGallerySurface.allCases)
    func surface(_ surface: FacetGallerySurface) throws {
        let store = try FacetSurfaceFixtures.store(surface)
        #expect(store.engine == nil)
        try record(
            try content(surface, store: store)
                .environment(\.locale, Locale(identifier: "en_US"))
                .environment(\.timeZone, try #require(TimeZone(secondsFromGMT: 0))),
            named: "facet-gallery-" + surface.rawValue, size: surface.size, appearance: .light)
    }

    @Test(arguments: [
        FacetGallerySurface.board, .relationships, .conflicts, .retired, .preferences,
    ])
    func darkAppearance(_ surface: FacetGallerySurface) throws {
        let store = try FacetSurfaceFixtures.store(surface)
        try record(
            try content(surface, store: store)
                .environment(\.locale, Locale(identifier: "en_US"))
                .environment(\.timeZone, try #require(TimeZone(secondsFromGMT: 0))),
            named: "facet-gallery-" + surface.rawValue, size: surface.size, appearance: .dark)
    }

    @Test(arguments: [FacetGallerySurface.onboarding, .keepBoth])
    func narrowMacOSLayout(_ surface: FacetGallerySurface) throws {
        let store = try FacetSurfaceFixtures.store(surface)
        try record(
            try content(surface, store: store)
                .environment(\.locale, Locale(identifier: "en_US")),
            named: "facet-gallery-" + surface.rawValue + "-narrow",
            size: CGSize(width: 440, height: 600), appearance: .light)
    }

    @ViewBuilder
    private func content(_ surface: FacetGallerySurface, store: FacetStore) throws -> some View {
        switch surface.family {
        case .workspace:
            FacetWorkspaceView(
                store: store, importsFolder: .constant(false), board: .constant(surface == .board))
        case .account:
            FacetAccountForm(store: store)
        case .editor:
            let task = try #require(store.snapshot?.tasks.first)
            FacetTaskEditor(
                store: store, task: task, profileID: FacetSurfaceFixtures.profileID,
                statuses: store.statuses, priorities: store.priorities)
        case .views:
            FacetSavedViewsForm(
                store: store, profileID: FacetSurfaceFixtures.profileID, board: .constant(false))
        case .move:
            let task = try #require(store.snapshot?.tasks.first)
            FacetMoveTaskForm(
                store: store, task: task, profileID: FacetSurfaceFixtures.profileID, moved: {})
        case .bulk:
            let tasks = try #require(store.snapshot?.tasks)
            FacetBulkForm(
                store: store, profileID: FacetSurfaceFixtures.profileID,
                tasks: tasks, priorities: store.priorities, applied: {})
        case .conflicts:
            FacetConflictInbox(store: store)
        case .resolution:
            let conflict = try FacetSurfaceFixtures.conflict()
            FacetConflictForm(
                store: store, profileID: FacetSurfaceFixtures.profileID, conflict: conflict,
                initialText: surface == .keepBoth
                    ? nil
                    : "# Release checklist\n\nKeep both original versions until this edit is saved.",
                saved: {})
        case .capture:
            FacetCaptureForm(store: store).padding(24)
        case .preferences:
            FacetMacSettingsContent(store: store)
        }
    }
}
