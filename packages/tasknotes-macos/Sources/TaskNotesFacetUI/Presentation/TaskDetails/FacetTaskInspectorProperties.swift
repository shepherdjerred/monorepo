import Foundation
import SwiftUI
import TaskNotesKit

extension FacetTaskInspectorView {
    var priorityChip: some View {
        Menu {
            Picker(
                "Priority",
                selection: Binding(
                    get: { task.priority },
                    set: {
                        store.patchTask(id: task.id, patch: FacetTaskPatch(priority: $0))
                    })
            ) {
                ForEach(Priority.allCases, id: \.self) { level in
                    Label(FacetNativeStyle.priorityFullTitle(level), systemImage: "flag.fill")
                        .tint(FacetNativeStyle.priorityColor(level)).tag(level)
                }
            }
        } label: {
            Label(
                task.priority == .p4
                    ? "Priority" : FacetNativeStyle.priorityFullTitle(task.priority),
                systemImage: "flag")
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.priority)
    }

    var labelsButton: some View {
        let names = task.label_ids.compactMap { store.label(for: $0)?.name }
        return Button {
            showingLabels = true
        } label: {
            Label(names.isEmpty ? "Add label" : names.joined(separator: ", "), systemImage: "tag")
                .multilineTextAlignment(.leading)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.labels)
    }
    var projectPickerRow: some View {
        propertyRow("Project") {
            Picker(
                "Project",
                selection: Binding(
                    get: {
                        task.project_id.isEmpty ? store.inboxProject?.id ?? "" : task.project_id
                    },
                    set: { newProjId in
                        store.moveTaskTrees([task.id], to: newProjId)
                    }
                )
            ) {
                if store.inboxProject == nil, task.project_id.isEmpty { Text("Inbox").tag("") }
                ForEach(store.activeProjects) { proj in
                    Text(proj.name).tag(proj.id)
                }
            }
            .labelsHidden()
            .frame(
                maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 180,
                alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing
            )
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.project)
        }
    }

    @ViewBuilder
    var sectionPickerRow: some View {
        let availableSections = store.sections(in: task.project_id)
        if !availableSections.isEmpty {
            propertyRow("Section") {
                Picker(
                    "Section",
                    selection: Binding(
                        get: { task.section_id ?? "" },
                        set: { newSecId in
                            store.moveTaskTrees(
                                [task.id], to: task.project_id,
                                sectionId: newSecId.isEmpty ? nil : newSecId)
                        }
                    )
                ) {
                    Text("No section").tag("")
                    ForEach(availableSections) { sec in
                        Text(sec.name).tag(sec.id)
                    }
                }
                .labelsHidden()
                .frame(
                    maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 180,
                    alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing
                )
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.section)
            }
        }
    }

    var priorityPickerRow: some View {
        propertyRow("Priority") {
            Picker(
                "Priority",
                selection: Binding(
                    get: { task.priority },
                    set: { newPriority in
                        store.patchTask(
                            id: task.id,
                            patch: FacetTaskPatch(priority: newPriority)
                        )
                    }
                )
            ) {
                ForEach(Priority.allCases, id: \.self) { level in
                    Text(level == .p4 ? "None" : FacetNativeStyle.priorityFullTitle(level)).tag(
                        level)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.priority)
        }
    }

    var deadlineControl: some View {
        FacetDeadlineControl(task: task, store: store)
    }

    var recurrenceRow: some View {
        Button {
            showingRecurrenceSheet = true
        } label: {
            Label(recurrenceSummary, systemImage: "repeat")
                .multilineTextAlignment(.leading)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceEdit)
    }

    var dueDateRow: some View {
        propertyRow("Date") {
            Button {
                showingSchedule = true
            } label: {
                Label(scheduleTitle, systemImage: "calendar")
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.borderless)
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.due)
            .popover(isPresented: $showingSchedule) {
                FacetSchedulePopoverView(task: task, store: store) { showingSchedule = false }
            }
        }
    }

    private var scheduleTitle: String {
        let zone = store.calendar.timeZone
        if let timestamp = task.due_datetime, let date = ViewerCalendar.parseISO8601(timestamp) {
            return date.formatted(
                Date.FormatStyle(date: .abbreviated, time: .shortened, timeZone: zone))
        }
        if let civil = task.due_date,
            let date = ViewerCalendar.date(fromCivil: civil, timeZone: zone)
        {
            return date.formatted(
                Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: zone))
        }
        return "Add date"
    }

    private func propertyRow<Content: View>(_ title: String, @ViewBuilder control: () -> Content)
        -> some View
    {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout =
            stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout())
        return layout {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            if !stacked { Spacer() }
            control()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var recurrenceSummary: String {
        guard let rule = task.recurrence_rule, !rule.isEmpty else {
            return "Add repeat"
        }
        return FacetRecurrenceCodec.summary(for: rule)
    }
}
