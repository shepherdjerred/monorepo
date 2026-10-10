public import SwiftUI
public import TaskNotesKit
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
            .modifier(FacetFeedbackScene(store: store))
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
    @State private var bodyOverride: String?
    @State private var overrides: [String: FacetValue] = [:]
    @State private var recovery = false
    @State private var showsDiscard = false
    @State private var lifecycleRegistration = UUID()
    @State private var lifecycleError: String?
    @State private var discarding = false
    @State private var detailsExpanded = false
    @State private var preview = FacetCapturePreview()
    @State private var previewRevision = 0
    @State private var profileID: String?
    private let focusRequest: Int
    private let retainedPanel: Bool
    private let close: (@MainActor () -> Void)?
    private let expandedChanged: (@MainActor (Bool) -> Void)?
    @FocusState private var focused: Bool
    @Environment(\.facetFeedbackOrigin) private var feedbackOrigin
    private struct PreviewIdentity: Hashable {
        let input: String
        let revision: Int
        let profileID: String?
    }
    public init(
        store: FacetStore, draft: FacetCaptureDraft? = nil, preview: FacetCapturePreview? = nil,
        detailsExpanded: Bool = false, notes: String? = nil,
        properties: [String: FacetValue] = [:],
        focusRequest: Int = 0, retainedPanel: Bool = false,
        close: (@MainActor () -> Void)? = nil,
        expandedChanged: (@MainActor (Bool) -> Void)? = nil
    ) {
        self.store = store
        _profileID = State(initialValue: store.selectedProfileID)
        self.focusRequest = focusRequest
        self.retainedPanel = retainedPanel
        self.close = close
        self.expandedChanged = expandedChanged
        let capture = draft ?? FacetCaptureDraft()
        if draft == nil { capture.input = store.captureTitle }
        _draft = State(initialValue: capture)
        _preview = State(initialValue: preview ?? FacetCapturePreview())
        _detailsExpanded = State(initialValue: detailsExpanded)
        _bodyOverride = State(initialValue: notes)
        _overrides = State(initialValue: properties)
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Task title", text: $draft.input, axis: .vertical).font(
                        .title2.weight(.semibold)
                    )
                    .focused($focused).onSubmit { capture(another: false) }
                    .labelsHidden().accessibilityLabel("Task title")
                    .accessibilityIdentifier(
                        retainedPanel
                            ? AccessibilityIdentifier.QuickAdd.field : "facet.capture.title")
                    FacetCapturePreviewChips(
                        preview: preview, priorities: store.priorities,
                        changed: changeOverride)
                    if preview.needsTitle(draft.input) {
                        Label("Add a task title", systemImage: "text.cursor")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text("Try “Pay rent tomorrow p:Home”. Recognised details appear above.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    DisclosureGroup("Details", isExpanded: $detailsExpanded) {
                        TextEditor(
                            text: Binding(
                                get: { bodyOverride ?? preview.body }, set: { bodyOverride = $0 })
                        ).frame(minHeight: 100).accessibilityLabel(
                            "Markdown notes")
                        Text("Plan").font(.headline)
                        FacetOptionalDatePicker(
                            label: "Planned", value: preview.properties["scheduled"]?.text
                        ) {
                            changeOverride("scheduled", $0)
                        }
                        FacetOptionalDatePicker(
                            label: "Deadline", value: preview.properties["due"]?.text
                        ) {
                            changeOverride("due", $0)
                        }
                        Picker(
                            "Priority",
                            selection: Binding(
                                get: { preview.properties["priority"]?.text ?? "" },
                                set: {
                                    changeOverride("priority", $0.isEmpty ? .null : .string($0))
                                })
                        ) {
                            Text("None").tag("")
                            ForEach(store.priorities, id: \.value) { Text($0.label).tag($0.value) }
                        }
                        Text("Organize").font(.headline)
                        tokens("Projects", key: "projects")
                        tokens("Contexts", key: "contexts")
                        tokens("Tags", key: "tags")
                    }
                }
                if !retainedPanel {
                    Section {
                        Button("Add and create another", systemImage: "plus.circle") {
                            capture(another: true)
                        }.disabled(!canCapture)
                    }
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
            }.formStyle(.grouped).disabled(
                draft.isSubmitting || discarding || FacetDraftCoordinator.shared.isTransitioning
            )
            .navigationTitle("Add task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges {
                            showsDiscard = true
                        } else {
                            dismissCapture()
                        }
                    }.disabled(draft.isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { capture(another: false) }.disabled(
                        !canCapture
                    )
                    .accessibilityIdentifier("facet.capture.submit")
                }
            }
            .sheet(isPresented: $recovery) { FacetCaptureRecoveryView(store: store) }
            .safeAreaInset(edge: .bottom) {
                if retainedPanel {
                    HStack {
                        Button("Cancel") {
                            if hasChanges { showsDiscard = true } else { dismissCapture() }
                        }.disabled(draft.isSubmitting)
                        Spacer()
                        Button("Add Another") { capture(another: true) }.disabled(!canCapture)
                        Button("Add") { capture(another: false) }.disabled(!canCapture)
                            .keyboardShortcut(.defaultAction)
                    }.padding().background(.regularMaterial)
                }
            }
        }.task(id: focusRequest) {
            if !hasChanges { profileID = store.selectedProfileID }
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
        .onDisappear {
            if !retainedPanel { FacetDraftCoordinator.shared.unregister(lifecycleRegistration) }
        }
        .onChange(of: detailsExpanded) { expandedChanged?(detailsExpanded) }
        .onChange(of: overrides) { previewRevision += 1 }
        .task(
            id: PreviewIdentity(
                input: draft.input, revision: previewRevision, profileID: store.selectedProfileID)
        ) {
            await preview.refresh(
                store: store, profileID: profileID, input: draft.input, overrides: overrides)
        }
        .confirmationDialog(
            "Discard this capture draft?", isPresented: $showsDiscard, titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) {
                discarding = true
                _Concurrency.Task {
                    defer { discarding = false }
                    if await draft.discard(store: store), draft.input.isEmpty {
                        clearSupplementalDraft()
                        dismissCapture()
                    }
                }
            }
            Button("Keep editing", role: .cancel) {}
        }
        .interactiveDismissDisabled(draft.isSubmitting || discarding || hasChanges)
    }
    private var hasChanges: Bool {
        bodyOverride != nil || draft.hasChanges(body: "", properties: overrides)
    }
    private var canCapture: Bool {
        draft.canSubmit && profileID != nil && preview.canSubmit(draft.input)
    }

    private func capture(another: Bool) {
        guard canCapture, let profileID,
            draft.begin(
                store: store, profileID: profileID, properties: overrides,
                body: bodyOverride, origin: feedbackOrigin)
        else { return }
        let capturedSeed = store.captureTitle
        _Concurrency.Task {
            if await draft.submit(store: store), draft.input.isEmpty {
                if store.captureTitle == capturedSeed { store.captureTitle = "" }
                if another {
                    clearSupplementalDraft()
                    focused = true
                } else {
                    dismissCapture()
                }
            }
        }
    }
    private func changeOverride(_ role: String, _ value: FacetValue) {
        overrides[role] = value
        preview.override(role, value: value)
    }
    private func dismissCapture() {
        if let close { close() } else { store.showsCapture = false }
    }
    private func clearSupplementalDraft() {
        bodyOverride = nil
        overrides = [:]
        detailsExpanded = false
    }
    private func tokens(_ label: String, key: String) -> some View {
        FacetNativeTokenField(
            label: label, values: FacetTaskPresentation.tokens(preview.properties[key]),
            vocabulary: FacetWindowState.vocabulary(store.snapshot?.tasks ?? [])[key] ?? []
        ) { selected in
            changeOverride(key, .array(selected.map(FacetValue.string)))
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
