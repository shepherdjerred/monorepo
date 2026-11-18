import Foundation
import SwiftUI
import TaskNotesKit

internal enum FacetPresentedEntityModal: Identifiable, Equatable {
    case addProject
    case editProject(Project)
    case addSection(projectId: String)
    case renameSection(TaskNotesKit.Section)
    case addLabel
    case addFilter

    var id: String {
        switch self {
        case .addProject: "addProject"
        case .editProject(let project): "editProject.\(project.id)"
        case .addSection(let projectId): "addSection.\(projectId)"
        case .renameSection(let section): "renameSection.\(section.id)"
        case .addLabel: "addLabel"
        case .addFilter: "addFilter"
        }
    }
}

internal struct FacetEntityModalSheet: View {
    let modal: FacetPresentedEntityModal
    let store: FacetStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch modal {
        case .addProject:
            FacetProjectFormSheet(existing: nil, store: store) { dismiss() }
        case .editProject(let project):
            FacetProjectFormSheet(existing: project, store: store) { dismiss() }
        case .addSection(let projectId):
            FacetSectionFormSheet(projectId: projectId, existing: nil, store: store) { dismiss() }
        case .renameSection(let section):
            FacetSectionFormSheet(
                projectId: section.project_id,
                existing: section,
                store: store
            ) { dismiss() }
        case .addLabel:
            FacetLabelFormSheet(store: store) { dismiss() }
        case .addFilter:
            FacetFilterFormSheet(store: store) { dismiss() }
        }
    }
}

private struct FacetProjectFormSheet: View {
    let existing: Project?
    let store: FacetStore
    let close: () -> Void

    @State private var name: String
    @State private var color: String
    @State private var isFavorite: Bool

    init(existing: Project?, store: FacetStore, close: @escaping () -> Void) {
        self.existing = existing
        self.store = store
        self.close = close
        _name = State(initialValue: existing?.name ?? "")
        _color = State(initialValue: existing?.color ?? "blue")
        _isFavorite = State(initialValue: existing?.is_favorite ?? false)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Project name", text: $name)
                FacetColorPickerRow(selectedColor: $color)
                Toggle("Add to Favorites", isOn: $isFavorite)
            }
            .formStyle(.grouped)
            .navigationTitle(existing == nil ? "New Project" : "Edit Project")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: close)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Create" : "Save") {
                        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        if let existing {
                            store.updateProject(
                                id: existing.id,
                                name: trimmed,
                                color: color,
                                isFavorite: isFavorite
                            )
                        } else {
                            let created = store.createProject(
                                name: trimmed,
                                color: color,
                                isFavorite: isFavorite
                            )
                            store.destination = .project(id: created.id)
                        }
                        close()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 260)
    }
}

private struct FacetSectionFormSheet: View {
    let projectId: String
    let existing: TaskNotesKit.Section?
    let store: FacetStore
    let close: () -> Void

    @State private var name: String

    init(
        projectId: String,
        existing: TaskNotesKit.Section?,
        store: FacetStore,
        close: @escaping () -> Void
    ) {
        self.projectId = projectId
        self.existing = existing
        self.store = store
        self.close = close
        _name = State(initialValue: existing?.name ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Section name", text: $name)
            }
            .formStyle(.grouped)
            .navigationTitle(existing == nil ? "Add Section" : "Rename Section")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: close)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Add" : "Save") {
                        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        if let existing {
                            store.renameSection(id: existing.id, name: trimmed)
                        } else {
                            store.createSection(projectId: projectId, name: trimmed)
                        }
                        close()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .frame(minWidth: 340, minHeight: 190)
    }
}

private struct FacetLabelFormSheet: View {
    let store: FacetStore
    let close: () -> Void

    @State private var name = ""
    @State private var color = "teal"
    @State private var isFavorite = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Label name (without @)", text: $name)
                FacetColorPickerRow(selectedColor: $color)
                Toggle("Add to Favorites", isOn: $isFavorite)
            }
            .formStyle(.grouped)
            .navigationTitle("New Label")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: close)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let trimmed =
                            name
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                            .replacingOccurrences(of: "@", with: "")
                        guard !trimmed.isEmpty else { return }
                        let created = store.createLabel(
                            name: trimmed,
                            color: color,
                            isFavorite: isFavorite
                        )
                        store.destination = .label(id: created.id)
                        close()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 250)
    }
}

private struct FacetFilterFormSheet: View {
    let store: FacetStore
    let close: () -> Void

    @State private var name = ""
    @State private var query = "today | overdue"
    @State private var color = "grape"
    @State private var isFavorite = false

    var body: some View {
        let previewCount = FacetFilterQueryEvaluator.filterTasks(
            store.localStore.tasks.filter { $0.parent_id == nil },
            query: query,
            projects: store.activeProjects,
            sections: store.activeSections,
            labels: store.activeLabels,
            calendar: store.calendar
        ).count

        NavigationStack {
            Form {
                TextField("Filter name", text: $name)
                TextField("Query (e.g. p1 & today, #Work | @urgent)", text: $query)
                Text("\(previewCount) matching open tasks")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                FacetColorPickerRow(selectedColor: $color)
                Toggle("Add to Favorites", isOn: $isFavorite)
            }
            .formStyle(.grouped)
            .navigationTitle("New Filter")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: close)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmedName.isEmpty, !trimmedQuery.isEmpty else { return }
                        let created = store.createFilter(
                            name: trimmedName,
                            query: trimmedQuery,
                            color: color,
                            isFavorite: isFavorite
                        )
                        store.destination = .filter(id: created.id)
                        close()
                    }
                    .disabled(
                        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                }
            }
        }
        .frame(minWidth: 380, minHeight: 300)
    }
}

private struct FacetColorPickerRow: View {
    @Binding var selectedColor: String

    var body: some View {
        Picker("Color", selection: $selectedColor) {
            ForEach(FacetNativeStyle.colorSwatches, id: \.name) { swatch in
                HStack {
                    Circle()
                        .fill(swatch.color)
                        .frame(width: 10, height: 10)
                    Text(swatch.label)
                }
                .tag(swatch.name)
            }
        }
    }
}
