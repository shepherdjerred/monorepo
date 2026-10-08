import SwiftUI
import TaskNotesKit

struct FacetMoveTaskForm: View {
    let store: FacetStore
    let task: FacetTask
    let profileID: String
    let moved: () -> Void
    @State private var destination = ""
    @State private var updateReferences = true
    @State private var mutationID = UUID().uuidString
    @State private var submitting = false

    var body: some View {
        Form {
            Section("Move task note") {
                Text(task.path).textSelection(.enabled)
                TextField("New vault path, including .md", text: $destination)
                Toggle("Update references to this note", isOn: $updateReferences)
                Text("Save other edits before moving. Facet checks the original note revision.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let error = store.error { Text(error).foregroundStyle(.red) }
            Button("Move") { _Concurrency.Task { await submit() } }
                .disabled(destination.isEmpty || destination == task.path)
        }
        .disabled(submitting || store.isSaving)
        .navigationTitle("Move task")
        .onChange(of: destination) { if !submitting { mutationID = UUID().uuidString } }
        .onChange(of: updateReferences) { if !submitting { mutationID = UUID().uuidString } }
    }

    private func submit() async {
        guard !submitting else { return }
        submitting = true
        defer { submitting = false }
        let applied = await store.execute(
            [
                "kind": .string("rename_references"), "path": .string(task.path),
                "newPath": .string(destination), "expectedRevision": .string(task.revision),
                "updateReferences": .bool(updateReferences),
            ], mutationID: mutationID, profileID: profileID)
        if applied { moved() }
    }
}
