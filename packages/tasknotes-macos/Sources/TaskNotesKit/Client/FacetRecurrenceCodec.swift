public import Foundation

/// Supported RFC 5545 recurrence frequencies in Facet.
public enum FacetRecurrenceFrequency: String, CaseIterable, Codable, Sendable, Equatable, Hashable {
    case daily = "DAILY"
    case weekly = "WEEKLY"
    case monthly = "MONTHLY"
    case yearly = "YEARLY"

    public var title: String {
        switch self {
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }
}

/// Weekday token in RFC 5545 `BYDAY` clauses (`0` = Sunday .. `6` = Saturday).
public enum FacetWeekday: Int, CaseIterable, Codable, Sendable, Equatable, Hashable {
    case sunday = 0
    case monday = 1
    case tuesday = 2
    case wednesday = 3
    case thursday = 4
    case friday = 5
    case saturday = 6

    public var rruleCode: String {
        switch self {
        case .sunday: "SU"
        case .monday: "MO"
        case .tuesday: "TU"
        case .wednesday: "WE"
        case .thursday: "TH"
        case .friday: "FR"
        case .saturday: "SA"
        }
    }

    public var shortName: String {
        switch self {
        case .sunday: "Sun"
        case .monday: "Mon"
        case .tuesday: "Tue"
        case .wednesday: "Wed"
        case .thursday: "Thu"
        case .friday: "Fri"
        case .saturday: "Sat"
        }
    }

    public static var mondayFirst: [FacetWeekday] {
        [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday]
    }

    public init?(rruleCode: String) {
        let upper = rruleCode.uppercased()
        guard let found = Self.allCases.first(where: { $0.rruleCode == upper }) else {
            return nil
        }
        self = found
    }
}

public struct FacetByDaySpec: Codable, Sendable, Equatable, Hashable {
    public let weekday: FacetWeekday
    public let ordinal: Int?

    public init(weekday: FacetWeekday, ordinal: Int? = nil) {
        self.weekday = weekday
        self.ordinal = ordinal
    }
}

public enum FacetRecurrenceEnd: Codable, Sendable, Equatable, Hashable {
    case never
    case until(String)
    case count(Int)
}

/// Editable recurrence draft mapping cleanly to and from RFC 5545 `RRULE` strings.
public struct FacetRecurrenceDraft: Codable, Sendable, Equatable, Hashable {
    public var frequency: FacetRecurrenceFrequency
    public var interval: Int
    public var byDay: [FacetByDaySpec]
    public var byMonthDay: [Int]
    public var end: FacetRecurrenceEnd
    public var dtstart: Date?

    public init(
        frequency: FacetRecurrenceFrequency = .weekly,
        interval: Int = 1,
        byDay: [FacetByDaySpec] = [],
        byMonthDay: [Int] = [],
        end: FacetRecurrenceEnd = .never,
        dtstart: Date? = nil
    ) {
        self.frequency = frequency
        self.interval = max(1, interval)
        self.byDay = byDay
        self.byMonthDay = byMonthDay
        self.end = end
        self.dtstart = dtstart
    }

    public var rruleString: String {
        var parts = ["FREQ=\(frequency.rawValue)"]
        if interval > 1 {
            parts.append("INTERVAL=\(interval)")
        }
        if !byDay.isEmpty {
            let formatted = byDay.map { spec in
                if let ordinal = spec.ordinal, ordinal != 0 {
                    return "\(ordinal)\(spec.weekday.rruleCode)"
                }
                return spec.weekday.rruleCode
            }
            parts.append("BYDAY=\(formatted.joined(separator: ","))")
        }
        if !byMonthDay.isEmpty {
            parts.append("BYMONTHDAY=\(byMonthDay.map(String.init).joined(separator: ","))")
        }
        switch end {
        case .never:
            break
        case .until(let civilDate):
            let compact = civilDate.replacingOccurrences(of: "-", with: "")
            if compact.count == 8 {
                parts.append("UNTIL=\(compact)T235959Z")
            } else {
                parts.append("UNTIL=\(civilDate)")
            }
        case .count(let occurrences):
            parts.append("COUNT=\(max(1, occurrences))")
        }
        return parts.joined(separator: ";")
    }
}

public enum FacetNextOccurrence: Sendable, Equatable {
    case ended
    case advanced(nextDate: Date, updatedRule: String)
}

/// Pure-Swift RFC 5545 `RRULE` codec, human-readable formatter, and next-occurrence calculator.
public enum FacetRecurrenceCodec {
    private struct ParseState {
        var frequency: FacetRecurrenceFrequency?
        var interval = 1
        var byDay: [FacetByDaySpec] = []
        var byMonthDay: [Int] = []
        var end: FacetRecurrenceEnd = .never
        var dtstart: Date?
    }

