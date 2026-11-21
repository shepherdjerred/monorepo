import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetTaskRowView: View {
    let task: Task
    let store: FacetStore
    let showProjectBadge: Bool
    let isSelected: Bool
    let onSelect: () -> Void

    @State private var hovering = false
    @State private var showingSchedulePopover = false
    @Environment(\.accessibilityReduceMotion) private var reducedMotion

    var body: some View {
        let receipt = store.completionRow(for: task.id)
        HStack(alignment: .top, spacing: 10) {
            Button {
                toggleCompletion()
            } label: {
                checkbox
                    #if os(iOS)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                    #endif
            }
            .buttonStyle(.plain)
            .modifier(FacetTaskFocus(target: .completion(task.id)))
            .padding(.top, 2)
            .accessibilityLabel(isChecked ? "Reopen \(task.title)" : "Complete \(task.title)")
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowToggle(task.id))

            rowMainButton
                .modifier(FacetTaskFocus(target: .title(task.id)))
                #if os(macOS)
                    .onKeyPress(.return) {
                        onSelect()
                        return .handled
                    }
                #endif
            #if os(macOS)
                trailingActions
            #endif
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 6)
        .background(
            isSelected ? FacetNativeStyle.brand.opacity(0.12) : Color.clear,
            in: .rect(cornerRadius: 8)
        )
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .allowsHitTesting(receipt == nil)
        .contextMenu { rowContextMenu }
        #if os(iOS)
            .swipeActions(edge: .leading) {
                Button(task.completed ? "Reopen" : "Complete", systemImage: "checkmark") {
                    toggleCompletion()
                }.tint(.green)
            }
            .swipeActions(edge: .trailing) {
                Button("Schedule", systemImage: "calendar") { showingSchedulePopover = true }
                .tint(FacetNativeStyle.brand)
            }
            .sheet(isPresented: $showingSchedulePopover) {
                FacetSchedulePopoverView(task: task, store: store) {
                    showingSchedulePopover = false
                }
            }
        #endif
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.row(task.id))
    }

    private func toggleCompletion() {
        store.toggleTaskCompletion(task, animateListRemoval: !reducedMotion)
    }

    private var isChecked: Bool {
        store.completionRow(for: task.id).map { !$0.previous.completed } ?? task.completed
    }

    private var rowMainButton: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(task.title)
                        .font(.body)
                        .strikethrough(isChecked)
                        .foregroundStyle(isChecked ? .secondary : .primary)
                        .multilineTextAlignment(.leading)

                    if task.priority != .p4 {
                        Text(FacetNativeStyle.priorityTitle(task.priority))
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(
                                FacetNativeStyle.priorityColor(task.priority).opacity(0.15),
                                in: .capsule
                            )
                            .foregroundStyle(FacetNativeStyle.priorityColor(task.priority))
                    }
                }

                if !task.description.isEmpty {
                    Text(task.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                metadataRow
            }
            #if os(iOS)
                .frame(minHeight: 44, alignment: .center)
            #endif
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var trailingActions: some View {
        #if os(macOS)
            HStack(spacing: 4) {
                Button {
                    showingSchedulePopover = true
                } label: {
                    Image(systemName: "calendar")
                }
                .help("Schedule")
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowSchedule(task.id))
                .popover(isPresented: $showingSchedulePopover) {
                    FacetSchedulePopoverView(task: task, store: store) {
                        showingSchedulePopover = false
                    }
                }

                Button(role: .destructive) {
                    store.deleteTask(task)
                } label: {
                    Image(systemName: "trash")
                }
                .help("Delete task")
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowDelete(task.id))
            }
            .buttonStyle(.borderless)
            .opacity(hovering || isSelected ? 1 : 0)
        #else
            EmptyView()
        #endif
    }

    @ViewBuilder
    private var rowContextMenu: some View {
        Button(task.completed ? "Reopen" : "Complete") {
            toggleCompletion()
        }
        Button("Edit Details…", action: onSelect)
        Divider()
        Menu("Priority") {
            ForEach(Priority.allCases, id: \.self) { level in
                Button(FacetNativeStyle.priorityFullTitle(level)) {
                    store.patchTask(id: task.id, patch: FacetTaskPatch(priority: level))
                }
            }
        }
        Button("Schedule…") { showingSchedulePopover = true }
        if task.due_date != nil || task.due_datetime != nil {
            Button("Clear Due Date") { store.reschedule(task, to: nil) }
        }
        Divider()
        Button("Delete Task", role: .destructive) {
            store.deleteTask(task)
        }
    }

    @ViewBuilder
    private var checkbox: some View {
        let icon = Image(systemName: isChecked ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 18, weight: .medium))
            .foregroundStyle(
                isChecked ? .green : FacetNativeStyle.priorityColor(task.priority)
            )
        if reducedMotion {
            icon
        } else {
            icon.phaseAnimator(
                [1.0, FacetNativeStyle.tokens.motion.checkboxSpring.peakScale, 1.0],
                trigger: isChecked
            ) { content, phase in
                content.scaleEffect(phase)
            } animation: { _ in
                .interpolatingSpring(
                    stiffness: FacetNativeStyle.tokens.motion.checkboxSpring.stiffness,
                    damping: FacetNativeStyle.tokens.motion.checkboxSpring.damping
                )
            }
        }
    }
}

