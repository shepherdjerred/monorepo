public import Foundation

/// The existing widget envelope contains bounded display data only. All task
/// selection and recurring occurrence policy comes from runtime queries.
public struct FacetWidgetEnvelope: Codable, Sendable {
    public let schemaVersion: UInt32
    public let generatedAt: String
    public let projections: [String: FacetWidgetDay]

    public init(generatedAt: String, projections: [String: FacetWidgetDay]) {
        schemaVersion = 2
        self.generatedAt = generatedAt
        self.projections = projections
    }
}

public struct FacetWidgetDay: Codable, Sendable {
    public let todayTasks: [FacetWidgetTask]
    public let stats: FacetWidgetStats

    public init(agenda: FacetSnapshot, total: UInt64, overdue: UInt64) {
        todayTasks = agenda.tasks.map(FacetWidgetTask.init)
        stats = FacetWidgetStats(total: total, overdue: overdue, today: agenda.totalCount)
    }
}

public struct FacetWidgetStats: Codable, Sendable {
    public let total: UInt64
    public let overdue: UInt64
    public let today: UInt64
}

public struct FacetWidgetTask: Codable, Sendable {
    public let id: String
    public let title: String
    public let priority: String
    public let completed: Bool
    public let due: String?
    public let dateLabel: String?
    public let project: String?

    init(_ task: FacetTask) {
        id = task.id
        title = task.title
        priority = task.priority
        completed = task.completed
        due = task.effectiveDate
        dateLabel = nil
        project = task.properties["projects"]?.array?.elements.first?.text
    }
}

extension FacetEngine {
    public func widgetEnvelope(profileID: String, now: Date = .now) throws -> Data {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let start = calendar.startOfDay(for: now)
        let at = now.ISO8601Format()
        var projections: [String: FacetWidgetDay] = [:]
        var expectedVersion: UInt64?
        for offset in 0...32 {
            guard let day = calendar.date(byAdding: .day, value: offset, to: start) else {
                throw FacetContractError.unsupportedResponse
            }
            let civil = day.formatted(
                Date.ISO8601FormatStyle(timeZone: calendar.timeZone).year().month().day())
            let base: [String: FacetValue] = [
                "today": .string(civil), "at": .string(at), "limit": .integer(0),
            ]
            var agendaQuery = base
            agendaQuery["scope"] = .string("agenda")
            agendaQuery["limit"] = .integer(8)
            let agenda = try snapshot(profileID: profileID, query: .object(agendaQuery))
            if expectedVersion == nil { expectedVersion = agenda.version }
            var totalQuery = base
            totalQuery["completed"] = .bool(false)
            let total = try snapshot(profileID: profileID, query: .object(totalQuery))
            var overdueQuery = base
            overdueQuery["scope"] = .string("overdue")
            let overdue = try snapshot(profileID: profileID, query: .object(overdueQuery))
            guard agenda.version == expectedVersion, agenda.version == total.version,
                agenda.version == overdue.version
            else {
                throw FacetContractError.unsupportedResponse
            }
            projections[civil] = FacetWidgetDay(
                agenda: agenda, total: total.totalCount, overdue: overdue.totalCount)
        }
        return try JSONEncoder().encode(
            FacetWidgetEnvelope(generatedAt: at, projections: projections))
    }
}
