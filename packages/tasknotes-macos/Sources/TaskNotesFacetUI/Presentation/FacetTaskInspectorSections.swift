import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetInspectorLabelsSection: View {
    let task: Task
    let store: FacetStore

    @Environment(\.dismiss) private var dismiss
    @State private var draftName = ""

    private var name: String {
        draftName.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.activeLabels) { item in
                    Toggle(
                        item.name,
                        isOn: Binding(
                            get: { store.task(for: task.id)?.label_ids.contains(item.id) == true },
                            set: { selected in setLabel(item.id, selected: selected) }
                        ))
                }
                HStack {
                    TextField("New label", text: $draftName)
                        .onSubmit(addLabel)
                    Button("Add", action: addLabel)
                        .disabled(name.isEmpty)
                }
            }
            .navigationTitle("Labels")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 320, minHeight: 240)
        #endif
    }

    private func setLabel(_ id: String, selected: Bool) {
        guard let current = store.task(for: task.id), current.label_ids.contains(id) != selected
        else { return }
        let updated = selected ? current.label_ids + [id] : current.label_ids.filter { $0 != id }
        store.patchTask(id: current.id, patch: FacetTaskPatch(labelIds: .set(updated)))
    }

    private func addLabel() {
        guard !name.isEmpty, store.task(for: task.id) != nil else { return }
        let item =
            store.activeLabels.first {
                $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame
            }
            ?? store.createLabel(name: name, color: "teal", isFavorite: false)
        setLabel(item.id, selected: true)
        draftName = ""
    }
}

internal struct FacetInspectorSubtasksSection: View {
    let task: Task
    let store: FacetStore

    @State private var newSubtaskTitle = ""
    @State private var openedSubtask: Task?
    @FocusState private var editingTitle: Bool

    var body: some View {
        let children = store.subtasks(of: task.id)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(children) { child in
                HStack(spacing: 8) {
                    Button {
                        store.toggleTaskCompletion(child)
                    } label: {
                        Image(systemName: child.completed ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(child.completed ? .green : .secondary)
                            #if os(iOS)
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                            #endif
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        child.completed ? "Reopen \(child.title)" : "Complete \(child.title)")

                    Button {
                        openedSubtask = child
                    } label: {
                        Text(child.title)
                            .font(.callout)
                            .strikethrough(child.completed)
                            .multilineTextAlignment(.leading)
                            .foregroundStyle(child.completed ? .secondary : .primary)
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    Button(role: .destructive) {
                        store.deleteTask(child)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            #if os(iOS)
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                            #endif
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Delete \(child.title)")
                }
            }

            HStack(spacing: 6) {
                TextField("Add subtask", text: $newSubtaskTitle)
                    .textFieldStyle(.roundedBorder)
                    .focused($editingTitle)
                    .controlSize(.small)
                    .onSubmit { addSubtask() }
                Button("Add") { addSubtask() }
                    .controlSize(.small)
                    .disabled(
                        newSubtaskTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
            }
        }
        .onAppear { if children.isEmpty { editingTitle = true } }
        .sheet(item: $openedSubtask) { selected in
            if let current = store.task(for: selected.id) {
                NavigationStack {
                    FacetTaskInspectorView(task: current, store: store) { openedSubtask = nil }
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { openedSubtask = nil }
                                    .keyboardShortcut(.cancelAction)
                            }
                        }
                }
                #if os(macOS)
                    .frame(minWidth: 420, idealWidth: 740, minHeight: 360, idealHeight: 520)
                #endif
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.subtasks)
    }

    private func addSubtask() {
        let trimmed = newSubtaskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.createSubtask(parentTask: task, title: trimmed)
        newSubtaskTitle = ""
    }
}