extension FacetTaskRowView {
    @ViewBuilder
    fileprivate var metadataRow: some View {
        let dueDay = store.calendar.effectiveCivilDay(
            dueDate: task.due_date,
            dueDatetime: task.due_datetime
        )
        let dueCivil: String? =
            switch store.destination {
            case .section(.today) where dueDay == store.calendar.today: nil
            case .section(.upcoming): nil
            case .section, .board, .project, .filter, .label: dueDay
            }
        let subtaskList = store.subtasks(of: task.id)
        let commentCount = FacetTaskCommentsView.count(for: task)
        let taskLabels = task.label_ids.compactMap { store.label(for: $0) }
        let projectObj =
            showProjectBadge ? store.userProjects.first { $0.id == task.project_id } : nil

        if dueCivil != nil || task.due_datetime != nil || task.is_recurring || !subtaskList.isEmpty
            || !taskLabels.isEmpty
            || projectObj != nil || commentCount > 0 || task.deadline != nil
        {
            HStack(spacing: 8) {
                dueMetadataItem(dueCivil: dueCivil)
                if let deadline = task.deadline {
                    Label(dueBadgeLabel(for: deadline), systemImage: "flag.checkered")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Deadline \(deadline)")
                }
                if let raw = task.due_datetime, let instant = ViewerCalendar.parseISO8601(raw) {
                    Text(
                        instant.formatted(
                            Date.FormatStyle(
                                date: .omitted, time: .shortened, timeZone: store.calendar.timeZone)
                        )
                    )
                    .font(.caption).foregroundStyle(.secondary)
                }
                subtasksMetadataItem(subtaskList: subtaskList)
                if commentCount > 0 {
                    Label(String(commentCount), systemImage: "bubble.left")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(
                            commentCount == 1 ? "1 comment" : "\(commentCount) comments")
                }
                ForEach(taskLabels) { item in
                    Text("@\(item.name)")
                        .font(.caption)
                        .foregroundStyle(FacetNativeStyle.swatchColor(item.color))
                }
                if let projectObj, !projectObj.is_inbox {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(FacetNativeStyle.swatchColor(projectObj.color))
                            .frame(width: 6, height: 6)
                        Text(projectObj.name)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func dueMetadataItem(dueCivil: String?) -> some View {
        if let dueCivil {
            let isOverdue = !task.completed && dueCivil < store.calendar.today
            let dueColor: Color =
                isOverdue ? .red : (dueCivil == store.calendar.today ? .green : .secondary)
            HStack(spacing: 3) {
                Image(systemName: task.is_recurring ? "repeat" : "calendar")
                Text(dueBadgeLabel(for: dueCivil))
            }
            .font(.caption)
            .foregroundStyle(dueColor)
        } else if task.is_recurring {
            Image(systemName: "repeat")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func subtasksMetadataItem(subtaskList: [Task]) -> some View {
        if !subtaskList.isEmpty {
            let doneCount = subtaskList.count(where: \.completed)
            HStack(spacing: 3) {
                Image(systemName: "checklist")
                Text("\(doneCount)/\(subtaskList.count)")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private func dueBadgeLabel(for civil: String) -> String {
        if civil == store.calendar.today { return "Today" }
        if civil == store.calendar.addingDays(1) { return "Tomorrow" }
        if civil == store.calendar.addingDays(-1) { return "Yesterday" }
        let zone = store.calendar.timeZone
        guard let date = ViewerCalendar.date(fromCivil: civil, timeZone: zone) else { return civil }
        let style = Date.FormatStyle(timeZone: zone).month(.abbreviated).day()
        return date.formatted(
            civil.prefix(4) == store.calendar.today.prefix(4) ? style : style.year())
    }
}
