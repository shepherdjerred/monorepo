import Foundation
import SwiftUI
import TaskNotesFacetUI
import TaskNotesKit
import WidgetKit

@main
struct FacetApp: App {
    @State private var store: FacetStore
    @State private var intentFailure: String?
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let model = FacetStore()
        _store = State(initialValue: model)
        FacetBackgroundTasks.install(store: model)
    }

    var body: some Scene {
        WindowGroup {
            FacetRootView(store: store)
                .task(id: store.dataRevision) {
                    await publishWidget()
                }
                .onOpenURL { url in
                    if url.host == "queued-capture" {
                        _Concurrency.Task { await processIntents() }
                    }
                }
                .onChange(of: scenePhase) {
                    if scenePhase == .active {
                        _Concurrency.Task { await processIntents() }
                    } else if scenePhase == .background,
                        !store.isIsolatedLaunch,
                        store.hasConfiguredToken
                    {
                        do {
                            try FacetBackgroundTasks.schedule()
                        } catch {
                            intentFailure = "Background sync could not be scheduled."
                        }
                    }
                }
                .alert(
                    "Facet Notice",
                    isPresented: Binding(
                        get: { intentFailure != nil },
                        set: { if !$0 { intentFailure = nil } }
                    )
                ) {
                    Button("OK") { intentFailure = nil }
                } message: {
                    Text(intentFailure ?? "")
                }
        }
    }

    private func intentQueue() throws -> FacetIntentQueue? {
        guard !store.isIsolatedLaunch else { return nil }
        guard
            let group = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.tasksforobsidian"
            )
        else {
            return nil
        }
        return try FacetIntentQueue(
            directory: group.appendingPathComponent("FacetIntentActions", isDirectory: true)
        )
    }

    private func processIntents() async {
        await store.start()
        do {
            if let queue = try intentQueue() {
                await store.processIntentCaptures(queue)
            }
            FacetWidgetPublisher.publish(store: store)
        } catch {
            intentFailure = error.localizedDescription
        }
    }

    private func publishWidget() async {
        await store.start()
        do {
            if let queue = try intentQueue() {
                await store.processIntentCaptures(queue)
            }
        } catch {
            intentFailure = error.localizedDescription
        }
        FacetWidgetPublisher.publish(store: store)
    }
}
