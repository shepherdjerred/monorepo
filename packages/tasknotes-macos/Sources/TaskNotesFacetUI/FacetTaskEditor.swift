import Foundation
import SwiftUI
import TaskNotesKit

struct FacetTaskEditor: View {
    let store: FacetStore
    let task: FacetTask
    private let profileID: String
    private let owningEngine: FacetEngine?
    private let statuses: [(value: String, label: String)]
    private let priorities: [(value: String, label: String)]
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var status: String
    @State private var priority: String
    @State private var due: String
    @State private var scheduled: String
    @State private var bodyText: String
    @State private var projects: String
    @State private var contexts: String
    @State private var extras: FacetTaskExtras
    @State private var showsDelete = false
    @State private var isSaving = false
    @State private var showsDiscard = false
    @State private var mutationID = UUID().uuidString
    @State private var archiveMutationID = UUID().uuidString
    @State private var deleteMutationID = UUID().uuidString
    @State private var submitted: (id: String, command: [String: FacetValue])?
    @State private var admittedMutationID: String?
    @State private var failure: String?
    @State private var lifecycleRegistration = UUID()
    @State private var showsRecovery = false

    init(
        store: FacetStore, task: FacetTask, profileID: String,
        statuses: [(value: String, label: String)], priorities: [(value: String, label: String)]
    ) {
        self.store = store
        self.task = task
        self.profileID = profileID
        owningEngine = store.engine
        self.statuses =
            statuses.contains(where: { $0.value == task.status })
            ? statuses : statuses + [(task.status, task.status + " (existing value)")]
        self.priorities =
            priorities.contains(where: { $0.value == task.priority })
            ? priorities : priorities + [(task.priority, task.priority + " (existing value)")]
        _title = State(initialValue: task.title)
        _status = State(initialValue: task.status)
        _priority = State(initialValue: task.priority)
        _due = State(initialValue: task.properties["due"]?.text ?? "")
        _scheduled = State(initialValue: task.properties["scheduled"]?.text ?? "")
        _bodyText = State(initialValue: task.body)
        _projects = State(initialValue: Self.tokens(task.properties["projects"]))
        _contexts = State(initialValue: Self.tokens(task.properties["contexts"]))
        _extras = State(initialValue: FacetTaskExtras(properties: task.properties))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Task title", text: $title, axis: .vertical)
                        .font(.title2.weight(.semibold)).accessibilityIdentifier(
                            "facet.editor.title")
                    TextEditor(text: $bodyText).frame(minHeight: 100)
                        .accessibilityLabel("Markdown notes")
                }
                Section {
                    Button(
                        task.completed ? "Completed" : "Complete task",
                        systemImage: task.completed ? "checkmark.circle.fill" : "circle"
                    ) {
                        complete()
                    }.disabled(hasChanges || submitted != nil)
                    Picker("Status", selection: $status) {
                        ForEach(statuses, id: \.value) { Text($0.label).tag($0.value) }
                    }
                }
                Section("Plan") {
                    FacetOptionalDatePicker(
                        label: "Planned", value: scheduled.isEmpty ? nil : scheduled
                    ) { scheduled = $0.text ?? "" }
                    FacetOptionalDatePicker(label: "Deadline", value: due.isEmpty ? nil : due) {
                        due = $0.text ?? ""
                    }
                    Picker("Priority", selection: $priority) {
                        ForEach(priorities, id: \.value) { Text($0.label).tag($0.value) }
                    }
                }
                Section("Repeat") {
                    FacetRecurrenceField(
                        rule: $extras.recurrence, scheduled: $scheduled,
                        anchor: $extras.recurrenceAnchor, dateCreated: extras.dateCreated)
                }
                Section("Organize") {
                    tokens("Projects", key: "projects", value: $projects)
                    tokens("Contexts", key: "contexts", value: $contexts)
                    tokens("Tags", key: "tags", value: $extras.tags)
                }
                FacetRelationshipsSection(
                    dependencies: $extras.dependencies, reminders: $extras.reminders)
                Section("Additional note fields") {
                    DisclosureGroup("Attachments, skipped dates and creation date") {
                        TextField(
                            "Attachment vault paths, one per line", text: $extras.attachments,
                            axis: .vertical)
                        TextField(
                            "Skipped occurrence dates, one per line", text: $extras.skipped,
                            axis: .vertical)
                        TextField("Created date-time", text: $extras.dateCreated)
                    }
                }
                Section {
                    Text(task.path).font(.caption).foregroundStyle(.secondary).textSelection(
                        .enabled)
                    Button("Archive task", action: archive).disabled(hasChanges || submitted != nil)
                    NavigationLink("Move task note…") {
                        FacetMoveTaskForm(
                            store: store, task: task, profileID: profileID, moved: { dismiss() })
                    }.disabled(hasChanges)
                    Button("Delete task", role: .destructive) { showsDelete = true }.disabled(
                        submitted != nil)
                }
                if let failure {
                    Section {
                        Label(failure, systemImage: "exclamationmark.triangle")
                        if let admittedMutationID {
                            Text("Saved action: \(admittedMutationID)").font(.caption)
                                .textSelection(.enabled)
                            Text(
                                "Retry uses the original request. "
                                    + "Resolve this saved action before submitting newer edits."
                            ).font(.caption).foregroundStyle(.secondary)
                            Button("Recovery options…") { showsRecovery = true }
                        }
                        Button("Retry saved action", action: save)
                    }
                }
            }
            .disabled(isSaving || FacetDraftCoordinator.shared.isTransitioning)
            .navigationTitle("Task details")
            .toolbar {
                ToolbarItemGroup {
                    Button("Cancel") {
                        if hasChanges || submitted != nil { showsDiscard = true } else { dismiss() }
                    }
                    .disabled(isSaving)
                    Button(submitted == nil ? "Save" : "Retry", action: save).disabled(
                        isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                    .accessibilityIdentifier("facet.editor.save")
                }
            }
            .confirmationDialog(
                "Delete this task note?", isPresented: $showsDelete, titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    delete()
                }
            }
        }
        .interactiveDismissDisabled(hasChanges || isSaving || submitted != nil)
        .sheet(isPresented: $showsRecovery) {
            if let admittedMutationID {
                FacetRetainedDraftRecovery(
                    store: store, profileID: profileID,
                    mutationID: admittedMutationID, engine: owningEngine,
                    discardLocalDraft: { dismiss() })
            }
        }
        .onAppear {
            FacetDraftCoordinator.shared.register(
                lifecycleRegistration, owner: store, profileID: profileID,
                isDirty: { hasChanges || submitted != nil },
                flush: {
                    guard !hasChanges, submitted == nil, !isSaving else {
                        failure =
                            "Save or discard this task's draft before switching vaults or closing the app."
                        return false
                    }
                    return true
                })
        }
        .onDisappear { FacetDraftCoordinator.shared.unregister(lifecycleRegistration) }
        .confirmationDialog(
            "Discard your unsaved changes?", isPresented: $showsDiscard, titleVisibility: .visible
        ) {
            if submitted == nil { Button("Discard changes", role: .destructive) { dismiss() } }
            Button("Keep editing", role: .cancel) {}
        }
        .onChange(of: [
            title, status, priority, due, scheduled, bodyText, projects, contexts,
        ]) {
            if !isSaving, submitted == nil { mutationID = UUID().uuidString }
        }
        .onChange(of: extras) { if !isSaving, submitted == nil { mutationID = UUID().uuidString } }
        .frame(minWidth: FacetNativeStyle.formMinimumWidth, minHeight: 520)
    }
}

