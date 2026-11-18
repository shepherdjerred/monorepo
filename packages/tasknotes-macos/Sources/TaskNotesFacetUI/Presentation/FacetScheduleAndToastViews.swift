import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetSchedulePopoverView: View {
    let task: Task
    let store: FacetStore
    let close: () -> Void

    @State private var pickedDate: Date

    init(task: Task, store: FacetStore, close: @escaping () -> Void) {
        self.task = task
        self.store = store
        self.close = close
        let initial =
            task.due_date.flatMap {
                ViewerCalendar.date(fromCivil: $0, timeZone: store.calendar.timeZone)
            } ?? store.calendar.instant
        _pickedDate = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Schedule")
                .font(.headline)

            HStack(spacing: 8) {
                Button("Today") {
                    applyDate(store.calendar.today)
                }
                .accessibilityIdentifier(AccessibilityIdentifier.Schedule.shortcut("today"))

                Button("Tomorrow") {
                    applyDate(store.calendar.addingDays(1))
                }
                .accessibilityIdentifier(AccessibilityIdentifier.Schedule.shortcut("tomorrow"))

                Button("Next Week") {
                    applyDate(store.calendar.addingDays(7))
                }
                .accessibilityIdentifier(AccessibilityIdentifier.Schedule.shortcut("nextWeek"))
            }
            .buttonStyle(.bordered)

            DatePicker(
                "Due Date",
                selection: $pickedDate,
                displayedComponents: [.date]
            )
            .datePickerStyle(.graphical)
            .environment(\.timeZone, store.calendar.timeZone)
            .accessibilityIdentifier(AccessibilityIdentifier.Schedule.picker)

            HStack {
                if task.due_date != nil || task.due_datetime != nil {
                    Button("No Date", role: .destructive) {
                        store.patchTask(
                            id: task.id,
                            patch: FacetTaskPatch(dueDate: .clear, dueDatetime: .clear)
                        )
                        close()
                    }
                }
                Spacer()
                Button("Apply") {
                    let civil = ViewerCalendar.civilDateString(
                        for: pickedDate,
                        timeZone: store.calendar.timeZone
                    )
                    applyDate(civil)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(14)
        .frame(width: 290)
        .accessibilityIdentifier(AccessibilityIdentifier.Schedule.popover)
    }

    private func applyDate(_ civil: String) {
        store.patchTask(id: task.id, patch: FacetTaskPatch(dueDate: .set(civil)))
        close()
    }
}

internal struct FacetUndoToastView: View {
    let message: String
    let canUndo: Bool
    let onUndo: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Text(message)
                .font(.subheadline)
                .lineLimit(1)
            if canUndo {
                Button("Undo", action: onUndo)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss notice")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: .capsule)
        .shadow(radius: 8, y: 4)
    }
}
