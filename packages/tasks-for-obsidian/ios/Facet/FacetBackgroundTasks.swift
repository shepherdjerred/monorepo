import BackgroundTasks
import Foundation
import TaskNotesFacetUI
import TaskNotesKit
import UIKit
import WidgetKit

@MainActor
enum FacetBackgroundTasks {
    private static let identifier = "org.reactjs.native.example.TasksForObsidian.sync"
    private static var registered = false
    private static weak var store: FacetStore?

    static func install(store: FacetStore) {
        self.store = store
        guard !store.isIsolatedLaunch else { return }
        guard !registered else { return }
        registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier,
            using: .main
        ) { task in
            MainActor.assumeIsolated { run(task) }
        }
    }

    static func schedule() throws {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        let request = BGProcessingTaskRequest(identifier: identifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try BGTaskScheduler.shared.submit(request)
    }

    private static func run(_ task: BGTask) {
        guard let store, UIApplication.shared.applicationState != .active else {
            task.setTaskCompleted(success: false)
            return
        }
        let work = _Concurrency.Task { @MainActor in
            let completed = await store.runBackgroundSync()
            if !_Concurrency.Task.isCancelled {
                FacetWidgetPublisher.publish(store: store)
            }
            task.setTaskCompleted(success: completed)
        }
        task.expirationHandler = { work.cancel() }
    }
}

@MainActor
enum FacetWidgetPublisher {
    static func publish(store: FacetStore) {
        guard !store.isIsolatedLaunch else { return }
        guard let data = store.widgetEnvelope(),
            !_Concurrency.Task.isCancelled,
            let group = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.tasksforobsidian"
            )
        else { return }
        do {
            try FacetWidgetSnapshotStore(directory: group).write(data)
        } catch {
            store.reportNativeFailure(error)
            return
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "TodayTasksWidget")
    }
}
