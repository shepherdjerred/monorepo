public import SwiftUI
import TaskNotesKit
import UniformTypeIdentifiers

private struct ReminderProjectionIdentity: Hashable {
    let profiles: [String]
    let version: UInt64?
}

public struct FacetRootView: View {
    @State private var store: FacetStore
    @State private var importsFolder = false
    @State private var importSource: URL?
    @State private var board = false
    @Environment(\.scenePhase) private var scenePhase
    private let afterStart: (@MainActor () async -> Void)?

    public init(store: FacetStore = FacetStore(), afterStart: (@MainActor () async -> Void)? = nil)
    {
        self.store = store
        self.afterStart = afterStart
    }

    public var body: some View {
        FacetWorkspaceView(store: store, importsFolder: $importsFolder, board: $board)
            .task {
                await store.installNotificationRouting()
                await store.start()
                await afterStart?()
            }
            .task(
                id: ReminderProjectionIdentity(
                    profiles: store.profiles.map(\.id), version: store.snapshot?.version)
            ) {
                await store.refreshReminders()
            }
            .onChange(of: store.search) { _Concurrency.Task { await store.reloadQuery() } }
            .onChange(of: store.status) { _Concurrency.Task { await store.reloadQuery() } }
            .onChange(of: store.priority) { _Concurrency.Task { await store.reloadQuery() } }
            .onChange(of: store.showCompleted) { _Concurrency.Task { await store.reloadQuery() } }
            .onChange(of: store.scope) { _Concurrency.Task { await store.reloadQuery() } }
            .onChange(of: store.includeArchived) { _Concurrency.Task { await store.reloadQuery() } }
            .onChange(of: scenePhase) {
                _Concurrency.Task {
                    if scenePhase == .background {
                        await store.pauseSync()
                    } else if scenePhase == .active {
                        await store.resumeSync()
                    }
                }
            }
            .onOpenURL { store.handleURL($0) }
            .sheet(item: $store.reminderEditor) { selection in
                FacetTaskEditor(
                    store: store, task: selection.task, profileID: selection.profileID,
                    statuses: selection.statuses, priorities: selection.priorities)
            }
            .fileImporter(isPresented: $importsFolder, allowedContentTypes: [.folder]) { result in
                switch result {
                case .success(let url):
                    #if os(iOS)
                        importSource = url
                    #else
                        _Concurrency.Task { await store.openLocal(url) }
                    #endif
                case .failure(let error): store.reportNativeFailure(error)
                }
            }
            .confirmationDialog("Import an independent vault copy?", isPresented: importPresented) {
                Button("Import copy") {
                    guard let source = importSource else { return }
                    importSource = nil
                    _Concurrency.Task { await store.importCopy(source) }
                }
                Button("Cancel", role: .cancel) { importSource = nil }
            } message: {
                Text(
                    "Facet copies the vault and attachments into this app. "
                        + "The original stays unchanged. Later edits do not sync with the source folder."
                )
            }
            .sheet(isPresented: $store.showsCapture) {
                FacetCaptureForm(store: store).padding().frame(minWidth: 300, minHeight: 180)
            }
            .sheet(isPresented: $store.showsConflicts) { FacetConflictInbox(store: store) }
            .sheet(isPresented: $store.showsAccount) { FacetAccountForm(store: store) }
            .alert(
                store.savedNotice == nil ? "Could not complete this action" : "Saved",
                isPresented: errorPresented
            ) {
                Button("OK") {
                    if store.savedNotice != nil {
                        store.clearSavedNotice()
                    } else {
                        store.clearError()
                        importFailure = nil
                    }
                }
            } message: {
                Text(store.savedNotice ?? store.error ?? importFailure ?? "")
            }
    }

    @State private var importFailure: String?
    private var importPresented: Binding<Bool> {
        Binding(get: { importSource != nil }, set: { if !$0 { importSource = nil } })
    }
    private var errorPresented: Binding<Bool> {
        Binding(
            get: { store.savedNotice != nil || store.error != nil || importFailure != nil },
            set: {
                if !$0 {
                    if store.savedNotice != nil {
                        store.clearSavedNotice()
                    } else {
                        store.clearError()
                        importFailure = nil
                    }
                }
            })
    }
}

public struct FacetCaptureForm: View {
    @Bindable private var store: FacetStore
    @FocusState private var focused: Bool
    public init(store: FacetStore) { self.store = store }

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Add task").font(.title2.bold())
            TextField("Task title", text: $store.captureTitle).textFieldStyle(.roundedBorder)
                .disabled(store.isSaving)
                .focused($focused).onSubmit { _Concurrency.Task { await store.createTask() } }
                .accessibilityIdentifier("facet.capture.title")
            HStack {
                Button("Cancel") { store.showsCapture = false }.disabled(store.isSaving)
                Spacer()
                Button("Add") { _Concurrency.Task { await store.createTask() } }
                    .buttonStyle(.borderedProminent).disabled(
                        store.captureTitle.isEmpty || store.isSaving
                    )
                    .accessibilityIdentifier("facet.capture.submit")
            }
        }.onAppear { focused = true }
            .interactiveDismissDisabled(store.isSaving || !store.captureTitle.isEmpty)
            .task(id: store.captureTitle) {
                do {
                    try await _Concurrency.Task.sleep(for: .milliseconds(200))
                    await store.previewCapture()
                } catch is CancellationError {} catch {
                    assertionFailure("Capture preview task failed.")
                }
            }
    }
}
