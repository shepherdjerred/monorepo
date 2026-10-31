import Foundation
import SwiftUI
import TaskNotesKit

struct FacetSavedViewsForm: View {
    let store: FacetStore
    let profileID: String
    let window: FacetWindowState?
    let admitNavigation: (@MainActor () async -> Bool)?
    @Binding var board: Bool
    @State private var rows: [FacetSavedView]
    @State private var name = ""
    @State private var editingID: String?
    @State private var creatingID = UUID().uuidString
    @State private var copyIDs: [String: String] = [:]
    @State private var action = FacetSavedViewDraft()
    @State private var clearsNameOnSuccess = false
    @State private var lifecycleOwner = UUID()
    @State private var editor: FacetSavedViewEditorModel?
    @State private var showsDiscard = false
    @Environment(\.dismiss) private var dismiss

    init(
        store: FacetStore, profileID: String, board: Binding<Bool>, window: FacetWindowState? = nil,
        admitNavigation: (@MainActor () async -> Bool)? = nil
    ) {
        self.store = store
        self.profileID = profileID
        self.window = window
        self.admitNavigation = admitNavigation
        _board = board
        _rows = State(initialValue: (window?.snapshot ?? store.snapshot)?.views ?? [])
    }

    var body: some View {
        NavigationStack {
            Form {
                #if os(iOS)
                    Section {
                        Button("Create saved view", systemImage: "plus") { edit(nil) }
                    }.disabled(action.isSubmitting || action.hasRetainedSubmission)
                #else
                    Section(editingID == nil ? "Save the current view" : "Update the current view")
                    {
                        TextField("Name", text: $name)
                        Button("Save view") { save() }
                            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }.disabled(action.isSubmitting || action.hasRetainedSubmission)
                #endif
                savedRows.disabled(action.isSubmitting || action.hasRetainedSubmission)
                recovery
            }.disabled(action.isSubmitting)
                .navigationTitle("Saved views")
                .toolbar {
                    Button("Done") { dismiss() }.disabled(
                        action.hasRetainedSubmission || action.isSubmitting)
                }
        }.frame(minWidth: FacetNativeStyle.formMinimumWidth, minHeight: 420)
            .interactiveDismissDisabled(action.hasRetainedSubmission || action.isSubmitting)
            .onAppear {
                FacetDraftCoordinator.shared.register(
                    lifecycleOwner, owner: store, profileID: profileID,
                    isDirty: {
                        action.hasRetainedSubmission || action.isSubmitting
                            || (editor?.hasChanges ?? false)
                    },
                    flush: {
                        !action.hasRetainedSubmission && !action.isSubmitting
                            && !(editor?.hasChanges ?? false)
                    })
            }
            .onDisappear { FacetDraftCoordinator.shared.unregister(lifecycleOwner) }
            .sheet(item: $editor) { model in editorSheet(model) }
    }

    private var savedRows: some View {
        Section("Saved views") {
            ForEach(rows) { view in savedRow(view) }
            Button("Restore default views") { apply(["kind": .string("restore_default_views")]) }
        }
    }

    private func savedRow(_ view: FacetSavedView) -> some View {
        VStack(alignment: .leading) {
            let title = view.view["name"]?.text ?? view.id
            #if os(iOS)
                Button {
                    edit(view)
                } label: {
                    Label(title, systemImage: "pencil")
                }
                .accessibilityLabel("Edit \(title)")
                .accessibilityHint("Change this saved view’s filters and appearance")
            #else
                Button(title) { open(view) }
            #endif
            ViewThatFits(in: .horizontal) {
                HStack { rowActions(view) }
                VStack(alignment: .leading) { rowActions(view) }
            }.font(.caption)
        }
        #if os(iOS)
            .buttonStyle(.borderless)
        #endif
    }

    @ViewBuilder private func rowActions(_ view: FacetSavedView) -> some View {
        Button(editActionTitle) {
            #if os(iOS)
                edit(view)
            #else
                editingID = view.id
                name = view.view["name"]?.text ?? view.id
            #endif
        }
        Button("Duplicate") { duplicate(view) }
        Button("Earlier") { move(view, by: -1) }
        Button("Later") { move(view, by: 1) }
        Button("Delete", role: .destructive) {
            apply(["kind": .string("delete_view"), "id": .string(view.id)])
        }
    }

    private var editActionTitle: String {
        #if os(iOS)
            "Edit"
        #else
            "Update"
        #endif
    }

    @ViewBuilder private var recovery: some View {
        if let error = action.error {
            Section("Retained view change") {
                Label(error, systemImage: "exclamationmark.triangle")
                Button(action.needsObservation ? "Check saved result" : "Retry original change") {
                    guard action.beginRetry() else { return }
                    _Concurrency.Task { await finishSubmission() }
                }
                if let id = action.admittedMutationID { retainedAction(id) }
                if let storeError = store.error { Text(storeError).foregroundStyle(.red) }
            }
        }
    }