extension FacetTaskEditor {
    private func save() {
        guard !isSaving else { return }
        submit(submitted ?? (id: mutationID, command: editCommand()))
    }

    private func submit(_ envelope: (id: String, command: [String: FacetValue])) {
        guard !isSaving else { return }
        isSaving = true
        submitted = envelope
        _Concurrency.Task { await executeSubmission(envelope) }
    }
    private func executeSubmission(_ envelope: (id: String, command: [String: FacetValue])) async {
        defer { isSaving = false }
        guard store.engine === owningEngine, store.selectedProfileID == profileID else {
            failure = "Return to this task’s original vault before retrying the saved change."
            return
        }
        let admission = FacetMutationAdmission()
        if await store.execute(
            envelope.command, mutationID: envelope.id, profileID: profileID, admission: admission)
        {
            submitted = nil
            admittedMutationID = nil
            dismiss()
        } else {
            admittedMutationID = admission.mutationID ?? admittedMutationID
            if admittedMutationID == nil { submitted = nil }
            failure = store.error ?? "The task could not be saved. Your draft is retained."
        }
    }
    private func complete() {
        guard !hasChanges, submitted == nil, !isSaving else { return }
        guard !task.isRecurring || task.occurrenceDate != nil else {
            failure =
                "Choose this recurring task in Today or Upcoming "
                + "before completing a specific occurrence."
            return
        }
        var command: [String: FacetValue] = [
            "kind": .string("set_completion"),
            "path": .string(task.path), "expectedRevision": .string(task.revision),
            "completed": .bool(!task.completed),
        ]
        if let day = task.occurrenceDate { command["occurrenceDate"] = .string(day) }
        submit((id: UUID().uuidString, command: command))
    }

