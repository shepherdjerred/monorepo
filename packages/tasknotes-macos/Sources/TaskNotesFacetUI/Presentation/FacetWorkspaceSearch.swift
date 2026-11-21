import Foundation
import SwiftUI
import TaskNotesKit

extension FacetStore {
    internal func workspaceTasks(matching query: String, includeCompleted: Bool) -> [Task] {
        localStore.tasks.filter { task in
            !task.is_deleted && (includeCompleted || !task.completed)
                && (task.title.localizedStandardContains(query)
                    || task.description.localizedStandardContains(query))
        }.sorted(by: Self.sortTasks)
    }
}

@Observable
@MainActor
internal final class FacetWorkspaceSearchState {
    var input = ""
    var includeCompleted = false
    var selectedResult: String?
    var openedCollection: FacetDestination?
    var origin: FacetDestination?

    func isShowingCollection(in store: FacetStore) -> Bool {
        openedCollection.map(store.resolvedDestination) == store.destination
    }

    func selectedResultID(in store: FacetStore) -> String? {
        guard let selectedResult, let separator = selectedResult.firstIndex(of: ".") else {
            return selectedResult
        }
        let id = selectedResult[selectedResult.index(after: separator)...]
        return String(selectedResult[...separator]) + store.localStore.resolvedID(String(id))
    }
}

internal struct FacetWorkspaceSearch: View {
    let store: FacetStore
    @Bindable var session: FacetWorkspaceSearchState
    let onDestination: (FacetDestination) -> Void

    @State private var path: [String] = []
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: String?
    @AccessibilityFocusState private var accessibleResult: String?

    private var query: String { session.input.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search workspace", text: $session.input)
                        .focused($focused, equals: "query")
                        .textFieldStyle(.plain)
                        .onSubmit(openFirstResult)
                        .accessibilityIdentifier("facet.workspaceSearch.query")
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                }
                Toggle("Include completed tasks", isOn: $session.includeCompleted)
                    .font(.subheadline)
                Divider()
                if !query.isEmpty {
                    results
                } else {
                    Spacer()
                }
            }
            .padding()
            .navigationDestination(for: String.self) { id in
                if let task = store.task(for: id) {
                    FacetTaskInspectorView(task: task, store: store, onClose: { path = [] })
                        #if os(macOS)
                            .onExitCommand { path = [] }
                        #endif
                } else {
                    ContentUnavailableView("Task unavailable", systemImage: "tray")
                }
            }
            .onAppear { if session.selectedResult == nil { focused = "query" } }
            .onChange(of: query) { session.selectedResult = nil }
            .onChange(of: path) { previous, current in
                if !previous.isEmpty, current.isEmpty {
                    let result = session.selectedResultID(in: store)
                    focused = result
                    accessibleResult = result
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 520, idealWidth: 720, minHeight: 350, idealHeight: 510)
        #endif
    }

    private var matchingTasks: [Task] {
        store.workspaceTasks(matching: query, includeCompleted: session.includeCompleted)
    }

    private var matchingProjects: [Project] {
        store.activeProjects.filter { $0.name.localizedStandardContains(query) }
    }

    private var matchingLabels: [TaskNotesKit.Label] {
        store.activeLabels.filter { $0.name.localizedStandardContains(query) }
    }

    private var matchingFilters: [Filter] {
        store.activeFilters.filter { $0.name.localizedStandardContains(query) }
    }

    private func openFirstResult() {
        guard !query.isEmpty else { return }
        if let task = matchingTasks.first {
            openTask(task)
        } else if let project = matchingProjects.first {
            openCollection(project.is_inbox ? .section(.inbox) : .project(id: project.id))
        } else if let label = matchingLabels.first {
            openCollection(.label(id: label.id))
        } else if let filter = matchingFilters.first {
            openCollection(.filter(id: filter.id))
        }
    }

    private func openTask(_ task: Task) {
        session.selectedResult = "task." + task.id
        path.append(task.id)
    }

    private var results: some View {
        let tasks = matchingTasks
        let projects = matchingProjects
        let labels = matchingLabels
        let filters = matchingFilters
        return ScrollViewReader { proxy in
            List {
                if !tasks.isEmpty {
                    SwiftUI.Section("Tasks") {
                        ForEach(tasks) { task in
                            Button {
                                openTask(task)
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(task.title).strikethrough(task.completed)
                                    if let project = store.project(for: task.project_id) {
                                        Text(project.name).font(.caption).foregroundStyle(
                                            .secondary)
                                    }
                                }
                            }
                            .accessibilityLabel(task.title)
                            .accessibilityIdentifier("facet.workspaceSearch.task.\(task.id)")
                            .id("task." + task.id)
                            .focused($focused, equals: "task." + task.id)
                            .accessibilityFocused($accessibleResult, equals: "task." + task.id)
                        }
                    }
                }
                if !projects.isEmpty {
                    SwiftUI.Section("Projects") {
                        ForEach(projects) { project in
                            collectionButton(
                                project.name,
                                project.is_inbox ? .section(.inbox) : .project(id: project.id))
                        }
                    }
                }
                if !labels.isEmpty {
                    SwiftUI.Section("Labels") {
                        ForEach(labels) { label in
                            collectionButton(label.name, .label(id: label.id))
                        }
                    }
                }
                if !filters.isEmpty {
                    SwiftUI.Section("Filters") {
                        ForEach(filters) { filter in
                            collectionButton(filter.name, .filter(id: filter.id))
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            .onAppear {
                guard let id = session.selectedResultID(in: store) else { return }
                proxy.scrollTo(id)
                focused = id
                accessibleResult = id
            }
            .onChange(of: session.selectedResultID(in: store)) { oldID, newID in
                if let oldID, let newID {
                    if focused == oldID { focused = newID }
                    if accessibleResult == oldID { accessibleResult = newID }
                }
            }
            .overlay {
                if tasks.isEmpty && projects.isEmpty && labels.isEmpty && filters.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
        }
    }

    private func collectionButton(_ title: String, _ destination: FacetDestination) -> some View {
        Button(title) { openCollection(destination) }
            .id(destination.id)
            .focused($focused, equals: destination.id)
            .accessibilityFocused($accessibleResult, equals: destination.id)
    }

    private func openCollection(_ destination: FacetDestination) {
        session.selectedResult = destination.id
        session.openedCollection = destination
        session.origin = store.destination
        onDestination(destination)
    }
}
