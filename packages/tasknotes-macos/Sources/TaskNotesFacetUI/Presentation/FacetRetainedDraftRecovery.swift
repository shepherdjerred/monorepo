import SwiftUI
import TaskNotesKit

internal struct FacetRetainedDraftRecovery: View {
    let store: FacetStore
    let profileID: String
    let mutationID: String
    let engine: FacetEngine?
    let discardLocalDraft: () -> Void
    @State private var pending: FacetPendingMutation?
    @State private var observed = false
    @State private var busy = false
    @State private var error: String?
    @State private var confirmsDiscard = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Original saved action") {
                    Text(mutationID).font(.caption).textSelection(.enabled)
                    Text(
                        "Resume checks the original request. "
                            + "Retire requires authoritative proof that it was not applied. "
                            + "Pending or applied work is protected."
                    )
                    if let pending {
                        Button("Resume and check outcome") {
                            run { await store.resumeSavedAction(pending) }
                        }
                        .disabled(!pending.canResume)
                        Button("Check outcome and retire safely", role: .destructive) {
                            run { await store.retireSavedAction(pending) }
                        }
                    } else if observed {
                        Label(
                            "The original saved action has been resolved.",
                            systemImage: "checkmark.circle")
                        Button("Discard this local draft…", role: .destructive) {
                            confirmsDiscard = true
                        }
                    }
                    Button("Refresh saved outcome") { run {} }
                    if let error { Label(error, systemImage: "exclamationmark.triangle") }
                    if let storeError = store.error { Text(storeError).foregroundStyle(.red) }
                }
            }.disabled(busy).navigationTitle("Recover saved change")
                .toolbar { Button("Done") { dismiss() } }
                .confirmationDialog("Discard the local task draft?", isPresented: $confirmsDiscard)
            {
                Button("Discard local draft", role: .destructive) {
                    run {
                        do {
                            let latest = try await store.observeDraftRecovery(
                                profileID: profileID,
                                mutationID: mutationID, expectedEngine: engine)
                            guard latest.pending == nil else { return }
                            discardLocalDraft()
                        } catch { self.error = error.localizedDescription }
                    }
                }
            } message: {
                Text("This discards local typing. It does not undo the resolved saved action.")
            }
        }.task { await refresh() }
    }

    private func run(_ operation: @escaping @MainActor () async -> Void) {
        guard !busy else { return }
        busy = true
        _Concurrency.Task {
            await operation()
            await refresh()
            busy = false
        }
    }
    private func refresh() async {
        do {
            pending = try await store.observeDraftRecovery(
                profileID: profileID, mutationID: mutationID,
                expectedEngine: engine
            ).pending
            observed = true
        } catch { self.error = error.localizedDescription }
    }
}
