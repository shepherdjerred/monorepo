import Foundation

extension FacetQuickCaptureParser {
    internal struct ClockTime {
        let hour: Int
        let minute: Int
        let display: String
    }

    internal struct DatePhraseMatch {
        let civilDate: String
        let label: String
        let rawPhrase: String
    }

    private static let weekdayMap: [String: Int] = [
        "sunday": 1, "sun": 1,
        "monday": 2, "mon": 2,
        "tuesday": 3, "tue": 3, "tues": 3,
        "wednesday": 4, "wed": 4,
        "thursday": 5, "thu": 5, "thur": 5, "thurs": 5,
        "friday": 6, "fri": 6,
        "saturday": 7, "sat": 7,
    ]

    internal static func extractClockTime(from text: inout String) -> ClockTime? {
        let twelveBranch = #"(?:^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s|$)"#
        let twentyFourBranch = #"(?:^|\s)at\s+([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)"#
        let pattern = "\(twelveBranch)|\(twentyFourBranch)"
        guard let match = findMatch(pattern: pattern, in: text, caseInsensitive: true) else {
            return nil
        }
        let twelveHour = substring(in: text, range: match.range(at: 1))
        if !twelveHour.isEmpty, let rawHour = Int(twelveHour), (1...12).contains(rawHour) {
            let minuteText = substring(in: text, range: match.range(at: 2))
            let meridiem = substring(in: text, range: match.range(at: 3)).lowercased()
            let minute = Int(minuteText) ?? 0
            guard (0...59).contains(minute) else { return nil }
            var hour = rawHour % 12
            if meridiem == "pm" { hour += 12 }
            replaceRange(match.range, in: &text)
            return ClockTime(
                hour: hour,
                minute: minute,
                display: "\(padTwo(hour)):\(padTwo(minute))"
            )
        }
        let twentyFourHour = substring(in: text, range: match.range(at: 4))
        let twentyFourMin = substring(in: text, range: match.range(at: 5))
        if let hour = Int(twentyFourHour), let minute = Int(twentyFourMin) {
            replaceRange(match.range, in: &text)
            return ClockTime(
                hour: hour,
                minute: minute,
                display: "\(padTwo(hour)):\(padTwo(minute))"
            )
        }
        return nil
    }

    private static func padTwo(_ value: Int) -> String {
        value < 10 ? "0\(value)" : "\(value)"
    }

    internal static func extractDatePhrase(
        from text: inout String,
        calendar: ViewerCalendar
    ) -> DatePhraseMatch? {
        if let isoMatch = findMatch(
            pattern: #"(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)"#,
            in: text,
            caseInsensitive: false
        ) {
            let dateStr = substring(in: text, range: isoMatch.range(at: 1))
            if ViewerCalendar.date(fromCivil: dateStr, timeZone: calendar.timeZone) != nil {
                replaceRange(isoMatch.range, in: &text)
                return DatePhraseMatch(civilDate: dateStr, label: dateStr, rawPhrase: dateStr)
            }
        }

        if let keyword = extractNamedDateKeyword(from: &text, calendar: calendar) {
            return keyword
        }

        let dayNames =
            "monday|mon|tuesday|tue|tues|wednesday|wed|"
            + "thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun"
        let weekdayPattern = "(?:^|\\s)(?:(next)\\s+)?(\(dayNames))(?=\\s|$)"
        if let match = findMatch(pattern: weekdayPattern, in: text, caseInsensitive: true) {
            let nextModifier = !substring(in: text, range: match.range(at: 1)).isEmpty
            let name = substring(in: text, range: match.range(at: 2)).lowercased()
            if let targetWeekday = weekdayMap[name] {
                let rawPhrase = substring(in: text, range: match.range).trimmingCharacters(
                    in: .whitespaces
                )
                replaceRange(match.range, in: &text)
                let resolved = upcomingWeekday(
                    targetWeekday,
                    forceNextWeek: nextModifier,
                    calendar: calendar
                )
                return DatePhraseMatch(
                    civilDate: resolved,
                    label: name.capitalized,
                    rawPhrase: rawPhrase
                )
            }
        }
        return nil
    }

    private static func extractNamedDateKeyword(
        from text: inout String,
        calendar: ViewerCalendar
    ) -> DatePhraseMatch? {
        let keywordPatterns: [(String, (ViewerCalendar) -> (String, String))] = [
            (#"(?:^|\s)(today|tonight)(?=\s|$)"#, { ($0.today, "Today") }),
            (#"(?:^|\s)(tomorrow|tmr)(?=\s|$)"#, { ($0.addingDays(1), "Tomorrow") }),
            (#"(?:^|\s)(next\s+week)(?=\s|$)"#, { ($0.addingDays(7), "Next week") }),
            (
                #"(?:^|\s)(this\s+weekend)(?=\s|$)"#,
                { (upcomingWeekday(7, forceNextWeek: false, calendar: $0), "This weekend") }
            ),
        ]
        for (pattern, builder) in keywordPatterns {
            if let match = findMatch(pattern: pattern, in: text, caseInsensitive: true) {
                let raw = substring(in: text, range: match.range(at: 1))
                replaceRange(match.range, in: &text)
                let (civil, label) = builder(calendar)
                return DatePhraseMatch(civilDate: civil, label: label, rawPhrase: raw)
            }
        }
        return nil
    }

    private static func upcomingWeekday(
        _ targetWeekday: Int,
        forceNextWeek: Bool,
        calendar: ViewerCalendar
    ) -> String {
        let greg = calendar.gregorianCalendar
        let base =
            ViewerCalendar.date(fromCivil: calendar.today, timeZone: calendar.timeZone)
            ?? calendar.instant
        let currentWeekday = greg.component(.weekday, from: base)
        var delta = (targetWeekday - currentWeekday + 7) % 7
        if delta == 0 || forceNextWeek {
            delta += 7
        }
        return calendar.addingDays(delta)
    }

    internal static func buildDueDatetime(
        civilDate: String,
        clock: ClockTime,
        timeZone: TimeZone
    ) -> String? {
        let parts = civilDate.split(separator: "-")
        guard parts.count == 3,
            let year = Int(parts[0]),
            let month = Int(parts[1]),
            let day = Int(parts[2])
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        guard
            let built = calendar.date(
                from: DateComponents(
                    timeZone: timeZone,
                    year: year,
                    month: month,
                    day: day,
                    hour: clock.hour,
                    minute: clock.minute,
                    second: 0
                )
            )
        else { return nil }
        return ISO8601DateFormatter().string(from: built)
    }

    internal static func findMatch(
        pattern: String,
        in text: String,
        caseInsensitive: Bool
    ) -> NSTextCheckingResult? {
        let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
        do {
            let expression = try NSRegularExpression(pattern: pattern, options: options)
            let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
            return expression.firstMatch(in: text, options: [], range: fullRange)
        } catch {
            return nil
        }
    }

    internal static func substring(in text: String, range: NSRange) -> String {
        guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else {
            return ""
        }
        return String(text[swiftRange])
    }

    internal static func replaceRange(_ range: NSRange, in text: inout String) {
        guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else {
            return
        }
        text.replaceSubrange(swiftRange, with: " ")
    }
}