    public static func parse(_ rawRule: String) -> FacetRecurrenceDraft? {
        var state = ParseState()
        let segments = rawRule.components(separatedBy: CharacterSet(charactersIn: ";\r\n"))
        for rawSegment in segments {
            let trimmed = rawSegment.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }
            let stripped = stripPrefix(trimmed, prefix: "RRULE:")
            if stripped.uppercased().hasPrefix("DTSTART:") {
                let value = String(stripped.dropFirst(8))
                state.dtstart = parseCompactDate(value, endOfDay: false)
                continue
            }
            guard let eqIndex = stripped.firstIndex(of: "=") else { continue }
            let key = stripped[..<eqIndex].trimmingCharacters(in: .whitespaces).uppercased()
            let val = stripped[stripped.index(after: eqIndex)...]
                .trimmingCharacters(in: .whitespaces)
            applyToken(key: key, value: val, state: &state)
        }

        guard let resolvedFrequency = state.frequency else { return nil }
        return FacetRecurrenceDraft(
            frequency: resolvedFrequency,
            interval: state.interval,
            byDay: state.byDay,
            byMonthDay: state.byMonthDay,
            end: state.end,
            dtstart: state.dtstart
        )
    }

    public static func summary(for rawRule: String) -> String {
        guard let draft = parse(rawRule) else { return rawRule }
        return summary(for: draft)
    }

    public static func summary(for draft: FacetRecurrenceDraft) -> String {
        var base = cadencePhrase(for: draft)
        if !draft.byDay.isEmpty {
            let codes = Set(draft.byDay.filter { $0.ordinal == nil }.map(\.weekday))
            if draft.frequency == .weekly && draft.interval == 1
                && codes == [.monday, .tuesday, .wednesday, .thursday, .friday]
            {
                base = "Every weekday"
            } else if draft.frequency == .weekly && draft.interval == 1
                && codes == [.saturday, .sunday]
            {
                base = "Every weekend"
            } else {
                let labels = draft.byDay.map { spec in
                    if let ordinal = spec.ordinal {
                        return "\(ordinal) \(spec.weekday.shortName)"
                    }
                    return spec.weekday.shortName
                }
                base += " on \(labels.joined(separator: ", "))"
            }
        } else if !draft.byMonthDay.isEmpty {
            let days = draft.byMonthDay.map(String.init).joined(separator: ", ")
            base += " on day \(days)"
        }

        switch draft.end {
        case .never:
            return base
        case .until(let dateText):
            return "\(base) until \(String(dateText.prefix(10)))"
        case .count(let total):
            return "\(base) · \(total) \(total == 1 ? "time" : "times")"
        }
    }

    private static func cadencePhrase(for draft: FacetRecurrenceDraft) -> String {
        switch (draft.frequency, draft.interval) {
        case (.daily, 1): "Every day"
        case (.daily, let step): "Every \(step) days"
        case (.weekly, 1): "Every week"
        case (.weekly, let step): "Every \(step) weeks"
        case (.monthly, 1): "Every month"
        case (.monthly, let step): "Every \(step) months"
        case (.yearly, 1): "Every year"
        case (.yearly, let step): "Every \(step) years"
        }
    }

    private static func applyToken(key: String, value: String, state: inout ParseState) {
        if key == "FREQ" {
            state.frequency = FacetRecurrenceFrequency(rawValue: value.uppercased())
        } else if key == "INTERVAL", let parsed = Int(value), parsed > 0 {
            state.interval = parsed
        } else if key == "BYDAY" {
            state.byDay = parseByDayList(value)
        } else if key == "BYMONTHDAY" {
            state.byMonthDay = value.split(separator: ",").compactMap { item in
                guard let day = Int(item.trimmingCharacters(in: .whitespaces)),
                    day != 0,
                    (-31...31).contains(day)
                else { return nil }
                return day
            }
        } else if key == "UNTIL", let parsedUntil = parseCompactDate(value, endOfDay: true) {
            state.end = .until(ViewerCalendar.civilDateString(for: parsedUntil, timeZone: .gmt))
        } else if key == "COUNT", let parsedCount = Int(value) {
            state.end = .count(parsedCount)
        }
    }

    private static func parseByDayList(_ raw: String) -> [FacetByDaySpec] {
        raw.split(separator: ",").compactMap { part in
            let token = part.trimmingCharacters(in: .whitespaces).uppercased()
            guard token.count >= 2 else { return nil }
            let code = String(token.suffix(2))
            let prefix = String(token.dropLast(2))
            guard let weekday = FacetWeekday(rruleCode: code) else { return nil }
            if prefix.isEmpty {
                return FacetByDaySpec(weekday: weekday, ordinal: nil)
            }
            guard let ordinal = Int(prefix), ordinal != 0 else { return nil }
            return FacetByDaySpec(weekday: weekday, ordinal: ordinal)
        }
    }

    private static func stripPrefix(_ text: String, prefix: String) -> String {
        if text.uppercased().hasPrefix(prefix.uppercased()) {
            return String(text.dropFirst(prefix.count))
        }
        return text
    }
}
