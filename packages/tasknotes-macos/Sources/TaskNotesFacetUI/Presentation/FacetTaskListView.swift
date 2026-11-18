import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetFlatListSpec {
    let heading: String
    let subtitle: String
    let tasks: [Task]
    let showProjectBadge: Bool
    var allowInlineCompose: Bool = true
    let emptyTitle: String
    let emptyMessage: String
}

internal struct FacetGroupedListSpec {
    let heading: String?
    let subtitle: String?
    let groups: [FacetTaskGroup]
    let showProjectBadge: Bool
    let showWeekStrip: Bool
    let projectIdForSections: String?
    let emptyTitle: String
    let emptyMessage: String
}

internal struct FacetTaskListView: View {
    let store: FacetStore
    let onSelectTask: (Task) -> Void
    let onPresentModal: (FacetPresentedEntityModal) -> Void

    @State private var inlineComposeText = ""

    var body: some View {
        VStack(spacing: 0) {
            FacetSyncStatusBanners(store: store)

            switch store.destination {
            case .board:
                boardHeader(title: "Priority Board", subtitle: "Drag tasks across P1–P4")
                FacetKanbanBoardView(
                    columns: store.priorityBoardColumns,
                    projectId: nil,
                    store: store,
                    onSelectTask: onSelectTask,
                    onAddSection: nil
                )
            case .project(let projectId) where store.layout(forProject: projectId) == .board:
                FacetProjectHeaderBar(
                    projectId: projectId,
                    store: store,
                    onPresentModal: onPresentModal
                )
                FacetKanbanBoardView(
                    columns: store.boardColumns(forProject: projectId),
                    projectId: projectId,
                    store: store,
                    onSelectTask: onSelectTask,
                    onAddSection: { targetProj in
                        onPresentModal(.addSection(projectId: targetProj))
                    }
                )
            case .section(let section):
                sectionListContent(section)
            case .project(let projectId):
                FacetProjectHeaderBar(
                    projectId: projectId,
                    store: store,
                    onPresentModal: onPresentModal
                )
                groupedListContent(
                    FacetGroupedListSpec(
                        heading: nil,
                        subtitle: nil,
                        groups: store.projectTaskGroups(projectId: projectId),
                        showProjectBadge: false,
                        showWeekStrip: false,
                        projectIdForSections: projectId,
                        emptyTitle: "This project has no open tasks",
                        emptyMessage: "Add a task or create sections to organize this project."
                    )
                )
            case .label(let labelId):
                flatListContent(
                    FacetFlatListSpec(
                        heading: store.destinationTitle,
                        subtitle: "Tagged tasks",
                        tasks: store.tasks(forLabel: labelId),
                        showProjectBadge: true,
                        emptyTitle: "No tasks with this label",
                        emptyMessage: "Tag any task with \(store.destinationTitle) to see it here."
                    )
                )
            case .filter(let filterId):
                let filterObj = store.filter(for: filterId)
                flatListContent(
                    FacetFlatListSpec(
                        heading: filterObj?.name ?? "Filter",
                        subtitle: filterObj?.query ?? "",
                        tasks: store.tasks(forFilter: filterId),
                        showProjectBadge: true,
                        emptyTitle: "No matching tasks",
                        emptyMessage: "No open tasks currently match this filter query."
                    )
                )
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.detail(store.destination))
    }

    @ViewBuilder
    private func sectionListContent(_ section: FacetSection) -> some View {
        switch section {
        case .inbox:
            flatListContent(inboxSpec)
        case .today:
            groupedListContent(todaySpec)
        case .upcoming:
            groupedListContent(upcomingSpec)
        case .completed:
            flatListContent(completedSpec)
        }
    }
}

extension FacetTaskListView {
    fileprivate var inboxSpec: FacetFlatListSpec {
        FacetFlatListSpec(
            heading: "Inbox",
            subtitle: "Unorganized tasks",
            tasks: store.inboxTasks,
            showProjectBadge: false,
            emptyTitle: "Your Inbox is clear",
            emptyMessage: "Capture tasks with Quick Add and organize them later."
        )
    }

