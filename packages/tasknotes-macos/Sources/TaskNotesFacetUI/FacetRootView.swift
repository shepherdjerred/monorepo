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
        NavigationStack {
            VStack(spacing: 0) {
                ForEach(store.pendingImports) { imported in
                    Button("Retry independent copy of \(imported.name)") {
                        _Concurrency.Task { await store.retryImport(imported) }
                    }.disabled(store.isLoading).padding(.horizontal)
                }
                if store.profiles.isEmpty {
                    onboarding
                } else {
                    filters
                    ForEach(store.pendingActions) { action in
                        let owner = store.profiles.first(where: { $0.id == action.profileID })
                        Button("Resume saved action in \(owner?.name ?? action.profileID)") {
                            _Concurrency.Task { await store.resumeSavedAction(action) }
                        }
                        .disabled(store.isSaving)
                        .padding(.horizontal)
                    }
                    if let profileID = store.selectedProfileID,
                        let state = store.syncStates[profileID]
                    {
                        Text(state).font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                    }
                    if let route = store.notificationRoute {
                        let owner =
                            store.profiles.first { $0.id == route.profileID }?.name
                            ?? route.profileID
                        Button("Open reminder task in \(owner)") {
                            _Concurrency.Task { await store.openNotificationRoute() }
                        }.disabled(store.isSaving || store.isLoading)
                    }
                    if let reminderStatus = store.reminderStatus {
                        Text(reminderStatus).font(.caption).foregroundStyle(.secondary).padding(
                            .horizontal)
                    }
                    if store.needsStandardConsent {
                        VStack(spacing: 12) {
                            Text(
                                "This vault has no TaskNotes settings. "
                                    + "Use the standard TaskNotes configuration to begin creating tasks?"
                            )
                            Button("Use standard configuration") {
                                _Concurrency.Task { await store.approveStandardConfiguration() }
                            }
                        }.padding()
                    }
                    if let snapshot = store.snapshot {
                        if snapshot.conflictCount > 0 {
                            Button("\(snapshot.conflictCount) conflicts need your attention") {
                                _Concurrency.Task { await store.loadConflicts() }
                            }
                            .accessibilityIdentifier("facet.conflicts.open")
                            .padding()
                        }
                        FacetTaskBrowser(store: store, snapshot: snapshot, board: $board)
                    } else {
                        ProgressView("Opening vault…").frame(maxHeight: .infinity)
                    }
                }
            }
            .navigationTitle("Facet")
            .searchable(text: $store.search, prompt: "Search tasks")
            .toolbar {
                ToolbarItemGroup {
                    Menu {
                        ForEach(store.profiles) { profile in
                            Button(profile.name) {
                                _Concurrency.Task { await store.selectProfile(profile.id) }
                            }
                        }
                        Divider()
                        Button(folderAction) { importsFolder = true }
                        Button("Connect Obsidian Sync…") { store.showsAccount = true }
                        if store.remindersEnabled {
                            Button("Turn off task reminders") {
                                _Concurrency.Task { await store.disableReminders() }
                            }
                        } else {
                            Button("Enable task reminders…") {
                                _Concurrency.Task { await store.enableReminders() }
                            }
                        }
                        Button("Sign out of Obsidian") {
                            _Concurrency.Task { await store.signOut() }
                        }
                    } label: {
                        Label("Vaults", systemImage: "folder")
                    }
                    Button {
                        board.toggle()
                    } label: {
                        Label(
                            board ? "List" : "Board",
                            systemImage: board ? "list.bullet" : "rectangle.split.3x1")
                    }
                    .disabled(store.selectedProfileID == nil)
                    Button {
                        store.showsCapture = true
                    } label: {
                        Label("Add task", systemImage: "plus")
                    }
                    .disabled(store.selectedProfileID == nil)
                    .accessibilityIdentifier("facet.capture.open")
                    Button {
                        _Concurrency.Task { await store.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.selectedProfileID == nil)
                }
            }
        }
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
    private var folderAction: String {
        #if os(iOS)
            "Import vault copy…"
        #else
            "Open vault folder…"
        #endif
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

    private var onboarding: some View {
        FacetVaultOnboarding(
            store: store, importsFolder: $importsFolder, folderAction: folderAction)
    }

    private var filters: some View {
        FacetFilters(store: store)
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
