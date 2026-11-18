public import Foundation

/// Display-only widget snapshot envelope shared with `TasksWidget`.
public struct FacetWidgetEnvelope: Codable, Sendable, Equatable {
    public let schemaVersion: UInt32
    public let generatedAt: String
    public let projections: [String: FacetWidgetDay]

    public init(generatedAt: String, projections: [String: FacetWidgetDay]) {
        schemaVersion = 2
        self.generatedAt = generatedAt
        self.projections = projections
    }
}

public struct FacetWidgetDay: Codable, Sendable, Equatable {
    public let todayTasks: [FacetWidgetTask]
    public let stats: FacetWidgetStats

    public init(todayTasks: [FacetWidgetTask], stats: FacetWidgetStats) {
        self.todayTasks = todayTasks
        self.stats = stats
    }
}

public struct FacetWidgetStats: Codable, Sendable, Equatable {
    public let total: UInt64
    public let overdue: UInt64
    public let today: UInt64

    public init(total: UInt64, overdue: UInt64, today: UInt64) {
        self.total = total
        self.overdue = overdue
        self.today = today
    }
}

public struct FacetWidgetTask: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let priority: String
    public let completed: Bool
    public let due: String?
    public let dateLabel: String?
    public let project: String?

    public init(
        id: String,
        title: String,
        priority: String,
        completed: Bool,
        due: String?,
        dateLabel: String?,
        project: String?
    ) {
        self.id = id
        self.title = title
        self.priority = priority
        self.completed = completed
        self.due = due
        self.dateLabel = dateLabel
        self.project = project
    }
}

/// Builds 33-day rolling widget projections from local tasks and projects.
public enum FacetWidgetProjection {
    public static func encodeEnvelope(
        tasks: [Task],
        projects: [Project],
        now: Date = .now,
        viewerTimeZone: TimeZone = .current
    ) throws -> Data {
        let envelope = buildEnvelope(
            tasks: tasks,
            projects: projects,
            now: now,
            viewerTimeZone: viewerTimeZone
        )
        return try JSONEncoder().encode(envelope)
    }

    public static func buildEnvelope(
        tasks: [Task],
        projects: [Project],
        now: Date = .now,
        viewerTimeZone: TimeZone = .current
    ) -> FacetWidgetEnvelope {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = viewerTimeZone
        let start = calendar.startOfDay(for: now)
        let generatedAt = ISO8601DateFormatter().string(from: now)
        let projectNames = Dictionary(
            uniqueKeysWithValues: projects.filter { !$0.is_deleted && !$0.is_inbox }.map {
                ($0.id, $0.name)
            }
        )
        let openTasks = tasks.filter { !$0.is_deleted && !$0.completed }
        let viewer = ViewerCalendar(instant: now, timeZone: viewerTimeZone)

        var projections: [String: FacetWidgetDay] = [:]
        for offset in 0...32 {
            guard let dayDate = calendar.date(byAdding: .day, value: offset, to: start) else {
                continue
            }
            let civil = ViewerCalendar.civilDateString(for: dayDate, timeZone: viewerTimeZone)
            projections[civil] = buildDay(
                civilDay: civil,
                openTasks: openTasks,
                projectNames: projectNames,
                viewer: viewer
            )
        }
        return FacetWidgetEnvelope(generatedAt: generatedAt, projections: projections)
    }

    private static func buildDay(
        civilDay: String,
        openTasks: [Task],
        projectNames: [String: String],
        viewer: ViewerCalendar
    ) -> FacetWidgetDay {
        var overdueCount: UInt64 = 0
        var matching: [(task: Task, dueCivil: String)] = []

        for task in openTasks {
            guard
                let dueCivil = viewer.effectiveCivilDay(
                    dueDate: task.due_date,
                    dueDatetime: task.due_datetime
                )
            else { continue }
            if dueCivil < civilDay {
                overdueCount += 1
                matching.append((task, dueCivil))
            } else if dueCivil == civilDay {
                matching.append((task, dueCivil))
            }
        }

        matching.sort { left, right in
            if left.dueCivil != right.dueCivil { return left.dueCivil < right.dueCivil }
            if left.task.priority != right.task.priority {
                return priorityRank(left.task.priority) < priorityRank(right.task.priority)
            }
            return left.task.child_order < right.task.child_order
        }

        let topRows = matching.prefix(8).map { entry in
            FacetWidgetTask(
                id: entry.task.id,
                title: entry.task.title,
                priority: entry.task.priority.rawValue,
                completed: entry.task.completed,
                due: entry.dueCivil,
                dateLabel: entry.dueCivil < civilDay ? "Overdue" : "Today",
                project: projectNames[entry.task.project_id]
            )
        }
        return FacetWidgetDay(
            todayTasks: topRows,
            stats: FacetWidgetStats(
                total: UInt64(openTasks.count),
                overdue: overdueCount,
                today: UInt64(matching.count)
            )
        )
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
