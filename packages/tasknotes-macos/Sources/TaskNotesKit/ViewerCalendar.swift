public import Foundation

/// Snapshot of the viewer's local calendar day and timezone at a single instant.
public struct ViewerCalendar: Sendable, Equatable, Hashable {
    public let today: String
    public let timeZone: TimeZone
    public let instant: Date

    public init(today: String, timeZone: TimeZone, instant: Date) {
        self.today = today
        self.timeZone = timeZone
        self.instant = instant
    }

    public init(instant: Date = .now, timeZone: TimeZone = .current) {
        self.instant = instant
        self.timeZone = timeZone
        self.today = Self.civilDateString(for: instant, timeZone: timeZone)
    }

    public var gregorianCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    public var utcOffsetSeconds: Int32 {
        Int32(timeZone.secondsFromGMT(for: instant))
    }

    public func addingDays(_ days: Int, to civilDate: String? = nil) -> String {
        let baseDate = Self.date(fromCivil: civilDate ?? today, timeZone: timeZone) ?? instant
        let calendar = gregorianCalendar
        let shifted = calendar.date(byAdding: .day, value: days, to: baseDate) ?? baseDate
        return Self.civilDateString(for: shifted, timeZone: timeZone)
    }

    public func effectiveCivilDay(dueDate: String?, dueDatetime: String?) -> String? {
        if let dueDatetime, !dueDatetime.isEmpty, let parsed = Self.parseISO8601(dueDatetime) {
            return Self.civilDateString(for: parsed, timeZone: timeZone)
        }
        if let dueDate, dueDate.count >= 10 {
            return String(dueDate.prefix(10))
        }
        return nil
    }

    public static func civilDateString(for date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        let year = components.year ?? 1970
        let month = components.month ?? 1
        let day = components.day ?? 1
        return
            "\(Self.padDigits(year, width: 4))-\(Self.padDigits(month, width: 2))-\(Self.padDigits(day, width: 2))"
    }

    private static func padDigits(_ value: Int, width: Int) -> String {
        let digits = String(abs(value))
        let padding = max(0, width - digits.count)
        let prefix = value < 0 ? "-" : ""
        return prefix + String(repeating: "0", count: padding) + digits
    }

    public static func date(fromCivil civil: String, timeZone: TimeZone) -> Date? {
        let parts = civil.prefix(10).split(separator: "-")
        guard parts.count == 3,
            let year = Int(parts[0]),
            let month = Int(parts[1]),
            let day = Int(parts[2])
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 0
        components.minute = 0
        components.second = 0
        return calendar.date(from: components)
    }

    public static func parseISO8601(_ raw: String) -> Date? {
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = withFractional.date(from: raw) {
            return parsed
        }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        if let parsed = standard.date(from: raw) {
            return parsed
        }
        return date(fromCivil: raw, timeZone: .gmt)
    }
}

public protocol ViewerCalendarSource: Sendable {
    func viewerCalendar() -> ViewerCalendar
}
