import Foundation
import SwiftUI
import TaskNotesKit

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

internal struct FacetColorSwatch: Identifiable {
    let name: String
    let label: String
    let color: Color

    var id: String { name }
}

internal enum FacetNativeStyle {
    static let tokens = FacetPresentationTokens.shared
    static let mobileCaptureDiameter: CGFloat = 56
    static let mobileCapturePadding: CGFloat = 20
    static let mobileCaptureClearance: CGFloat = 20

    static var mobileListBottomMargin: CGFloat {
        mobileCaptureDiameter + mobileCapturePadding + mobileCaptureClearance
    }

    static var brand: Color {
        #if os(iOS)
            .indigo
        #else
            .accentColor
        #endif
    }

    static let colorSwatches: [FacetColorSwatch] = [
        FacetColorSwatch(
            name: "charcoal",
            label: "Charcoal",
            color: Color(.sRGB, red: 0.50, green: 0.50, blue: 0.52, opacity: 1)
        ),
        FacetColorSwatch(
            name: "berry_red",
            label: "Berry Red",
            color: Color(.sRGB, red: 0.72, green: 0.14, blue: 0.37, opacity: 1)
        ),
        FacetColorSwatch(
            name: "red",
            label: "Red",
            color: Color(.sRGB, red: 0.86, green: 0.25, blue: 0.21, opacity: 1)
        ),
        FacetColorSwatch(
            name: "orange",
            label: "Orange",
            color: Color(.sRGB, red: 0.95, green: 0.52, blue: 0.15, opacity: 1)
        ),
        FacetColorSwatch(
            name: "yellow",
            label: "Yellow",
            color: Color(.sRGB, red: 0.92, green: 0.73, blue: 0.08, opacity: 1)
        ),
        FacetColorSwatch(
            name: "green",
            label: "Green",
            color: Color(.sRGB, red: 0.16, green: 0.65, blue: 0.33, opacity: 1)
        ),
        FacetColorSwatch(
            name: "teal",
            label: "Teal",
            color: Color(.sRGB, red: 0.08, green: 0.62, blue: 0.64, opacity: 1)
        ),
        FacetColorSwatch(
            name: "blue",
            label: "Blue",
            color: Color(.sRGB, red: 0.16, green: 0.45, blue: 0.88, opacity: 1)
        ),
        FacetColorSwatch(
            name: "grape",
            label: "Grape",
            color: Color(.sRGB, red: 0.53, green: 0.30, blue: 0.85, opacity: 1)
        ),
        FacetColorSwatch(
            name: "magenta",
            label: "Magenta",
            color: Color(.sRGB, red: 0.88, green: 0.32, blue: 0.60, opacity: 1)
        ),
        FacetColorSwatch(
            name: "salmon",
            label: "Salmon",
            color: Color(.sRGB, red: 0.96, green: 0.51, blue: 0.48, opacity: 1)
        ),
        FacetColorSwatch(
            name: "grey",
            label: "Grey",
            color: Color(.sRGB, red: 0.58, green: 0.60, blue: 0.63, opacity: 1)
        ),
    ]

    static func swatchColor(_ rawName: String?) -> Color {
        guard let rawName, !rawName.isEmpty else {
            return .secondary
        }
        let lower = rawName.lowercased()
        if let match = colorSwatches.first(where: { $0.name == lower }) {
            return match.color
        }
        if let parsed = FacetConfiguredColor(rawName) {
            return Color(
                .sRGB,
                red: parsed.red,
                green: parsed.green,
                blue: parsed.blue,
                opacity: parsed.alpha
            )
        }
        return .secondary
    }

    static func priorityColor(_ priority: Priority) -> Color {
        switch priority {
        case .p1: .red
        case .p2: .orange
        case .p3: .blue
        case .p4: .secondary
        }
    }

