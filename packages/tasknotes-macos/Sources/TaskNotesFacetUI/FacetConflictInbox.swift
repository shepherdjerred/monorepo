import SwiftUI
import TaskNotesKit

struct FacetConflictInbox: View {
    let store: FacetStore
    private let profileID: String?
    @State private var previewText: String?
    @State private var previewPresented = false
    @State private var rows: [FacetConflict]
    @State private var decisions: [String: String] = [:]
    @State private var form: FormSelection?
    @State private var exports: [String: URL] = [:]
    @Environment(\.dismiss) private var dismiss

    init(store: FacetStore) {
        self.store = store
        profileID = store.selectedProfileID
        _rows = State(initialValue: store.conflicts)
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(rows) { conflict in
                    Section(conflict.path) {
                        versionControls(conflict, version: .local, label: "Your version")
                        versionControls(conflict, version: .remote, label: "Other version")
                        resolutionControls(conflict)
                    }
                }
                if rows.isEmpty { Text("All conflicts are resolved.") }
                if store.conflictCursor != nil, let profileID {
                    Button("Load more conflicts") {
                        _Concurrency.Task {
                            await store.loadMoreConflicts(profileID: profileID)
                            if profileID == store.selectedProfileID { rows = store.conflicts }
                        }
                    }
                }
            }
            .navigationTitle("Conflict inbox")
            .toolbar { Button("Done") { dismiss() } }
        }.frame(minWidth: 360, minHeight: 420)
            .sheet(isPresented: $previewPresented) {
                NavigationStack {
                    ScrollView {
                        Text(previewText ?? "").font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled).padding()
                    }
                    .navigationTitle("Retained version")
                    .toolbar { Button("Done") { previewPresented = false } }
                }.frame(minWidth: 340, minHeight: 380)
            }
            .sheet(item: $form) { selection in
                if let profileID {
                    FacetConflictForm(
                        store: store, profileID: profileID, conflict: selection.conflict,
                        initialText: selection.initialText,
                        saved: { rows.removeAll { $0.id == selection.conflict.id } })
                }
            }
    }

    private struct FormSelection: Identifiable {
        let id = UUID()
        let conflict: FacetConflict
        let initialText: String?
    }

    private func versionControls(
        _ conflict: FacetConflict, version: FacetConflictVersion, label: String
    )
        -> some View
    {
        let metadata = conflict.metadata(version: version)
        let key = conflict.id + ":" + version.rawValue
        return VStack(alignment: .leading, spacing: 8) {
            Text("\(label): \(metadata?.size ?? 0) bytes").font(.caption)
            ViewThatFits(in: .horizontal) {
                HStack { versionButtons(conflict, version: version, key: key, metadata: metadata) }
                VStack(alignment: .leading) {
                    versionButtons(conflict, version: version, key: key, metadata: metadata)
                }
            }
            if let url = exports[key] { ShareLink("Share exported version", item: url) }
            if let metadata, metadata.size > FacetRetainedText.maximumBytes {
                Text("Text editing is limited to 1 MiB. Export or keep this complete version.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.disabled(store.isSaving)
    }

    @ViewBuilder
    private func versionButtons(
        _ conflict: FacetConflict, version: FacetConflictVersion, key: String,
        metadata: FacetVersionMetadata?
    ) -> some View {
        Button("Preview") { showPreview(conflict, version: version) }
        Button("Edit text…") { editText(conflict, version: version) }
            .disabled(metadata == nil || (metadata?.size ?? 0) > FacetRetainedText.maximumBytes)
        Button("Export exact version") { export(conflict, version: version, key: key) }
            .disabled(metadata == nil)
    }

    private func resolutionControls(_ conflict: FacetConflict) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack { resolutionButtons(conflict) }
            VStack(alignment: .leading) { resolutionButtons(conflict) }
        }.disabled(store.isSaving)
    }

    @ViewBuilder
    private func resolutionButtons(_ conflict: FacetConflict) -> some View {
        Button("Keep mine") { resolve(conflict, kind: "keep_local") }
        Button("Keep other") { resolve(conflict, kind: "keep_remote") }
        Button("Keep both…") { form = FormSelection(conflict: conflict, initialText: nil) }
    }

    private func editText(_ conflict: FacetConflict, version: FacetConflictVersion) {
        guard let profileID else { return }
        _Concurrency.Task {
            if let text = await store.conflictPreview(
                profileID: profileID, conflict: conflict, version: version)
            {
                form = FormSelection(conflict: conflict, initialText: text)
            }
        }
    }

    private func export(_ conflict: FacetConflict, version: FacetConflictVersion, key: String) {
        guard let profileID else { return }
        _Concurrency.Task {
            if let url = await store.exportConflict(
                profileID: profileID, conflict: conflict, version: version)
            {
                exports[key] = url
            }
        }
    }

    private func resolve(_ conflict: FacetConflict, kind: String) {
        guard let profileID, !store.isSaving else { return }
        let key = conflict.id + ":" + kind
        let mutationID = decisions[key] ?? UUID().uuidString
        decisions[key] = mutationID
        _Concurrency.Task {
            let saved = await store.resolveConflict(
                conflict: conflict, resolution: .object(["kind": .string(kind)]),
                mutationID: mutationID, profileID: profileID)
            if saved {
                rows.removeAll { $0.id == conflict.id }
                decisions.removeValue(forKey: key)
            }
        }
    }

    private func showPreview(_ conflict: FacetConflict, version: FacetConflictVersion) {
        guard let profileID else { return }
        _Concurrency.Task {
            if let text = await store.conflictPreview(
                profileID: profileID, conflict: conflict, version: version)
            {
                previewText = text
                previewPresented = true
            }
        }
    }
}
