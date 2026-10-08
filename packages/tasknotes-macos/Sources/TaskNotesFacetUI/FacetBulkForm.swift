import SwiftUI
import TaskNotesKit

struct FacetBulkForm: View {
    let store: FacetStore
    let profileID: String
    let tasks: [FacetTask]
    let priorities: [(value: String, label: String)]
    let applied: () -> Void
    @State private var priority = ""
    @State private var scheduled = ""
    @State private var showsDelete = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("\(tasks.count) selected tasks") {
                    Button("Complete selected occurrences") { complete() }
                    if tasks.contains(where: { $0.isRecurring && $0.occurrenceDate == nil }) {
                        Text("Choose recurring occurrences in Agenda before completing them.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    TextField("Scheduled date or date-time", text: $scheduled)
                    Button("Set scheduled date") { update("scheduled", value: .string(scheduled)) }
                        .disabled(scheduled.isEmpty)
                    Button("Clear scheduled date") { update("scheduled", value: .null) }
                    Picker("Priority", selection: $priority) {
                        Text("Choose priority").tag("")
                        ForEach(priorities, id: \.value) { Text($0.label).tag($0.value) }
                    }
                    Button("Set priority") { update("priority", value: .string(priority)) }
                        .disabled(priority.isEmpty)
                    Button("Delete selected notes", role: .destructive) { showsDelete = true }
                }
                Section {
                    Text(
                        "These changes are applied together. "
                            + "If any note changed, your selection is retained for review."
                    )
                    .font(.caption)
                    ForEach(tasks) { Text($0.title) }
                }
            }.disabled(store.isSaving)
                .navigationTitle("Bulk actions")
                .toolbar { Button("Done") { dismiss() } }
                .confirmationDialog("Delete all selected task notes?", isPresented: $showsDelete) {
                    Button("Delete notes", role: .destructive) {
                        apply(
                            tasks.map { task in
                                [
                                    "kind": .string("delete_checked"), "path": .string(task.path),
                                    "expectedRevision": .string(task.revision),
                                    "checkBacklinks": .bool(true), "force": .bool(false),
                                ]
                            })
                    }
                }
        }.frame(minWidth: 340, minHeight: 440)
    }

    private func complete() {
        guard !tasks.contains(where: { $0.isRecurring && $0.occurrenceDate == nil }) else { return }
        apply(
            tasks.map { task in
                var command: [String: FacetValue] = [
                    "kind": .string("set_completion"), "path": .string(task.path),
                    "expectedRevision": .string(task.revision), "completed": .bool(true),
                ]
                if let day = task.occurrenceDate { command["occurrenceDate"] = .string(day) }
                return command
            })
    }

    private func update(_ role: String, value: FacetValue) {
        apply(
            tasks.map { task in
                [
                    "kind": .string("update"), "path": .string(task.path),
                    "expectedRevision": .string(task.revision),
                    "properties": .object([role: value]),
                ]
            })
    }

    private func apply(_ commands: [[String: FacetValue]]) {
        _Concurrency.Task {
            if await store.perform(
                [
                    "kind": .string("batch"), "commands": .array(commands.map(FacetValue.object)),
                ], profileID: profileID)
            {
                applied()
                dismiss()
            }
        }
    }
}
