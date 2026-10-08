import Foundation
import SwiftUI
import TaskNotesKit

struct FacetSavedViewsForm: View {
    let store: FacetStore
    let profileID: String
    @Binding var board: Bool
    @State private var rows: [FacetSavedView]
    @State private var name = ""
    @State private var editingID: String?
    @State private var creatingID = UUID().uuidString
    @State private var copyIDs: [String: String] = [:]
    @Environment(\.dismiss) private var dismiss

    init(store: FacetStore, profileID: String, board: Binding<Bool>) {
        self.store = store
        self.profileID = profileID
        _board = board
        _rows = State(initialValue: store.snapshot?.views ?? [])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(editingID == nil ? "Save the current view" : "Update the current view") {
                    TextField("Name", text: $name)
                    Button("Save view") { _Concurrency.Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Section("Saved views") {
                    ForEach(rows) { view in
                        VStack(alignment: .leading) {
                            Button(view.view["name"]?.text ?? view.id) {
                                _Concurrency.Task {
                                    guard store.selectedProfileID == profileID else { return }
                                    await store.applyView(view)
                                    board = view.view["viewType"] == .string("board")
                                    dismiss()
                                }
                            }
                            HStack {
                                Button("Update") {
                                    editingID = view.id
                                    name = view.view["name"]?.text ?? view.id
                                }
                                Button("Duplicate") { _Concurrency.Task { await duplicate(view) } }
                                Button("Earlier") { _Concurrency.Task { await move(view, by: -1) } }
                                Button("Later") { _Concurrency.Task { await move(view, by: 1) } }
                                Button("Delete", role: .destructive) {
                                    _Concurrency.Task { await remove(view) }
                                }
                            }.font(.caption)
                        }
                    }
                    Button("Restore default views") {
                        _Concurrency.Task {
                            _ = await apply(["kind": .string("restore_default_views")])
                        }
                    }
                }
            }.disabled(store.isSaving)
                .navigationTitle("Saved views")
                .toolbar { Button("Done") { dismiss() } }
        }.frame(minWidth: 340, minHeight: 420)
    }

    private func save() async {
        guard store.selectedProfileID == profileID else { return }
        var view = rows.first(where: { $0.id == editingID })?.view ?? [:]
        view.merge(store.currentView(name: name, board: board)) { _, new in new }
        if await apply([
            "kind": .string("save_view"), "id": .string(editingID ?? creatingID),
            "view": .object(view),
        ]) {
            name = ""
            editingID = nil
            creatingID = UUID().uuidString
        }
    }

    private func duplicate(_ view: FacetSavedView) async {
        var copy = view.view
        copy["name"] = .string((view.view["name"]?.text ?? view.id) + " copy")
        let id = copyIDs[view.id] ?? UUID().uuidString
        copyIDs[view.id] = id
        if await apply(["kind": .string("save_view"), "id": .string(id), "view": .object(copy)]) {
            copyIDs.removeValue(forKey: view.id)
        }
    }

    private func remove(_ view: FacetSavedView) async {
        _ = await apply(["kind": .string("delete_view"), "id": .string(view.id)])
    }

    private func move(_ view: FacetSavedView, by amount: Int) async {
        guard let index = rows.firstIndex(where: { $0.id == view.id }),
            rows.indices.contains(index + amount)
        else { return }
        var ids = rows.map(\.id)
        ids.swapAt(index, index + amount)
        _ = await apply([
            "kind": .string("reorder_views"), "ids": .array(ids.map(FacetValue.string)),
        ])
    }

    @discardableResult
    private func apply(_ command: [String: FacetValue]) async -> Bool {
        let saved = await store.perform(command, profileID: profileID)
        if saved, store.snapshot?.profileId == profileID { rows = store.snapshot?.views ?? [] }
        return saved
    }
}
