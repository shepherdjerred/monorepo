import SwiftUI
import TaskNotesKit

internal struct FacetConflictForm: View {
    let store: FacetStore
    let profileID: String
    let conflict: FacetConflict
    let editingText: Bool
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var newPath = ""
    @State private var text: String
    @State private var decision: FacetConflictDecision?
    @State private var error: String?
    @State private var submitting = false
    @State private var showsClose = false

    init(
        store: FacetStore, profileID: String, conflict: FacetConflict, initialText: String?,
        saved: @escaping () -> Void
    ) {
        self.store = store
        self.profileID = profileID
        self.conflict = conflict
        editingText = initialText != nil
        self.saved = saved
        _text = State(initialValue: initialText ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(conflict.path) {
                    if editingText {
                        Text(
                            "Both original versions remain retained until this resolution is saved. "
                                + "Text is limited to 1 MiB of UTF-8."
                        )
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                        TextEditor(text: $text).font(.system(.body, design: .monospaced))
                            .frame(minHeight: 220)
                    } else {
                        Text(
                            "Keep your version here and save the other version at a new vault-relative path."
                        )
                        .fixedSize(horizontal: false, vertical: true)
                        VStack(alignment: .leading) {
                            Text("Destination path, including extension").font(.caption)
                            TextField("Notes/Other version.md", text: $newPath).labelsHidden()
                                .textFieldStyle(.roundedBorder)
                                .frame(maxWidth: .infinity)
                        }
                    }
                }.disabled(decision != nil || submitting)
                if decision != nil {
                    Section {
                        Text(
                            "This draft is fixed for retry. If the result is uncertain, "
                                + "close this form and resume the retained action from Facet."
                        )
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
                if let storeError = store.error { Text(storeError).foregroundStyle(.red) }
                Section {
                    Button(decision == nil ? "Save resolution" : "Retry original resolution") {
                        _Concurrency.Task { await submit() }
                    }.disabled(submitting || store.isSaving || (!editingText && newPath.isEmpty))
                    Button("Close") { showsClose = true }.disabled(submitting)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(editingText ? "Edit resolution" : "Keep both versions")
            .interactiveDismissDisabled(submitting || decision != nil)
            .confirmationDialog("Close this resolution?", isPresented: $showsClose) {
                Button(decision == nil ? "Discard unsaved draft" : "Close; retain submitted action")
                {
                    dismiss()
                }
            }
        }.frame(minWidth: 360, minHeight: 460)
    }

    private func submit() async {
        guard !submitting else { return }
        do {
            if decision == nil {
                decision =
                    editingText
                    ? try FacetConflictDecision(
                        profileID: profileID, conflict: conflict, text: text)
                    : FacetConflictDecision(
                        profileID: profileID, conflict: conflict, newPath: newPath)
            }
            guard let decision else { return }
            submitting = true
            defer { submitting = false }
            if await store.submitConflictDecision(decision) {
                saved()
                dismiss()
            }
        } catch { self.error = error.localizedDescription }
    }
}
