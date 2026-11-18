import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetInspectorLabelsSection: View {
    let task: Task
    let store: FacetStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Labels")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            if store.activeLabels.isEmpty {
                Text("No labels yet — type @label in Quick Add or create one in the sidebar.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(store.activeLabels) { labelItem in
                            let selected = task.label_ids.contains(labelItem.id)
                            Button {
                                var updated = task.label_ids
                                if selected {
                                    updated.removeAll { $0 == labelItem.id }
                                } else {
                                    updated.append(labelItem.id)
                                }
                                store.patchTask(
                                    id: task.id,
                                    patch: FacetTaskPatch(labelIds: .set(updated))
                                )
                            } label: {
                                Text("@\(labelItem.name)")
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(
                                        selected
                                            ? FacetNativeStyle.swatchColor(labelItem.color)
                                                .opacity(0.22)
                                            : Color.secondary.opacity(0.10),
                                        in: .capsule
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.labels)
    }
}

internal struct FacetInspectorSubtasksSection: View {
    let task: Task
    let store: FacetStore

    @State private var newSubtaskTitle = ""

    var body: some View {
        let children = store.subtasks(of: task.id)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Sub-tasks")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if !children.isEmpty {
                    Text("\(children.count(where: \.completed))/\(children.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(children) { child in
                HStack(spacing: 8) {
                    Button {
                        store.toggleTaskCompletion(child)
                    } label: {
                        Image(systemName: child.completed ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(child.completed ? .green : .secondary)
                    }
                    .buttonStyle(.plain)

                    Text(child.title)
                        .font(.callout)
                        .strikethrough(child.completed)
                        .foregroundStyle(child.completed ? .secondary : .primary)

                    Spacer()

                    Button(role: .destructive) {
                        store.deleteTask(child)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 6) {
                TextField("Add sub-task…", text: $newSubtaskTitle)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.small)
                    .onSubmit { addSubtask() }
                Button("Add") { addSubtask() }
                    .controlSize(.small)
                    .disabled(
                        newSubtaskTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
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

internal struct FacetInspectorRemindersSection: View {
    let task: Task
    let store: FacetStore

    @State private var reminderDate: Date

    init(task: Task, store: FacetStore) {
        self.task = task
        self.store = store
        _reminderDate = State(initialValue: store.calendar.instant.addingTimeInterval(3600))
    }

    var body: some View {
        let taskReminders = store.reminders(for: task.id)
        VStack(alignment: .leading, spacing: 8) {
            Text("Reminders")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(taskReminders) { reminder in
                HStack {
                    Image(systemName: "bell.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text(reminderSummary(reminder))
                        .font(.caption)
                    Spacer()
                    Button(role: .destructive) {
                        store.deleteReminder(id: reminder.id)
                    } label: {
                        Image(systemName: "trash")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 6) {
                DatePicker(
                    "Reminder",
                    selection: $reminderDate,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .environment(\.timeZone, store.calendar.timeZone)
                .labelsHidden()
                .controlSize(.small)

                Button("Add Reminder") {
                    let iso = ISO8601DateFormatter().string(from: reminderDate)
                    store.createReminder(
                        taskId: task.id,
                        reminderType: "absolute",
                        dueDatetime: iso
                    )
                }
                .controlSize(.small)
                .buttonStyle(.bordered)
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.reminders)
    }

    private func reminderSummary(_ reminder: Reminder) -> String {
        if let dueText = reminder.due_datetime, !dueText.isEmpty {
            return String(dueText.prefix(16)).replacingOccurrences(of: "T", with: " ")
        }
        if let offset = reminder.minute_offset {
            return "\(offset) min before due"
        }
        return reminder.reminder_type
    }
}