    static func priorityTitle(_ priority: Priority) -> String {
        switch priority {
        case .p1: "P1"
        case .p2: "P2"
        case .p3: "P3"
        case .p4: "P4"
        }
    }

    static func priorityFullTitle(_ priority: Priority) -> String {
        switch priority {
        case .p1: "Priority 1"
        case .p2: "Priority 2"
        case .p3: "Priority 3"
        case .p4: "Priority 4"
        }
    }
}

internal struct FacetTaskRowView: View {
    let task: Task
    let store: FacetStore
    let showProjectBadge: Bool
    let isSelected: Bool
    let onSelect: () -> Void

    @State private var hovering = false
    @State private var showingSchedulePopover = false
    @State private var completionPulse: String?
    @Environment(\.accessibilityReduceMotion) private var reducedMotion

    var body: some View {
        let receipt = store.completionReceipts[task.id]
        HStack(alignment: .top, spacing: 10) {
            Button {
                store.toggleTaskCompletion(task)
            } label: {
                checkbox(receipt: receipt)
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
            .accessibilityLabel(task.completed ? "Reopen \(task.title)" : "Complete \(task.title)")
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowToggle(task.id))

            rowMainButton
            trailingActions
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 6)
        .background(
            isSelected ? Color.accentColor.opacity(0.12) : Color.clear,
            in: .rect(cornerRadius: 8)
        )
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onChange(of: receipt) {
            if let receipt { completionPulse = receipt }
        }
        .contextMenu { rowContextMenu }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.row(task.id))
    }

    private var rowMainButton: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(task.title)
                        .font(.body)
                        .strikethrough(task.completed)
                        .foregroundStyle(task.completed ? .secondary : .primary)
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
            .frame(maxWidth: .infinity, alignment: .leading)
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
            Menu {
                rowContextMenu
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 36, minHeight: 36)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Actions for \(task.title)")
        #endif
    }

    @ViewBuilder
    private var rowContextMenu: some View {
        Button(task.completed ? "Reopen" : "Complete") {
            store.toggleTaskCompletion(task)
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
        Button("Schedule Today") {
            store.patchTask(id: task.id, patch: FacetTaskPatch(dueDate: .set(store.calendar.today)))
        }
        Button("Schedule Tomorrow") {
            store.patchTask(
                id: task.id,
                patch: FacetTaskPatch(dueDate: .set(store.calendar.addingDays(1)))
            )
        }
        if task.due_date != nil || task.due_datetime != nil {
            Button("Clear Due Date") {
                store.patchTask(
                    id: task.id,
                    patch: FacetTaskPatch(dueDate: .clear, dueDatetime: .clear)
                )
            }
        }
        Divider()
        Button("Delete Task", role: .destructive) {
            store.deleteTask(task)
        }
    }

    @ViewBuilder
    private func checkbox(receipt: String?) -> some View {
        let icon = Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 18, weight: .medium))
            .foregroundStyle(
                task.completed ? .green : FacetNativeStyle.priorityColor(task.priority)
            )
        if reducedMotion || receipt == nil {
            icon
        } else {
            icon.phaseAnimator(
                [1.0, FacetNativeStyle.tokens.motion.checkboxSpring.peakScale, 1.0],
                trigger: completionPulse
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

    @ViewBuilder
    private var metadataRow: some View {
        let dueCivil = store.calendar.effectiveCivilDay(
            dueDate: task.due_date,
            dueDatetime: task.due_datetime
        )
        let subtaskList = store.subtasks(of: task.id)
        let taskLabels = task.label_ids.compactMap { store.label(for: $0) }
        let projectObj = showProjectBadge ? store.project(for: task.project_id) : nil

        if dueCivil != nil || task.is_recurring || !subtaskList.isEmpty || !taskLabels.isEmpty
            || projectObj != nil
        {
            HStack(spacing: 8) {
                dueMetadataItem(dueCivil: dueCivil)
                subtasksMetadataItem(subtaskList: subtaskList)
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
        return civil
    }
}
