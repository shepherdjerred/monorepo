import Foundation
import SwiftUI
import TaskNotesKit

extension FacetStore {
    /// Keep timed tasks at their existing wall-clock time when the viewer chooses another day.
    internal func reschedule(_ task: Task, to civil: String?) {
        var patch = FacetTaskPatch(
            dueDate: .clear, dueDatetime: .clear, dueTimezone: .clear, dueString: .clear)
        if let civil {
            patch.dueDate = .set(civil)
            patch.dueTimezone = .unchanged
            if let timestamp = task.due_datetime,
                let instant = ViewerCalendar.parseISO8601(timestamp)
            {
                let zone =
                    task.due_timezone.flatMap(TimeZone.init(identifier:)) ?? calendar.timeZone
                var local = calendar.gregorianCalendar
                local.timeZone = zone
                let viewer = calendar.gregorianCalendar
                guard let day = ViewerCalendar.date(fromCivil: civil, timeZone: calendar.timeZone),
                    let offset = viewer.dateComponents(
                        [.day], from: viewer.startOfDay(for: instant), to: day
                    ).day,
                    let shifted = local.date(byAdding: .day, value: offset, to: instant),
                    let correction = viewer.dateComponents(
                        [.day], from: viewer.startOfDay(for: shifted), to: day
                    ).day,
                    let moved = local.date(byAdding: .day, value: correction, to: shifted)
                else { return }
                patch.dueDate = .set(ViewerCalendar.civilDateString(for: moved, timeZone: zone))
                patch.dueDatetime = .set(moved.ISO8601Format())
            }
        }
        patchTask(id: task.id, patch: patch)
    }
}

internal struct FacetSchedulePopoverView: View {
    let task: Task
    let store: FacetStore
    let close: () -> Void

    @Environment(\.dynamicTypeSize) private var textSize
    @State private var pickedDate: Date

    init(task: Task, store: FacetStore, close: @escaping () -> Void) {
        self.task = task
        self.store = store
        self.close = close
        let initial =
            store.calendar.effectiveCivilDay(dueDate: task.due_date, dueDatetime: task.due_datetime)
            .flatMap {
                ViewerCalendar.date(fromCivil: $0, timeZone: store.calendar.timeZone)
            } ?? store.calendar.instant
        _pickedDate = State(initialValue: initial)
    }

    var body: some View {
        Group {
            #if os(iOS)
                NavigationStack {
                    VStack(spacing: 0) {
                        ScrollView {
                            scheduleContent
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .scrollBounceBehavior(.basedOnSize)
                        actions.padding(14)
                    }
                    .frame(maxWidth: 420)
                    .navigationTitle("Schedule")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel", systemImage: "xmark", action: close)
                        }
                    }
                }
                .presentationDetents(
                    textSize.isAccessibilitySize ? [.large] : [.height(610), .large])
            #else
                VStack(alignment: .leading, spacing: 10) {
                    Text("Schedule").font(.headline)
                    scheduleContent
                    actions
                }
                .padding(14)
                .frame(width: 290)
            #endif
        }
        .tint(FacetNativeStyle.brand)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.Schedule.popover)
    }

    private var scheduleContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { shortcuts }
                    .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 8) { shortcuts }
            }
            .buttonStyle(.bordered)
            .foregroundStyle(.primary)

            Group {
                #if os(iOS)
                    if textSize.isAccessibilitySize {
                        datePicker.labelsHidden().datePickerStyle(.compact)
                    } else {
                        datePicker.datePickerStyle(.graphical)
                    }
                #else
                    datePicker.datePickerStyle(.graphical)
                #endif
            }
        }
    }

    private var datePicker: some View {
        DatePicker("Due Date", selection: $pickedDate, displayedComponents: [.date])
            .environment(\.timeZone, store.calendar.timeZone)
            .accessibilityIdentifier(AccessibilityIdentifier.Schedule.picker)
    }

    @ViewBuilder
    private var shortcuts: some View {
        Button("Today") { applyDate(store.calendar.today) }
            .accessibilityIdentifier(AccessibilityIdentifier.Schedule.shortcut("today"))
        Button("Tomorrow") { applyDate(store.calendar.addingDays(1)) }
            .accessibilityIdentifier(AccessibilityIdentifier.Schedule.shortcut("tomorrow"))
        Button("Next Week") { applyDate(store.calendar.addingDays(7)) }
            .accessibilityIdentifier(AccessibilityIdentifier.Schedule.shortcut("nextWeek"))
    }

    @ViewBuilder
    private var actions: some View {
        if textSize.isAccessibilitySize {
            VStack(spacing: 8) {
                clearButton
                applyButton
            }
        } else {
            HStack {
                clearButton
                Spacer()
                applyButton
            }
        }
    }

    @ViewBuilder
    private var clearButton: some View {
        if task.due_date != nil || task.due_datetime != nil {
            Button(role: .destructive) {
                store.reschedule(task, to: nil)
                close()
            } label: {
                actionLabel("No Date")
            }
        }
    }

    private var applyButton: some View {
        Button {
            let civil = ViewerCalendar.civilDateString(
                for: pickedDate,
                timeZone: store.calendar.timeZone
            )
            applyDate(civil)
        } label: {
            actionLabel("Apply")
        }
        .buttonStyle(.borderedProminent)
    }

    private func actionLabel(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .frame(maxWidth: textSize.isAccessibilitySize ? .infinity : nil)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, textSize.isAccessibilitySize ? 4 : 0)
    }

    private func applyDate(_ civil: String) {
        store.reschedule(task, to: civil)
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
