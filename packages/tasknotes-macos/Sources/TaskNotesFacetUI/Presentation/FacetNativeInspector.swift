import SwiftUI
import TaskNotesKit

internal struct FacetNativeInspector: View {
    let store: FacetStore
    let window: FacetWindowState
    @Bindable var draft: FacetInspectorDraft
    let configuration: FacetValue
    @FocusState private var focus: Field?
    @State private var advanced = false
    @State private var editingMarkdown = false
    @State private var completing = false
    @State private var fieldAdmissions = 0
    @State private var fields = FacetActionCoordinator()
    @Environment(\.facetFeedbackOrigin) private var feedbackOrigin
    private enum Field { case title, markdown }

    var body: some View {
        Form {
            Section {
                Button(
                    draft.task.completed ? "Completed" : "Complete task",
                    systemImage: draft.task.completed ? "checkmark.circle.fill" : "circle"
                ) {
                    guard !completing, !draft.isDirty else { return }
                    completing = true
                    let intent = store.feedbackIntent(origin: feedbackOrigin)
                    _Concurrency.Task {
                        _ = await FacetFeedbackContext.$intent.withValue(intent) {
                            await draft.setCompletion(store: store, window: window)
                        }
                        completing = false
                    }
                }.buttonStyle(.plain).disabled(draft.isDirty || completing)
                TextField("Task title", text: $draft.title, axis: .vertical)
                    .labelsHidden().font(.title2.weight(.semibold)).focused($focus, equals: .title)
                    .onSubmit { commitTitle() }.accessibilityIdentifier("facet.inspector.title")
            }
            Section("Status") {
                choices("Status", key: "statuses", selection: draft.task.status) { value in
                    admit { _ = await draft.setStatus(value, store: store, window: window) }
                }
                choices("Priority", key: "priorities", selection: draft.task.priority) {
                    property("priority", .string($0))
                }
            }
            Section("Dates") {
                FacetOptionalDatePicker(label: "Due", value: draft.task.properties["due"]?.text) {
                    property("due", $0)
                }
                FacetOptionalDatePicker(
                    label: "Scheduled", value: draft.task.properties["scheduled"]?.text
                ) { property("scheduled", $0) }
                FacetInspectorRecurrence(task: draft.task) { properties in
                    await draft.setProperties(properties, store: store, window: window)
                }
            }
            Section("Organize") {
                tokenField("Projects", key: "projects")
                tokenField("Contexts", key: "contexts")
                tokenField("Tags", key: "tags")
            }
            Section("Markdown") {
                if editingMarkdown {
                    TextEditor(text: $draft.markdown).frame(minHeight: 140).focused(
                        $focus, equals: .markdown)
                    HStack {
                        Spacer()
                        Button("Done") {
                            admit {
                                if await draft.commitMarkdown(store: store, window: window) {
                                    editingMarkdown = false
                                    focus = nil
                                }
                            }
                        }.disabled(draft.isSaving)
                    }
                } else {
                    switch Result(catching: { try MarkdownBody.of(source: draft.markdown) }) {
                    case .success(let content): FacetMarkdownBodyView(content)
                    case .failure(let error):
                        Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
                    }
                    Button("Edit Markdown…") {
                        editingMarkdown = true
                        focus = .markdown
                    }
                }
            }
            Section {
                Button("Reminders and relationships…") {
                    _Concurrency.Task {
                        if await draft.flush(store: store, window: window) { advanced = true }
                    }
                }
                Text(draft.task.path).font(.caption).foregroundStyle(.secondary).textSelection(
                    .enabled)
            }
            if let error = draft.error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    if let id = draft.admittedMutationID {
                        Text("Saved action: \(id)").font(.caption).textSelection(.enabled)
                        Text(
                            "Retry checks this original action. "
                                + "Its request cannot be changed while the outcome is uncertain."
                        ).font(.caption).foregroundStyle(.secondary)
                    }
                    Button("Retry saved change") {
                        admit { _ = await draft.retry(store: store, window: window) }
                    }
                    Button("Revert unsubmitted text") { draft.revert() }
                }
            }
        }
        .formStyle(.grouped).foregroundStyle(.primary).disabled(
            draft.isSaving || fieldAdmissions > 0
        )
        .overlay(alignment: .topTrailing) { if draft.isSaving { ProgressView().padding() } }
        .onChange(of: focus) { previous, _ in
            if previous == .title { commitTitle() }
            if previous == .markdown {
                admit { _ = await draft.commitMarkdown(store: store, window: window) }
            }
        }
        .sheet(isPresented: $advanced) {
            FacetTaskEditor(
                store: store, task: draft.task, profileID: draft.profileID,
                statuses: pairs("statuses"), priorities: pairs("priorities"))
        }
    }

    private func commitTitle() {
        admit { _ = await draft.commitTitle(store: store, window: window) }
    }
    private func property(_ key: String, _ value: FacetValue) {
        admit {
            _ = await draft.setProperty(key, value: value, store: store, window: window)
        }
    }

    private func admit(_ operation: @escaping @MainActor () async -> Void) {
        fieldAdmissions += 1
        let intent = store.feedbackIntent(origin: feedbackOrigin)
        _Concurrency.Task {
            _ = await fields.submit {
                await FacetFeedbackContext.$intent.withValue(intent) { await operation() }
                return true
            }
            fieldAdmissions -= 1
        }
    }
    private func pairs(_ key: String) -> [(value: String, label: String)] {
        do {
            return try FacetConfiguredChoice.choices(in: configuration, key: key).map {
                ($0.value, $0.label)
            }
        } catch { preconditionFailure("Invalid validated workflow configuration: \(error)") }
    }
    @ViewBuilder private func choices(
        _ label: String, key: String, selection: String,
        changed: @escaping @MainActor @Sendable (String) -> Void
    ) -> some View {
        switch Result(catching: {
            try FacetConfiguredChoice.choices(in: configuration, key: key, including: [selection])
        })
        {
        case .success(let values):
            Picker(label, selection: Binding(get: { selection }, set: changed)) {
                ForEach(values) { value in Text(value.label).tag(value.value) }
            }
            if let diagnostic = values.first(where: { $0.value == selection })?.colorDiagnostic {
                Label(diagnostic, systemImage: "exclamationmark.triangle").font(.caption)
                    .foregroundStyle(.orange)
            }
            if let diagnostic = values.first(where: { $0.value == selection })?
                .configurationDiagnostic
            {
                Label(diagnostic, systemImage: "exclamationmark.triangle").font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .failure(let error):
            Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
        }
    }
    private func tokenField(_ label: String, key: String) -> some View {
        FacetNativeTokenField(
            label: label, values: FacetTaskPresentation.tokens(draft.task.properties[key]),
            vocabulary: window.vocabulary[key] ?? []
        ) { values in
            await draft.setProperty(
                key, value: .array(values.map(FacetValue.string)), store: store, window: window)
        }
    }
}
