import Foundation
public import TaskNotesKit

/// Task group displayed in segmented list views (e.g., Overdue + Today, Upcoming days, Project sections).
public struct FacetTaskGroup: Identifiable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let sectionId: String?
    public let isOverdue: Bool
    public let tasks: [Task]

    public init(
        id: String,
        title: String,
        sectionId: String? = nil,
        isOverdue: Bool = false,
        tasks: [Task]
    ) {
        self.id = id
        self.title = title
        self.sectionId = sectionId
        self.isOverdue = isOverdue
        self.tasks = tasks
    }
}

/// Column model for Todoist Kanban boards (either Project Sections or Priority P1–P4).
public struct FacetBoardColumn: Identifiable, Sendable, Equatable {
    public enum Target: Sendable, Equatable, Hashable {
        case projectNoSection(projectId: String)
        case projectSection(projectId: String, sectionId: String)
        case priority(Priority)
    }

    public let id: String
    public let title: String
    public let color: String?
    public let target: Target
    public let tasks: [Task]

    public init(
        id: String,
        title: String,
        color: String? = nil,
        target: Target,
        tasks: [Task]
    ) {
        self.id = id
        self.title = title
        self.color = color
        self.target = target
        self.tasks = tasks
    }
}

/// Upcoming day entry in the 7-day Todoist week strip.
public struct FacetUpcomingDaySlot: Identifiable, Sendable, Equatable {
    public let offset: Int
    public let civilDate: String
    public let weekdayShort: String
    public let dayNumber: String
    public let taskCount: Int

    public var id: Int { offset }
}

struct PriorityBoardSpec {
    let priority: Priority
    let title: String
    let color: String
}

extension FacetStore {
    // MARK: - Active Entities