    fileprivate var todaySpec: FacetGroupedListSpec {
        FacetGroupedListSpec(
            heading: "Today",
            subtitle: store.calendar.today,
            groups: store.todayGroups,
            showProjectBadge: true,
            showWeekStrip: false,
            projectIdForSections: nil,
            emptyTitle: "All clear for today",
            emptyMessage: "Enjoy your day or add a task scheduled for today."
        )
    }

    fileprivate var upcomingSpec: FacetGroupedListSpec {
        FacetGroupedListSpec(
            heading: "Upcoming",
            subtitle: "7-day schedule & beyond",
            groups: store.upcomingGroups,
            showProjectBadge: true,
            showWeekStrip: true,
            projectIdForSections: nil,
            emptyTitle: "Nothing scheduled ahead",
            emptyMessage: "Assign due dates to tasks to plan your week."
        )
    }

    fileprivate var completedSpec: FacetFlatListSpec {
        FacetFlatListSpec(
            heading: "Completed",
            subtitle: "Finished tasks",
            tasks: store.completedTasks,
            showProjectBadge: true,
            allowInlineCompose: false,
            emptyTitle: "No completed tasks yet",
            emptyMessage: "Check off a task to see your progress here."
        )
    }

    fileprivate func boardHeader(title: String, subtitle: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.title2.weight(.bold))
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }

    fileprivate func flatListContent(_ spec: FacetFlatListSpec) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                listHeadingRow(
                    heading: spec.heading,
                    subtitle: spec.subtitle,
                    count: spec.tasks.count
                )

                if spec.allowInlineCompose {
                    inlineQuickAddBar(sectionId: nil)
                }

                if spec.tasks.isEmpty {
                    emptyPlaceholder(title: spec.emptyTitle, message: spec.emptyMessage)
                } else {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(spec.tasks) { task in
                            FacetTaskRowView(
                                task: task,
                                store: store,
                                showProjectBadge: spec.showProjectBadge,
                                isSelected: store.selectedTaskId == task.id,
                                onSelect: { onSelectTask(task) }
                            )
                            Divider()
                        }
                    }
                }
            }
            .padding(20)
            #if os(iOS)
                .padding(.bottom, FacetNativeStyle.mobileListBottomMargin)
            #endif
        }
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
    }

    fileprivate func groupedListContent(_ spec: FacetGroupedListSpec) -> some View {
        let totalTasks = spec.groups.reduce(0) { $0 + $1.tasks.count }
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let heading = spec.heading {
                    listHeadingRow(
                        heading: heading,
                        subtitle: spec.subtitle ?? "",
                        count: totalTasks
                    )
                }

                if spec.showWeekStrip {
                    FacetUpcomingWeekStripView(store: store)
                }

                inlineQuickAddBar(sectionId: nil)

                if totalTasks == 0 && spec.projectIdForSections == nil {
                    emptyPlaceholder(title: spec.emptyTitle, message: spec.emptyMessage)
                } else {
                    ForEach(spec.groups) { group in
                        FacetTaskGroupSectionView(
                            group: group,
                            showProjectBadge: spec.showProjectBadge,
                            store: store,
                            onSelectTask: onSelectTask,
                            onPresentModal: onPresentModal
                        )
                    }
                }
            }
            .padding(20)
            #if os(iOS)
                .padding(.bottom, FacetNativeStyle.mobileListBottomMargin)
            #endif
        }
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
    }

    private func listHeadingRow(heading: String, subtitle: String, count: Int) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(heading)
                    .font(.title2.weight(.bold))
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("\(count)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.count)
        }
    }

    private func inlineQuickAddBar(sectionId: String?) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "plus")
                .foregroundStyle(FacetNativeStyle.brand)
            TextField(
                "Add a task… (#Project @label tomorrow p1)",
                text: $inlineComposeText
            )
            .textFieldStyle(.plain)
            .onSubmit { submitInlineTask(sectionId: sectionId) }
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.composeField)

            if !inlineComposeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button("Add") { submitInlineTask(sectionId: sectionId) }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.quinary, in: .rect(cornerRadius: 8))
    }

    private func submitInlineTask(sectionId: String?) {
        let trimmed = inlineComposeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.createQuickTask(rawInput: trimmed, overrideSectionId: sectionId)
        inlineComposeText = ""
    }

    private func emptyPlaceholder(title: String, message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.seal")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.empty)
    }
}
