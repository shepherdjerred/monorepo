public import SwiftUI
public import TaskNotesKit

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
    private let initialContext: [String: FacetValue]
    private let pinnedProfileID: String?
    @FocusState private var focused: Bool
    @Environment(\.facetFeedbackOrigin) private var feedbackOrigin
    private struct PreviewIdentity: Hashable {
        let input: String
        let revision: Int
        let profileID: String?
    }
    public init(
        store: FacetStore, draft: FacetCaptureDraft? = nil, preview: FacetCapturePreview? = nil,
        profileID: String? = nil, context: [String: FacetValue] = [:],
        detailsExpanded: Bool = false, notes: String? = nil,
        properties: [String: FacetValue] = [:],
        focusRequest: Int = 0, retainedPanel: Bool = false,
        close: (@MainActor () -> Void)? = nil,
        expandedChanged: (@MainActor (Bool) -> Void)? = nil
    ) {
        self.store = store
        _profileID = State(initialValue: profileID ?? store.selectedProfileID)
        pinnedProfileID = profileID
        initialContext = context
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
            if !hasChanges, pinnedProfileID == nil { profileID = store.selectedProfileID }
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
                store: store, profileID: profileID, input: draft.input, overrides: overrides,
                context: initialContext)
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
}

extension FacetCaptureForm {
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
                body: bodyOverride, origin: feedbackOrigin, context: initialContext)
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
