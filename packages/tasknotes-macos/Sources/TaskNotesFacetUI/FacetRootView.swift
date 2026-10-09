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
                    #if os(iOS)
                        .presentationDetents([.fraction(0.75), .large])
                        .presentationDragIndicator(.visible)
                    #endif
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
    @State private var draft: FacetCaptureDraft
    @State private var bodyText = ""
    @State private var due = ""
    @State private var scheduled = ""
    @State private var priority = ""
    @State private var projects: [String] = []
    @State private var contexts: [String] = []
    @State private var tags: [String] = []
    @State private var overrides: [String: FacetValue] = [:]
    @State private var recovery = false
    @State private var showsDiscard = false
    @State private var lifecycleRegistration = UUID()
    @State private var lifecycleError: String?
    @State private var discarding = false
    private let profileID: String?
    @FocusState private var focused: Bool
    public init(store: FacetStore) {
        self.store = store
        profileID = store.selectedProfileID
        let capture = FacetCaptureDraft()
        capture.input = store.captureTitle
        _draft = State(initialValue: capture)
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Task title", text: $draft.input, axis: .vertical).font(
                        .title2.weight(.semibold)
                    )
                    .focused($focused).onSubmit { capture() }
                    .accessibilityIdentifier("facet.capture.title")
                    TextEditor(text: $bodyText).frame(minHeight: 100).accessibilityLabel(
                        "Markdown notes")
                }
                Section("Plan") {
                    FacetOptionalDatePicker(
                        label: "Planned", value: scheduled.isEmpty ? nil : scheduled
                    ) {
                        scheduled = $0.text ?? ""
                        overrides["scheduled"] = $0
                    }
                    FacetOptionalDatePicker(label: "Deadline", value: due.isEmpty ? nil : due) {
                        due = $0.text ?? ""
                        overrides["due"] = $0
                    }
                    Picker("Priority", selection: $priority) {
                        Text("From capture text").tag("")
                        ForEach(store.priorities, id: \.value) { Text($0.label).tag($0.value) }
                    }.onChange(of: priority) {
                        overrides["priority"] = priority.isEmpty ? nil : .string(priority)
                    }
                }
                Section("Organize") {
                    tokens("Projects", key: "projects", values: $projects)
                    tokens("Contexts", key: "contexts", values: $contexts)
                    tokens("Tags", key: "tags", values: $tags)
                }
                if let error = draft.error ?? lifecycleError {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                        if let id = draft.admittedMutationID {
                            Text("Saved action: \(id)").font(.caption).textSelection(.enabled)
                            Button("Saved actions and recovery") { recovery = true }
                        }
                    }
                }
            }.disabled(
                draft.isSubmitting || discarding || FacetDraftCoordinator.shared.isTransitioning
            )
            .navigationTitle("Add task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges {
                            showsDiscard = true
                        } else {
                            store.showsCapture = false
                        }
                    }.disabled(draft.isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: capture).disabled(
                        !draft.canSubmit || profileID == nil
                    )
                    .accessibilityIdentifier("facet.capture.submit")
                }
            }
            .sheet(isPresented: $recovery) { FacetCaptureRecoveryView(store: store) }
        }.onAppear {
            focused = true
            if let profileID {
                FacetDraftCoordinator.shared.register(
                    lifecycleRegistration, owner: store, profileID: profileID,
                    isDirty: { hasChanges },
                    flush: {
                        guard !hasChanges, !draft.isSubmitting else {
                            lifecycleError =
                                "Add or discard this capture before switching vaults or closing the app."
                            return false
                        }
                        return true
                    })
            }
        }
        .onDisappear { FacetDraftCoordinator.shared.unregister(lifecycleRegistration) }
        .confirmationDialog(
            "Discard this capture draft?", isPresented: $showsDiscard, titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) {
                discarding = true
                _Concurrency.Task {
                    defer { discarding = false }
                    if await draft.discard(store: store), draft.input.isEmpty {
                        store.showsCapture = false
                    }
                }
            }
            Button("Keep editing", role: .cancel) {}
        }
        .interactiveDismissDisabled(
            draft.isSubmitting || !draft.input.isEmpty || draft.hasRetainedSubmission)
    }
    private var hasChanges: Bool {
        !draft.input.isEmpty || !bodyText.isEmpty || !overrides.isEmpty
            || draft.hasRetainedSubmission
    }

    private func capture() {
        guard let profileID,
            draft.begin(
                store: store, profileID: profileID, properties: overrides,
                body: bodyText.isEmpty ? nil : bodyText)
        else { return }
        _Concurrency.Task {
            if await draft.submit(store: store), draft.input.isEmpty { store.showsCapture = false }
        }
    }
    private func tokens(_ label: String, key: String, values: Binding<[String]>) -> some View {
        FacetNativeTokenField(
            label: label, values: values.wrappedValue,
            vocabulary: FacetWindowState.vocabulary(store.snapshot?.tasks ?? [])[key] ?? []
        ) { selected in
            values.wrappedValue = selected
            overrides[key] = .array(selected.map(FacetValue.string))
            return true
        }
    }
}

internal struct FacetCaptureRecoveryView: View {
    let store: FacetStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                ForEach(store.pendingActions) { action in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(action.id).font(.caption).textSelection(.enabled)
                        HStack {
                            Button("Resume") {
                                _Concurrency.Task { await store.resumeSavedAction(action) }
                            }
                            Button("Retire", role: .destructive) {
                                _Concurrency.Task { await store.retireSavedAction(action) }
                            }
                        }
                    }
                }
                if store.pendingActions.isEmpty {
                    Text("No saved actions remain. Return to the retained draft to continue.")
                }
            }.navigationTitle("Saved actions")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
    }
}
