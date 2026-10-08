import Foundation
import SwiftUI
import TaskNotesFacetUI
import TaskNotesKit
import WidgetKit

@main
struct FacetApp: App {
    @State private var store = FacetStore()
    @Environment(\.scenePhase) private var scenePhase
    init() {
        let model = FacetStore()
        _store = State(initialValue: model)
        FacetBackgroundTasks.install(store: model)
    }
    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                    FacetRootView(
                        store: store,
                        afterStart: {
                            if CommandLine.arguments.contains("--facet-native-acceptance") {
                                do {
                                    let directory = try await _Concurrency.Task.detached {
                                        let directory = try FileManager.default.url(
                                            for: .documentDirectory, in: .userDomainMask,
                                            appropriateFor: nil, create: true
                                        ).appendingPathComponent("Native acceptance")
                                        try FileManager.default.createDirectory(
                                            at: directory, withIntermediateDirectories: true)
                                        return directory
                                    }.value
                                    await store.prepareAcceptanceVault(directory)
                                } catch { assertionFailure("Native acceptance bootstrap failed.") }
                            }
                        }
                    )
                    .modifier(AcceptanceTextSize())
                    .task(
                        id: WidgetProjectionIdentity(
                            profileID: store.selectedProfileID, version: store.snapshot?.version)
                    ) { await publishWidget() }
                #else
                    FacetRootView(store: store)
                        .task(
                            id: WidgetProjectionIdentity(
                                profileID: store.selectedProfileID, version: store.snapshot?.version
                            )
                        ) { await publishWidget() }
                #endif
            }
            .onOpenURL { url in
                if url.host == "queued-capture" { _Concurrency.Task { await processIntents() } }
            }
            .onChange(of: scenePhase) {
                if scenePhase == .active { _Concurrency.Task { await processIntents() } }
                if scenePhase == .background,
                    store.profiles.contains(where: { $0.kind == "obsidian_sync" })
                {
                    do { try FacetBackgroundTasks.schedule() } catch {
                        intentFailure =
                            "Background Sync could not be scheduled. Open Facet to sync this vault."
                    }
                }
            }
            .alert(
                "Facet could not continue",
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

    private func publishWidget() async {
        do {
            let queue = try intentQueue()
            try queue.selectProfile(store.selectedProfileID)
            await store.processIntentCaptures(queue)
        } catch { intentFailure = FacetFailureDiagnostic(error).action }
        await FacetWidgetPublisher.publish(store: store)
    }

    @State private var intentFailure: String?

    private func intentQueue() throws -> FacetIntentQueue {
        guard
            let group = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.tasksforobsidian")
        else { throw FacetIntentError.unavailableGroup }
        return try FacetIntentQueue(directory: group.appendingPathComponent("FacetIntentActions"))
    }

    private func processIntents() async {
        do {
            await store.processIntentCaptures(try intentQueue())
            await FacetWidgetPublisher.publish(store: store)
        } catch { intentFailure = FacetFailureDiagnostic(error).action }
    }
}

private struct WidgetProjectionIdentity: Hashable {
    let profileID: String?
    let version: UInt64?
}

#if DEBUG
    private struct AcceptanceTextSize: ViewModifier {
        func body(content: Content) -> some View {
            if CommandLine.arguments.contains("--facet-accessibility-size") {
                content.dynamicTypeSize(.accessibility3)
            } else {
                content
            }
        }
    }
#endif
