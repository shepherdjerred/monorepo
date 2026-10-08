import Foundation
import SwiftUI
import TaskNotesKit

struct FacetTaskEditor: View {
    let store: FacetStore
    let task: FacetTask
    private let profileID: String
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

    init(
        store: FacetStore, task: FacetTask, profileID: String,
        statuses: [(value: String, label: String)], priorities: [(value: String, label: String)]
    ) {
        self.store = store
        self.task = task
        self.profileID = profileID
        self.statuses = statuses
        self.priorities = priorities
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
                Section("Task") {
                    TextField("Title", text: $title).accessibilityIdentifier("facet.editor.title")
                    Picker("Status", selection: $status) {
                        ForEach(statuses, id: \.value) { Text($0.label).tag($0.value) }
                    }
                    Picker("Priority", selection: $priority) {
                        ForEach(priorities, id: \.value) { Text($0.label).tag($0.value) }
                    }
                    TextField("Due date or date-time", text: $due)
                    TextField("Scheduled date or date-time", text: $scheduled)
                }
                Section("Organization") {
                    TextField("Projects, one per line", text: $projects, axis: .vertical)
                    TextField("Contexts, one per line", text: $contexts, axis: .vertical)
                }
                FacetTaskExtrasFields(draft: $extras)
                Section("Markdown") { TextEditor(text: $bodyText).frame(minHeight: 180) }
                Section {
                    Text(task.path).font(.caption).foregroundStyle(.secondary).textSelection(
                        .enabled)
                    Button("Archive task") {
                        _Concurrency.Task { await archive() }
                    }
                    NavigationLink("Move task note…") {
                        FacetMoveTaskForm(
                            store: store, task: task, profileID: profileID, moved: { dismiss() })
                    }.disabled(hasChanges)
                    Button("Delete task", role: .destructive) { showsDelete = true }
                }
            }
            .disabled(isSaving || store.isSaving)
            .navigationTitle("Edit task")
            .toolbar {
                ToolbarItemGroup {
                    Button("Cancel") { if hasChanges { showsDiscard = true } else { dismiss() } }
                        .disabled(isSaving)
                    Button("Save") { _Concurrency.Task { await save() } }.disabled(
                        isSaving || title.isEmpty
                    )
                    .accessibilityIdentifier("facet.editor.save")
                }
            }
            .confirmationDialog(
                "Delete this task note?", isPresented: $showsDelete, titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    _Concurrency.Task { await delete() }
                }
            }
        }
        .interactiveDismissDisabled(hasChanges || isSaving)
        .confirmationDialog(
            "Discard your unsaved changes?", isPresented: $showsDiscard, titleVisibility: .visible
        ) {
            Button("Discard changes", role: .destructive) { dismiss() }
            Button("Keep editing", role: .cancel) {}
        }
        .onChange(of: [
            title, status, priority, due, scheduled, bodyText, projects, contexts,
        ]) {
            if !isSaving { mutationID = UUID().uuidString }
        }
        .onChange(of: extras) { if !isSaving { mutationID = UUID().uuidString } }
        .frame(minWidth: 340, minHeight: 520)
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        if await store.execute(editCommand(), mutationID: mutationID, profileID: profileID) {
            dismiss()
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

    private func archive() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        if await store.execute(
            [
                "kind": .string("archive"), "path": .string(task.path),
                "expectedRevision": .string(task.revision), "archived": .bool(true),
            ], mutationID: archiveMutationID, profileID: profileID)
        {
            dismiss()
        }
    }

    private func delete() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        if await store.execute(
            [
                "kind": .string("delete_checked"), "path": .string(task.path),
                "expectedRevision": .string(task.revision),
                "checkBacklinks": .bool(true), "force": .bool(false),
            ], mutationID: deleteMutationID, profileID: profileID)
        {
            dismiss()
        }
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