    private func tokens(_ label: String, key: String, value: Binding<String>) -> some View {
        FacetNativeTokenField(
            label: label, values: value.wrappedValue.split(separator: "\n").map(String.init),
            vocabulary: FacetWindowState.vocabulary(store.snapshot?.tasks ?? [])[key] ?? []
        ) { edited in
            value.wrappedValue = edited.joined(separator: "\n")
            return true
        }
    }

    private func editCommand() -> [String: FacetValue] {
        let changes = changedProperties()
        var command: [String: FacetValue] = [
            "kind": .string("edit_task"), "path": .string(task.path),
            "expectedRevision": .string(task.revision), "properties": .object(changes),
        ]
        if bodyText != task.body { command["body"] = .string(bodyText) }
        if status != task.status { command["status"] = .string(status) }
        if let occurrence = task.occurrenceDate { command["occurrenceDate"] = .string(occurrence) }
        return command
    }

    private func changedProperties() -> [String: FacetValue] {
        var changes = extras.changes(from: task.properties)
        if title != task.title { changes["title"] = .string(title) }
        if priority != task.priority { changes["priority"] = .string(priority) }
        for (role, edited) in [("due", due), ("scheduled", scheduled)]
        where edited != (task.properties[role]?.text ?? "") {
            changes[role] = edited.isEmpty ? .null : .string(edited)
        }
        for (role, edited) in [
            ("projects", projects), ("contexts", contexts),
        ] where edited != Self.tokens(task.properties[role]) {
            changes[role] = .array(edited.split(separator: "\n").map { .string(String($0)) })
        }
        return changes
    }

    private func archive() {
        guard !isSaving else { return }
        guard submitted == nil else { return }
        submit(
            (
                id: archiveMutationID,
                command: [
                    "kind": .string("archive"), "path": .string(task.path),
                    "expectedRevision": .string(task.revision), "archived": .bool(true),
                ]
            ))
    }

    private func delete() {
        guard !isSaving else { return }
        guard submitted == nil else { return }
        submit(
            (
                id: deleteMutationID,
                command: [
                    "kind": .string("delete_checked"), "path": .string(task.path),
                    "expectedRevision": .string(task.revision),
                    "checkBacklinks": .bool(true), "force": .bool(false),
                ]
            ))
    }

    private var hasChanges: Bool {
        title != task.title || status != task.status || priority != task.priority
            || due != (task.properties["due"]?.text ?? "")
            || scheduled != (task.properties["scheduled"]?.text ?? "") || bodyText != task.body
            || projects != Self.tokens(task.properties["projects"])
            || contexts != Self.tokens(task.properties["contexts"])
            || extras != FacetTaskExtras(properties: task.properties)
    }

    private static func tokens(_ value: FacetValue?) -> String {
        if let text = value?.text { return text }
        return value?.array?.elements.compactMap(\.text).joined(separator: "\n") ?? ""
    }
}
