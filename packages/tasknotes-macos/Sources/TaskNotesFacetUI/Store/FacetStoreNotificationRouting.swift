import Foundation
import TaskNotesKit

internal struct FacetNotificationRoute {
    let profileID: String
    let path: String
}

internal struct FacetReminderEditorSelection: Identifiable {
    let profileID: String
    let task: FacetTask
    let statuses: [(value: String, label: String)]
    let priorities: [(value: String, label: String)]
    var id: String { profileID + ":" + task.id }
}

extension FacetStore {
    public func installNotificationRouting() async {
        await reminders.installRouting { [weak self] profile, path in
            await self?.receiveNotification(profileID: profile, path: path)
        }
    }

    private func receiveNotification(profileID: String, path: String) {
        // Queue presentation until the user closes any current unsaved editor.
        notificationRoute = FacetNotificationRoute(profileID: profileID, path: path)
    }

    internal func openNotificationRoute() async {
        guard let route = notificationRoute, let engine, !isSaving, !isLoading else { return }
        guard profiles.contains(where: { $0.id == route.profileID }) else {
            error = "This reminder's vault is no longer in Facet."
            return
        }
        guard captureTitle.isEmpty else {
            error = "Finish or discard your open capture before opening this reminder."
            return
        }
        await selectProfile(route.profileID)
        let generation = requestGeneration
        isLoading = true
        defer { isLoading = false }
        do {
            let task = try await reminderTask(engine: engine, route: route, generation: generation)
            guard requestGeneration == generation, selectedProfileID == route.profileID else {
                return
            }
            reminderEditor = FacetReminderEditorSelection(
                profileID: route.profileID, task: task, statuses: statuses, priorities: priorities)
            notificationRoute = nil
        } catch { self.error = error.localizedDescription }
    }

    private func reminderTask(
        engine: FacetEngine, route: FacetNotificationRoute, generation: UInt64
    ) async throws -> FacetTask {
        let viewer = clock.viewerCalendar()
        var offset: UInt32 = 0
        var version: UInt64?
        while true {
            let page = try await engine.snapshot(
                profileID: route.profileID,
                query: .object([
                    "schemaVersion": .integer(1), "scope": .string("all"),
                    "includeArchived": .bool(true), "today": .string(viewer.today),
                    "at": .string(viewer.instant.ISO8601Format()),
                    "offset": .integer(Int64(offset)),
                    "limit": .integer(100),
                ]))
            guard generation == requestGeneration,
                version == nil || version == page.version
            else { throw FacetDraftError.changedNote }
            version = page.version
            if let task = page.tasks.first(where: { $0.path == route.path }) { return task }
            guard !page.tasks.isEmpty, UInt64(offset) + UInt64(page.tasks.count) < page.totalCount,
                let next = UInt32(exactly: UInt64(offset) + UInt64(page.tasks.count))
            else { throw FacetNotificationError.missingTask }
            offset = next
        }
    }
}

private enum FacetNotificationError: Error, LocalizedError {
    case missingTask
    var errorDescription: String? { "This reminder's task is no longer in the vault." }
}
