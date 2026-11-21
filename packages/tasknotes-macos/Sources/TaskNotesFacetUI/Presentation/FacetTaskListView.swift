import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetTaskListView: View {
    let store: FacetStore
    let onSelectTask: (Task) -> Void
    let onPresentModal: (FacetPresentedEntityModal) -> Void

    @State private var inlineComposeText = ""
    @Environment(\.dynamicTypeSize) private var textSize
    @FocusState private var keyboardFocus: FacetTaskFocusTarget?
    @AccessibilityFocusState private var accessibilityFocus: FacetTaskFocusTarget?

    private var listFocus: FacetTaskListFocus {
        FacetTaskListFocus(keyboard: $keyboardFocus, accessibility: $accessibilityFocus)
    }

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
                        groups: store.projectTaskGroups(
                            projectId: projectId, from: store.openListPresentationTasks),
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
                        tasks: store.tasks(
                            forLabel: labelId, from: store.openListPresentationTasks),
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
                        tasks: store.tasks(forFilter: filterId, from: store.listPresentationTasks),
                        showProjectBadge: true,
                        emptyTitle: "No matching tasks",
                        emptyMessage: "No open tasks currently match this filter query."
                    )
                )
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.detail(store.destination))
        .environment(\.facetTaskListFocus, listFocus)
        #if os(macOS)
            .onChange(of: keyboardFocus) {
                guard let keyboardFocus, !store.showsInspector else { return }
                switch keyboardFocus {
                case .title(let id), .completion(let id): store.selectedTaskId = id
                case .heading: store.selectedTaskId = nil
                }
            }
        #endif
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
            subtitle: "",
            tasks: store.inboxTasks(from: store.openListPresentationTasks),
            showProjectBadge: false,
            emptyTitle: "Your Inbox is clear",
            emptyMessage: "Capture tasks with Quick Add and organize them later."
        )
    }

    fileprivate var todaySpec: FacetGroupedListSpec {
        FacetGroupedListSpec(
            heading: "Today",
            subtitle: store.calendar.instant.formatted(
                Date.FormatStyle(date: .complete, time: .omitted, timeZone: store.calendar.timeZone)
            ),
            groups: store.todayGroups(from: store.openListPresentationTasks),
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
            subtitle: "",
            groups: store.upcomingGroups(from: store.openListPresentationTasks),
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
            tasks: store.completedTasks(from: store.listPresentationTasks),
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
                    .font(.largeTitle.bold())
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
        flatList(spec).onChange(of: focusableIDs(in: spec.tasks), listFocus.preserve)
    }

    private func focusableIDs(in tasks: [Task]) -> [String] {
        tasks.compactMap { store.completionRow(for: $0.id) == nil ? $0.id : nil }
    }

    private func flatList(_ spec: FacetFlatListSpec) -> some View {
        #if os(iOS)
            List {
                listHeadingRow(
                    heading: spec.heading, subtitle: spec.subtitle, count: spec.tasks.count
                )
                .listRowSeparator(.hidden)
                if spec.tasks.isEmpty {
                    emptyPlaceholder(title: spec.emptyTitle, message: spec.emptyMessage)
                        .listRowSeparator(.hidden)
                }
                mobileRows(spec.tasks, badges: spec.showProjectBadge)
            }
            .listStyle(.plain)
            .contentMargins(.bottom, FacetNativeStyle.mobileListBottomMargin, for: .scrollContent)
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
        #else
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    listHeadingRow(
                        heading: spec.heading,
                        subtitle: spec.subtitle,
                        count: spec.tasks.count
                    )

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
                    if spec.allowInlineCompose {
                        inlineQuickAddBar(sectionId: nil)
                    }
                }
                .padding(20)
            }
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
        #endif
    }

    #if os(iOS)
        private func mobileRows(_ tasks: [Task], badges: Bool) -> some View {
            ForEach(tasks) { task in
                FacetTaskRowView(
                    task: task, store: store, showProjectBadge: badges, isSelected: false
                ) {
                    onSelectTask(task)
                }
                .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 12))
            }
        }
    #endif

    fileprivate func groupedListContent(_ spec: FacetGroupedListSpec) -> some View {
        let totalTasks = spec.groups.reduce(0) { $0 + $1.tasks.count }
        let focusable = spec.groups.flatMap { focusableIDs(in: $0.tasks) }
        #if os(iOS)
            return mobileGroupedList(spec, totalTasks: totalTasks)
                .onChange(of: focusable, listFocus.preserve)
        #else
            return desktopGroupedList(spec, totalTasks: totalTasks)
                .onChange(of: focusable, listFocus.preserve)
        #endif
    }

    #if os(iOS)
        private func mobileGroupedList(_ spec: FacetGroupedListSpec, totalTasks: Int) -> some View {
            List {
                if let heading = spec.heading {
                    listHeadingRow(
                        heading: heading, subtitle: spec.subtitle ?? "", count: totalTasks
                    )
                    .listRowSeparator(.hidden)
                }
                if spec.showWeekStrip {
                    FacetUpcomingWeekStripView(store: store).listRowSeparator(.hidden)
                }
                if totalTasks == 0 && !spec.showWeekStrip && spec.projectIdForSections == nil {
                    emptyPlaceholder(title: spec.emptyTitle, message: spec.emptyMessage)
                        .listRowSeparator(.hidden)
                } else {
                    ForEach(spec.groups) { group in
                        if group.id != "today" || spec.groups.count > 1 {
                            FacetTaskGroupHeader(
                                group: group, store: store, onPresentModal: onPresentModal
                            )
                            .listRowSeparator(.hidden)
                        }
                        mobileRows(group.tasks, badges: spec.showProjectBadge)
                    }
                }
            }
            .listStyle(.plain)
            .contentMargins(.bottom, FacetNativeStyle.mobileListBottomMargin, for: .scrollContent)
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
        }
    #else
        private func desktopGroupedList(_ spec: FacetGroupedListSpec, totalTasks: Int) -> some View
        {
            ScrollView {
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

                    if totalTasks == 0 && !spec.showWeekStrip && spec.projectIdForSections == nil {
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
                    inlineQuickAddBar(sectionId: nil)
                }
                .padding(20)
            }
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
        }
    #endif

    private func listHeadingRow(heading: String, subtitle: String, count: Int) -> some View {
        let stacked = textSize.isAccessibilitySize
        let layout =
            stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        return layout {
            VStack(alignment: .leading, spacing: 2) {
                Text(heading)
                    .font(.title2.weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                    .focusable()
                    .modifier(FacetTaskFocus(target: .heading))
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.primary.opacity(0.72))
                }
            }
            if !stacked { Spacer() }
            Text(count == 1 ? "1 task" : "\(count) tasks")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.primary.opacity(0.72))
                .fixedSize(horizontal: true, vertical: true)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.count)
        }
    }

    private func inlineQuickAddBar(sectionId: String?) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "plus")
                .foregroundStyle(FacetNativeStyle.brand)
            TextField(
                "Add task",
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
