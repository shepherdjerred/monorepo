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
    @State private var showsRecovery = false
    @State private var draft = FacetBulkDraft()
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
                }.disabled(draft.isSubmitting || draft.hasRetainedSubmission)
                Section {
                    Text(
                        "These changes are applied together. "
                            + "If any note changed, your selection is retained for review."
                    )
                    .font(.caption)
                    ForEach(tasks, id: \.rowID) { task in
                        Text(task.title)
                        if let day = task.occurrenceDate { Text(day).font(.caption) }
                    }
                }
                if let error = draft.error {
                    Section("Action needs attention") {
                        Text(error).foregroundStyle(.red)
                    }
                }
                if draft.hasRetainedSubmission {
                    Section("Retained action") {
                        if let id = draft.admittedMutationID {
                            Text(id).font(.caption).textSelection(.enabled)
                        }
                        Button("Retry original action") {
                            guard draft.beginRetry() else { return }
                            submit()
                        }
                        Button("Saved actions") { showsRecovery = true }
                        Button("Check resolution") {
                            _Concurrency.Task { _ = await draft.releaseResolved() }
                        }
                    }.disabled(draft.isSubmitting)
                }
            }
            .navigationTitle("Bulk actions")
            .toolbar { Button("Done") { dismiss() }.disabled(draft.isSubmitting) }
            .interactiveDismissDisabled(draft.isSubmitting)
            .sheet(isPresented: $showsRecovery) { FacetCaptureRecoveryView(store: store) }
            .confirmationDialog("Delete all selected task notes?", isPresented: $showsDelete) {
                Button("Delete notes", role: .destructive) {
                    apply(.delete)
                }
            }
        }.frame(minWidth: 340, minHeight: 440)
    }

    private func complete() {
        apply(.complete)
    }

    private func update(_ role: String, value: FacetValue) {
        apply(.update(role, value))
    }

    private func apply(_ action: FacetBulkAction) {
        guard let operations = store.bulkOperations(profileID: profileID),
            draft.begin(tasks, action: action, operations: operations)
        else { return }
        submit()
    }

    private func submit() {
        _Concurrency.Task {
            if await draft.submit() {
                applied()
                dismiss()
            }
        }
    }
}
