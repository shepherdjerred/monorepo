import SwiftUI
import TaskNotesKit

struct FacetTaskBrowser: View {
    let store: FacetStore
    let snapshot: FacetSnapshot
    @Binding var board: Bool
    @State private var selected: Set<String> = []
    @State private var editor: FacetEditorSelection?
    @State private var bulk: FacetBulkSelection?
    @State private var viewsProfile: FacetProfileSelection?

    var body: some View {
        Group {
            if board { boardView } else { taskList }
        }
        .toolbar {
            ToolbarItemGroup {
                Button("Saved views", systemImage: "rectangle.stack") {
                    viewsProfile = FacetProfileSelection(id: snapshot.profileId)
                }
                Button("Undo", systemImage: "arrow.uturn.backward") {
                    _Concurrency.Task { await store.undoLast(profileID: snapshot.profileId) }
                }.disabled(store.isSaving)
                if !selected.isEmpty {
                    Button("Actions for \(selected.count) tasks") {
                        bulk = FacetBulkSelection(
                            profileID: snapshot.profileId,
                            tasks: snapshot.tasks.filter { selected.contains($0.id) },
                            priorities: store.priorities)
                    }
                }
            }
        }
        .sheet(item: $editor) { selection in
            FacetTaskEditor(
                store: store, task: selection.task, profileID: selection.profileID,
                statuses: selection.statuses, priorities: selection.priorities)
        }
        .sheet(item: $bulk) { selection in
            FacetBulkForm(
                store: store, profileID: selection.profileID, tasks: selection.tasks,
                priorities: selection.priorities, applied: { selected = [] })
        }
        .sheet(item: $viewsProfile) { owner in
            FacetSavedViewsForm(store: store, profileID: owner.id, board: $board)
        }
        .onChange(of: snapshot.profileId) { selected = [] }
    }

    private var taskList: some View {
        List {
            if snapshot.tasks.isEmpty {
                ContentUnavailableView("No matching tasks", systemImage: "checkmark.circle")
            }
            ForEach(snapshot.tasks) { task in
                HStack {
                    Toggle("Select \(task.title)", isOn: selection(task)).labelsHidden()
                    Button {
                        _Concurrency.Task {
                            await store.toggle(task, profileID: snapshot.profileId)
                        }
                    } label: {
                        Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                    }.buttonStyle(.plain).accessibilityLabel(
                        task.completed ? "Uncomplete \(task.title)" : "Complete \(task.title)")
                    Button {
                        open(task)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(task.title).foregroundStyle(.primary)
                            Text("\(task.status) · \(task.priority)").font(.caption)
                                .foregroundStyle(.secondary)
                            if let day = task.occurrenceDate { Text(day).font(.caption) }
                        }
                    }.buttonStyle(.plain)
                    Spacer()
                }.accessibilityIdentifier("facet.task.\(task.path)")
            }
            if snapshot.totalCount > UInt64(snapshot.tasks.count) {
                Button("Load more tasks") { _Concurrency.Task { await store.loadMore() } }
            }
            ForEach(Array(snapshot.problems.enumerated()), id: \.offset) { _, problem in
                Label(
                    "\(problem.path): \(problem.message)", systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.orange)
            }
        }.refreshable { await store.refresh() }
    }

    private var boardView: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top) {
                ForEach(store.statuses, id: \.value) { status in
                    VStack(alignment: .leading) {
                        Text(status.label).font(.headline)
                        ForEach(snapshot.tasks.filter { $0.status == status.value }) { task in
                            VStack(alignment: .leading) {
                                Button(task.title) { open(task) }.buttonStyle(.plain)
                                Toggle("Select task", isOn: selection(task))
                                Menu("Move to…") {
                                    ForEach(store.statuses, id: \.value) { target in
                                        Button(target.label) {
                                            _Concurrency.Task {
                                                await store.setStatus(
                                                    task, status: target.value,
                                                    profileID: snapshot.profileId)
                                            }
                                        }
                                    }
                                }.font(.caption)
                            }.padding().frame(maxWidth: .infinity, alignment: .leading)
                                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                        }
                    }.frame(width: 260).padding()
                }
            }
        }
    }

    private func selection(_ task: FacetTask) -> Binding<Bool> {
        Binding(
            get: { selected.contains(task.id) },
            set: { chosen in
                if chosen { selected.insert(task.id) } else { selected.remove(task.id) }
            })
    }

    private func open(_ task: FacetTask) {
        editor = FacetEditorSelection(
            profileID: snapshot.profileId, task: task,
            statuses: store.statuses, priorities: store.priorities)
    }
}

private struct FacetProfileSelection: Identifiable { let id: String }

private struct FacetEditorSelection: Identifiable {
    let profileID: String
    let task: FacetTask
    let statuses: [(value: String, label: String)]
    let priorities: [(value: String, label: String)]
    var id: String { profileID + ":" + task.id }
}

private struct FacetBulkSelection: Identifiable {
    let profileID: String
    let tasks: [FacetTask]
    let priorities: [(value: String, label: String)]
    var id: String { profileID }
}