    private func retainedAction(_ id: String) -> some View {
        Group {
            Text("Saved action: \(id)").font(.caption).textSelection(.enabled)
            if let pending = store.pendingActions.first(where: {
                $0.id == id && $0.profileID == profileID
            }) {
                Button("Resume and check outcome") {
                    _Concurrency.Task { await store.resumeSavedAction(pending) }
                }
                Button("Retire safely", role: .destructive) {
                    _Concurrency.Task { await store.retireSavedAction(pending) }
                }
            }
            Button("Release resolved action") {
                _Concurrency.Task { _ = await action.releaseResolved() }
            }
        }
    }
}

extension FacetSavedViewsForm {
    private func open(_ view: FacetSavedView) {
        _Concurrency.Task {
            guard store.selectedProfileID == profileID else { return }
            guard await admitNavigation?() ?? true, store.selectedProfileID == profileID else {
                return
            }
            if let window {
                await window.apply(view, store: store)
            } else {
                await store.applyView(view)
            }
            guard store.selectedProfileID == profileID else { return }
            board = view.view["viewType"] == .string("board")
            dismiss()
        }
    }

    private func save() {
        guard store.selectedProfileID == profileID else { return }
        var view = rows.first(where: { $0.id == editingID })?.view ?? [:]
        if let window {
            do {
                guard case .object(let query) = try window.query() else {
                    throw FacetContractError.unsupportedResponse
                }
                view.merge([
                    "name": .string(name), "viewType": .string(board ? "board" : "list"),
                    "query": .object(FacetSavedViewQuery.selection(query)),
                ]) { _, new in new }
            } catch {
                store.reportNativeFailure(error)
                return
            }
        } else {
            view.merge(store.currentView(name: name, board: board)) { _, new in new }
        }
        apply(
            [
                "kind": .string("save_view"), "id": .string(editingID ?? creatingID),
                "view": .object(view),
            ], clearsName: true)
    }

    private func edit(_ view: FacetSavedView?) {
        guard !action.isSubmitting, !action.hasRetainedSubmission else { return }
        do {
            if let view {
                editor = try FacetSavedViewEditorModel(id: view.id, fields: view.view, isNew: false)
                return
            }
            #if os(iOS)
                editor = try FacetSavedViewEditorModel.fresh(id: creatingID, order: rows.count)
            #else
                var fields = store.currentView(name: "", board: board)
                if let window, case .object(let query) = try window.query() {
                    fields["query"] = .object(query)
                }
                fields["order"] = .integer(Int64(rows.count))
                editor = try FacetSavedViewEditorModel(id: creatingID, fields: fields, isNew: true)
            #endif
        } catch { store.reportNativeFailure(error) }
    }

    private func editorSheet(_ model: FacetSavedViewEditorModel) -> some View {
        NavigationStack {
            Form {
                if let snapshot = window?.snapshot ?? store.snapshot {
                    FacetSavedViewEditorFields(
                        editor: model, configuration: snapshot.configuration,
                        vocabulary: window?.vocabulary
                            ?? FacetWindowState.vocabulary(snapshot.tasks)
                    ).disabled(action.isSubmitting || action.hasRetainedSubmission)
                }
                recovery
            }
            .navigationTitle(model.isNew ? "New saved view" : "Edit saved view")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if model.hasChanges { showsDiscard = true } else { editor = nil }
                    }.disabled(action.isSubmitting || action.hasRetainedSubmission)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        apply(
                            [
                                "kind": .string("save_view"), "id": .string(model.id),
                                "view": .object(model.value),
                            ], clearsName: true)
                    }.disabled(
                        !model.canSave || action.isSubmitting || action.hasRetainedSubmission
                    )
                    .accessibilityIdentifier("facet.saved-view.save")
                }
            }
            .confirmationDialog("Discard this view’s changes?", isPresented: $showsDiscard) {
                Button("Discard changes", role: .destructive) { editor = nil }
                Button("Keep editing", role: .cancel) {}
            }
        }.interactiveDismissDisabled(
            model.hasChanges || action.isSubmitting || action.hasRetainedSubmission)
    }

    private func duplicate(_ view: FacetSavedView) {
        do {
            let copy = try FacetSavedViewQuery.duplicate(view)
            let id = copyIDs[view.id] ?? UUID().uuidString
            copyIDs[view.id] = id
            apply(["kind": .string("save_view"), "id": .string(id), "view": .object(copy)])
        } catch { store.reportNativeFailure(error) }
    }

    private func move(_ view: FacetSavedView, by amount: Int) {
        guard let index = rows.firstIndex(where: { $0.id == view.id }),
            rows.indices.contains(index + amount)
        else { return }
        var ids = rows.map(\.id)
        ids.swapAt(index, index + amount)
        apply([
            "kind": .string("reorder_views"), "ids": .array(ids.map(FacetValue.string)),
        ])
    }

    private func apply(_ command: [String: FacetValue], clearsName: Bool = false) {
        guard let operations = store.savedViewOperations(profileID: profileID, window: window),
            action.begin(command, operations: operations)
        else { return }
        clearsNameOnSuccess = clearsName
        _Concurrency.Task { await finishSubmission() }
    }

    private func finishSubmission() async {
        guard let observed = await action.submit() else { return }
        rows = observed.views
        copyIDs = [:]
        if clearsNameOnSuccess {
            name = ""
            editingID = nil
            creatingID = UUID().uuidString
            editor = nil
        }
        clearsNameOnSuccess = false
    }
}