    public var activeProjects: [Project] {
        localStore.projects
            .filter { !$0.is_deleted && !$0.is_archived }
            .sorted { lhs, rhs in
                if lhs.is_inbox != rhs.is_inbox { return lhs.is_inbox }
                if lhs.child_order != rhs.child_order { return lhs.child_order < rhs.child_order }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
    }

    public var userProjects: [Project] { activeProjects.filter { !$0.is_inbox } }
    public var favoriteProjects: [Project] { userProjects.filter(\.is_favorite) }
    public var inboxProject: Project? { activeProjects.first(where: \.is_inbox) }

    public var activeSections: [TaskNotesKit.Section] {
        localStore.sections
            .filter { !$0.is_deleted && !$0.is_archived }
            .sorted { $0.section_order < $1.section_order }
    }

    public var activeLabels: [TaskNotesKit.Label] {
        localStore.labels
            .filter { !$0.is_deleted }
            .sorted { $0.item_order < $1.item_order }
    }

    public var activeFilters: [Filter] {
        localStore.filters
            .filter { !$0.is_deleted }
            .sorted { $0.item_order < $1.item_order }
    }

    public var favoriteFilters: [Filter] { activeFilters.filter(\.is_favorite) }
    public var favoriteLabels: [TaskNotesKit.Label] { activeLabels.filter(\.is_favorite) }

    public func project(for id: String) -> Project? {
        localStore.projects.first { $0.id == id && !$0.is_deleted }
    }

    public func section(for id: String) -> TaskNotesKit.Section? {
        localStore.sections.first { $0.id == id && !$0.is_deleted }
    }

    public func label(for id: String) -> TaskNotesKit.Label? {
        localStore.labels.first { $0.id == id && !$0.is_deleted }
    }

    public func filter(for id: String) -> Filter? {
        localStore.filters.first { $0.id == id && !$0.is_deleted }
    }

    public func task(for id: String) -> Task? {
        localStore.tasks.first { $0.id == id && !$0.is_deleted }
    }

    public func sections(in projectId: String) -> [TaskNotesKit.Section] {
        activeSections.filter { $0.project_id == projectId }
    }

    public func subtasks(of parentId: String) -> [Task] {
        localStore.tasks
            .filter { !$0.is_deleted && $0.parent_id == parentId }
            .sorted(by: Self.sortTasks)
    }

    public func reminders(for taskId: String) -> [Reminder] {
        localStore.reminders
            .filter { !$0.is_deleted && $0.task_id == taskId }
            .sorted { ($0.due_datetime ?? "") < ($1.due_datetime ?? "") }
    }

    // MARK: - Counts & Badges

    public var inboxCount: Int { inboxTasks.count }

    public var todayCount: Int {
        let todayKey = calendar.today
        return topLevelOpenTasks.count { task in
            guard
                let dueKey = calendar.effectiveCivilDay(
                    dueDate: task.due_date,
                    dueDatetime: task.due_datetime
                )
            else { return false }
            return dueKey <= todayKey
        }
    }

    public func openTaskCount(inProject projectId: String) -> Int {
        topLevelOpenTasks.count { $0.project_id == projectId }
    }

    // MARK: - Destination Queries

    public var destinationTitle: String {
        switch destination {
        case .section(let section):
            return section.title
        case .board:
            return "Board"
        case .project(let projectId):
            return project(for: projectId)?.name ?? "Project"
        case .label(let labelId):
            if let found = label(for: labelId) {
                return "@\(found.name)"
            }
            return "Label"
        case .filter(let filterId):
            return filter(for: filterId)?.name ?? "Filter"
        }
    }

    public func layout(forProject projectId: String) -> FacetProjectLayout {
        projectLayouts[projectId] ?? .list
    }

    public func setLayout(_ layout: FacetProjectLayout, forProject projectId: String) {
        projectLayouts[projectId] = layout
    }

    internal var topLevelOpenTasks: [Task] {
        localStore.tasks.filter { !$0.is_deleted && !$0.completed && $0.parent_id == nil }
    }

    public var inboxTasks: [Task] {
        let inboxIds = Set(activeProjects.filter(\.is_inbox).map(\.id))
        return
            topLevelOpenTasks
            .filter { task in
                inboxIds.isEmpty
                    ? task.project_id.isEmpty
                    : (inboxIds.contains(task.project_id) || task.project_id.isEmpty)
            }
            .filter(matchesSearch)
            .sorted(by: Self.sortTasks)
    }

    public var todayGroups: [FacetTaskGroup] {
        let todayKey = calendar.today
        var overdue: [Task] = []
        var dueToday: [Task] = []
        for task in topLevelOpenTasks where matchesSearch(task) {
            guard
                let dueKey = calendar.effectiveCivilDay(
                    dueDate: task.due_date,
                    dueDatetime: task.due_datetime
                )
            else { continue }
            if dueKey < todayKey {
                overdue.append(task)
            } else if dueKey == todayKey {
                dueToday.append(task)
            }
        }
        var groups: [FacetTaskGroup] = []
        if !overdue.isEmpty {
            groups.append(
                FacetTaskGroup(
                    id: "overdue",
                    title: "Overdue",
                    isOverdue: true,
                    tasks: overdue.sorted(by: Self.sortByDueThenOrder)
                )
            )
        }
        groups.append(
            FacetTaskGroup(
                id: "today",
                title: "Today · \(todayKey)",
                tasks: dueToday.sorted(by: Self.sortTasks)
            )
        )
        return groups
    }

    public var upcomingWeekSlots: [FacetUpcomingDaySlot] {
        var slots: [FacetUpcomingDaySlot] = []
        let gregorian = calendar.gregorianCalendar
        let start = gregorian.startOfDay(for: calendar.instant)
        let weekdayFormatter = DateFormatter()
        weekdayFormatter.calendar = gregorian
        weekdayFormatter.timeZone = calendar.timeZone
        weekdayFormatter.locale = Locale(identifier: "en_US_POSIX")
        weekdayFormatter.dateFormat = "EEE"

        for offset in 0..<7 {
            guard let day = gregorian.date(byAdding: .day, value: offset, to: start) else {
                continue
            }
            let civil = ViewerCalendar.civilDateString(for: day, timeZone: calendar.timeZone)
            let dayNum = String(gregorian.component(.day, from: day))
            let count = topLevelOpenTasks.count { task in
                calendar.effectiveCivilDay(
                    dueDate: task.due_date,
                    dueDatetime: task.due_datetime
                ) == civil
            }
            slots.append(
                FacetUpcomingDaySlot(
                    offset: offset,
                    civilDate: civil,
                    weekdayShort: weekdayFormatter.string(from: day),
                    dayNumber: dayNum,
                    taskCount: count
                )
            )
        }
        return slots
    }

    public var upcomingGroups: [FacetTaskGroup] {
        let startCivil = calendar.addingDays(upcomingSelectedDayOffset)
        var byDate: [String: [Task]] = [:]
        for task in topLevelOpenTasks where matchesSearch(task) {
            guard
                let dueKey = calendar.effectiveCivilDay(
                    dueDate: task.due_date,
                    dueDatetime: task.due_datetime
                ), dueKey >= startCivil
            else { continue }
            byDate[dueKey, default: []].append(task)
        }
        return byDate.keys.sorted().map { civil in
            FacetTaskGroup(
                id: "upcoming.\(civil)",
                title: humanDateHeading(for: civil),
                tasks: (byDate[civil] ?? []).sorted(by: Self.sortTasks)
            )
        }
    }

    public var completedTasks: [Task] {
        localStore.tasks
            .filter { !$0.is_deleted && $0.completed && $0.parent_id == nil }
            .filter(matchesSearch)
            .sorted { ($0.completed_at ?? $0.updated_at) > ($1.completed_at ?? $1.updated_at) }
    }

    public func projectTaskGroups(projectId: String) -> [FacetTaskGroup] {
        let projectTasks =
            topLevelOpenTasks
            .filter { $0.project_id == projectId }
            .filter(matchesSearch)
            .sorted(by: Self.sortTasks)
        let projectSections = sections(in: projectId)
        let knownSectionIds = Set(projectSections.map(\.id))

        let unsectioned = projectTasks.filter { task in
            guard let secId = task.section_id, !secId.isEmpty else { return true }
            return !knownSectionIds.contains(secId)
        }

        var groups: [FacetTaskGroup] = []
        if !unsectioned.isEmpty || projectSections.isEmpty {
            groups.append(
                FacetTaskGroup(
                    id: "project.\(projectId).none",
                    title: "No section",
                    sectionId: nil,
                    tasks: unsectioned
                )
            )
        }
        for sec in projectSections {
            groups.append(
                FacetTaskGroup(
                    id: "project.\(projectId).section.\(sec.id)",
                    title: sec.name,
                    sectionId: sec.id,
                    tasks: projectTasks.filter { $0.section_id == sec.id }
                )
            )
        }
        return groups
    }

    public func tasks(forLabel labelId: String) -> [Task] {
        topLevelOpenTasks
            .filter { $0.label_ids.contains(labelId) }
            .filter(matchesSearch)
            .sorted(by: Self.sortTasks)
    }

    public func tasks(forFilter filterId: String) -> [Task] {
        guard let found = filter(for: filterId) else { return [] }
        return FacetFilterQueryEvaluator.filterTasks(
            localStore.tasks.filter { $0.parent_id == nil },
            query: found.query,
            projects: activeProjects,
            sections: activeSections,
            labels: activeLabels,
            calendar: calendar
        )
        .filter(matchesSearch)
        .sorted(by: Self.sortTasks)
    }

    // MARK: - Shared Helpers

    internal func matchesSearch(_ task: Task) -> Bool {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }
        let needle = trimmed.lowercased()
        return task.title.lowercased().contains(needle)
            || task.description.lowercased().contains(needle)
    }

    public func humanDateHeading(for civil: String) -> String {
        if civil == calendar.today { return "Today · \(civil)" }
        if civil == calendar.addingDays(1) { return "Tomorrow · \(civil)" }
        return civil
    }

    internal static func sortTasks(_ lhs: Task, _ rhs: Task) -> Bool {
        let lhsWeight = priorityRank(lhs.priority)
        let rhsWeight = priorityRank(rhs.priority)
        if lhs.child_order != rhs.child_order { return lhs.child_order < rhs.child_order }
        if lhsWeight != rhsWeight { return lhsWeight < rhsWeight }
        return lhs.created_at < rhs.created_at
    }

    internal static func sortByDueThenOrder(_ lhs: Task, _ rhs: Task) -> Bool {
        let lhsDue = lhs.due_datetime ?? lhs.due_date ?? ""
        let rhsDue = rhs.due_datetime ?? rhs.due_date ?? ""
        if lhsDue != rhsDue { return lhsDue < rhsDue }
        return sortTasks(lhs, rhs)
    }

    private static func priorityRank(_ priority: Priority) -> Int {
        switch priority {
        case .p1: 1
        case .p2: 2
        case .p3: 3
        case .p4: 4
        }
    }
}
