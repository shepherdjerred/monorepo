import Foundation
import TaskNotesKit

/// Maps a mobile navigation destination onto the shared runtime's query API.
/// Date membership, recurrence expansion, grouping and ordering remain in Rust.
internal enum FacetMobileQueryPolicy {
    static func apply(scope: String, fields: inout [String: FacetValue]) {
        if !["today", "upcoming", "todayAgenda", "upcomingAgenda", "overdue", "agenda"].contains(
            scope)
        {
            // Non-calendar collections display the series' configured status,
            // rather than substituting completion of its current occurrence.
            fields.removeValue(forKey: "today")
        }
        if scope == "today" {
            fields["scope"] = .string("todayAgenda")
            if fields["groupBy"] == nil { fields["groupBy"] = .string("agendaSection") }
        } else if scope == "upcoming" {
            fields["scope"] = .string("upcomingAgenda")
            if fields["groupBy"] == nil { fields["groupBy"] = .string("effectiveDate") }
        } else if scope == "inbox" {
            fields["scope"] = .string("all")
            fields["hasNoProject"] = .bool(true)
        }
    }

    static let filterKeys = [
        "statuses", "priorities", "projects", "contexts", "tags", "completed", "hasNoDueDate",
        "hasNoProject", "dueBefore", "dueAfter",
    ]

    static func filterCount(_ fields: [String: FacetValue], scope: String = "all") -> Int {
        filterKeys.filter { key in
            guard let value = fields[key] else { return false }
            if key == "completed" {
                return scope == "completed" ? value == .bool(false) : value != .bool(false)
            }
            if key == "hasNoProject", scope == "inbox", value == .bool(true) { return false }
            if value == .null { return false }
            if let array = value.array { return !array.elements.isEmpty }
            return true
        }.count
    }

    static func clearedFilters(_ fields: [String: FacetValue]) -> [String: FacetValue] {
        fields.filter { !filterKeys.contains($0.key) }
    }
}

internal enum FacetMobileDateText {
    static func heading(_ key: String, today: String, timeZone: TimeZone) -> String {
        if key == "overdue" { return "Overdue" }
        if key == "scheduled-today" { return "Today" }
        if key == "due-today" { return "Due Today" }
        if key.isEmpty { return "No date" }
        guard let date = Self.date(key, timeZone: timeZone),
            let reference = Self.date(today, timeZone: timeZone)
        else { return key }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        if key == today { return "Today" }
        if calendar.date(byAdding: .day, value: 1, to: reference) == date { return "Tomorrow" }
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.timeZone = timeZone
        formatter.calendar = calendar
        formatter.setLocalizedDateFormatFromTemplate("EEEE MMM d")
        return formatter.string(from: date)
    }

    static func date(_ day: String, timeZone: TimeZone) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let date = formatter.date(from: day), formatter.string(from: date) == day else {
            return nil
        }
        return date
    }

    static func label(_ date: Date, template: String, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    static func week(today: String, timeZone: TimeZone) -> [String] {
        guard let first = date(today, timeZone: timeZone) else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return (1...7).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: first).map(formatter.string(from:))
        }
    }
}
