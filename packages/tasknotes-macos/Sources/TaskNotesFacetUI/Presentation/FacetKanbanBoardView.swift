import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetKanbanBoardView: View {
    let columns: [FacetBoardColumn]
    let projectId: String?
    let store: FacetStore
    let onSelectTask: (Task) -> Void
    let onAddSection: ((String) -> Void)?

    @State private var targetedColumnId: String?
    @State private var inlineComposeColumnId: String?
    @State private var inlineTitle = ""

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(columns) { column in
                    boardColumnView(column)
                }

                if let projectId, let onAddSection {
                    Button {
                        onAddSection(projectId)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "plus.rectangle.on.rectangle")
                            Text("Add section")
                        }
                        .font(.subheadline.weight(.medium))
                        .frame(width: 240, height: 48)
                        .background(.quinary, in: .rect(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Board.board)
    }

    private func boardColumnView(_ column: FacetBoardColumn) -> some View {
        let isTargeted = targetedColumnId == column.id
        return VStack(alignment: .leading, spacing: 10) {
            columnHeader(column)

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 8) {
                    columnCardsList(column)
                    if inlineComposeColumnId == column.id {
                        inlineColumnComposer(column)
                    }
                }
            }
        }
        .padding(12)
        .frame(width: 280)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(
            isTargeted ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.06),
            in: .rect(cornerRadius: 12)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    isTargeted ? Color.accentColor : Color.secondary.opacity(0.15),
                    lineWidth: isTargeted ? 2 : 1
                )
        )
        .dropDestination(for: String.self) { droppedIds, _ in
            guard let firstId = droppedIds.first else { return false }
            store.moveTaskOnBoard(taskId: firstId, to: column.target)
            return true
        } isTargeted: { hovering in
            targetedColumnId = hovering ? column.id : nil
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Board.column(column.id))
    }

    private func columnHeader(_ column: FacetBoardColumn) -> some View {
        HStack(spacing: 8) {
            if let colorName = column.color {
                Circle()
                    .fill(FacetNativeStyle.swatchColor(colorName))
                    .frame(width: 8, height: 8)
            }
            Text(column.title)
                .font(.headline)
                .lineLimit(1)
            Text("\(column.tasks.count)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(.quaternary, in: .capsule)
            Spacer()
            Button {
                inlineComposeColumnId = column.id
                inlineTitle = ""
            } label: {
                Image(systemName: "plus")
            }
            .buttonStyle(.borderless)
            .help("Add task to \(column.title)")
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Board.columnHeader(column.id))
    }

    @ViewBuilder
    private func columnCardsList(_ column: FacetBoardColumn) -> some View {
        if column.tasks.isEmpty {
            Text("Drop tasks here")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 72)
                .background(.quinary, in: .rect(cornerRadius: 8))
                .accessibilityIdentifier(AccessibilityIdentifier.Board.columnEmpty(column.id))
        } else {
            ForEach(column.tasks) { task in
                FacetKanbanCardView(
                    task: task,
                    allColumns: columns,
                    store: store,
                    onSelect: { onSelectTask(task) }
                )
            }
        }
    }

    private func inlineColumnComposer(_ column: FacetBoardColumn) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Task title", text: $inlineTitle)
                .textFieldStyle(.roundedBorder)
                .onSubmit { submitInline(to: column) }
            HStack {
                Button("Add") { submitInline(to: column) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(
                        inlineTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                Button("Cancel") { inlineComposeColumnId = nil }
                    .controlSize(.small)
            }
        }
        .padding(8)
        .background(.regularMaterial, in: .rect(cornerRadius: 8))
    }

    private func submitInline(to column: FacetBoardColumn) {
        let trimmed = inlineTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        switch column.target {
        case .projectNoSection(let projId):
            store.createQuickTask(rawInput: trimmed, overrideProjectId: projId)
        case .projectSection(let projId, let secId):
            store.createQuickTask(
                rawInput: trimmed,
                overrideProjectId: projId,
                overrideSectionId: secId
            )
        case .priority(let level):
            store.createQuickTask(rawInput: trimmed, overridePriority: level)
        }
        inlineTitle = ""
        inlineComposeColumnId = nil
    }
}

private struct FacetKanbanCardView: View {
    let task: Task
    let allColumns: [FacetBoardColumn]
    let store: FacetStore
    let onSelect: () -> Void

    var body: some View {
        let isSelected = store.selectedTaskId == task.id
        let dueCivil = store.calendar.effectiveCivilDay(
            dueDate: task.due_date,
            dueDatetime: task.due_datetime
        )

        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Button {
                    store.toggleTaskCompletion(task)
                } label: {
                    Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(
                            task.completed ? .green : FacetNativeStyle.priorityColor(task.priority)
                        )
                }
                .buttonStyle(.plain)

                Button(action: onSelect) {
                    Text(task.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }

            if !task.description.isEmpty {
                Text(task.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            HStack(spacing: 6) {
                if task.priority != .p4 {
                    Text(FacetNativeStyle.priorityTitle(task.priority))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(FacetNativeStyle.priorityColor(task.priority))
                }
                if let dueCivil {
                    HStack(spacing: 3) {
                        Image(systemName: task.is_recurring ? "repeat" : "calendar")
                        Text(dueCivil == store.calendar.today ? "Today" : dueCivil)
                    }
                    .font(.caption2)
                    .foregroundStyle(dueCivil < store.calendar.today ? .red : .secondary)
                }
                Spacer()
                if let proj = store.project(for: task.project_id), !proj.is_inbox {
                    Text(proj.name)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(10)
        .background(.background, in: .rect(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(
                    isSelected ? Color.accentColor : Color.secondary.opacity(0.18),
                    lineWidth: isSelected ? 1.5 : 1
                )
        )
        .draggable(task.id)
        .contextMenu {
            Button("Edit Details…", action: onSelect)
            Button(task.completed ? "Reopen" : "Complete") {
                store.toggleTaskCompletion(task)
            }
            Menu("Move to") {
                ForEach(allColumns) { destinationColumn in
                    Button(destinationColumn.title) {
                        store.moveTaskOnBoard(taskId: task.id, to: destinationColumn.target)
                    }
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Board.moveTo(destinationColumn.id)
                    )
                }
            }
            Divider()
            Button("Delete Task", role: .destructive) {
                store.deleteTask(task)
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Board.card(task.id))
    }
}
