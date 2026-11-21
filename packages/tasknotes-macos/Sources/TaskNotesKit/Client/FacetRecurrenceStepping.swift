public import Foundation

extension FacetRecurrenceCodec {
    public static func nextOccurrence(
        rule: String,
        dueDate: String?,
        dueDatetime: String?,
        referenceDate: Date = .now,
        completedAt: Date? = nil,
        timeZone: TimeZone = .gmt,
        basis: RecurrenceBasis = .scheduled
    ) -> FacetNextOccurrence {
        guard let parsed = parse(rule) else { return .ended }
        if case .count(let remaining) = parsed.end, remaining <= 1 {
            return .ended
        }
        let original = resolveAnchorDate(
            dueDate: dueDate,
            dueDatetime: dueDatetime,
            dtstart: parsed.dtstart,
            referenceDate: referenceDate
        )
        guard
            let candidate = nextLocalOccurrence(
                parsed, original: original, timed: dueDatetime != nil,
                completion: CompletionContext(basis: basis, timestamp: completedAt),
                timeZone: timeZone)
        else { return .ended }

        if case .until(let untilRaw) = parsed.end,
            let untilDate = parseCompactDate(untilRaw, endOfDay: true),
            candidate > untilDate
        {
            return .ended
        }

        let updatedRule: String
        if case .count(let remaining) = parsed.end {
            updatedRule = replaceCount(in: rule, newCount: remaining - 1)
        } else {
            updatedRule = rule
        }
        return .advanced(nextDate: candidate, updatedRule: updatedRule)
    }

    private struct CompletionContext {
        let basis: RecurrenceBasis
        let timestamp: Date?
    }

    private static func nextLocalOccurrence(
        _ parsed: FacetRecurrenceDraft, original: Date, timed: Bool,
        completion: CompletionContext, timeZone: TimeZone
    ) -> Date? {
        var zone = utcCalendar()
        zone.timeZone = timeZone
        let utc = utcCalendar()
        let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        var anchor =
            timed
            ? utc.date(from: zone.dateComponents(parts, from: original)) ?? original : original
        var after: Date?
        if let completedAt = completion.timestamp {
            after = utc.date(from: zone.dateComponents(parts, from: completedAt))
            if completion.basis == .completion, let after {
                guard
                    let anchored = utc.date(
                        bySettingHour: utc.component(.hour, from: anchor),
                        minute: utc.component(.minute, from: anchor),
                        second: utc.component(.second, from: anchor),
                        of: after)
                else { return nil }
                anchor = anchored
            }
        }
        var next = stepOccurrence(anchor, parsed)
        while let after, next <= after {
            let later = stepOccurrence(next, parsed)
            guard later > next else { return nil }
            next = later
        }
        return timed ? zone.date(from: utc.dateComponents(parts, from: next)) : next
    }

    private static func stepOccurrence(_ anchor: Date, _ draft: FacetRecurrenceDraft) -> Date {
        switch draft.frequency {
        case .daily: stepDaily(anchor: anchor, draft: draft)
        case .weekly: stepWeekly(anchor: anchor, draft: draft)
        case .monthly: stepMonthly(anchor: anchor, draft: draft)
        case .yearly: stepYearly(anchor: anchor, draft: draft)
        }
    }

    internal static func replaceCount(in rule: String, newCount: Int) -> String {
        let parts = rule.split(separator: ";", omittingEmptySubsequences: false).map {
            segment -> String in
            let trimmed = segment.trimmingCharacters(in: .whitespaces)
            if trimmed.uppercased().hasPrefix("COUNT=") {
                return "COUNT=\(newCount)"
            }
            return String(segment)
        }
        return parts.joined(separator: ";")
    }

    internal static func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }

    internal static func parseCompactDate(_ raw: String, endOfDay: Bool) -> Date? {
        let digitsOnly = raw.uppercased().replacingOccurrences(of: "Z", with: "")
        let calendar = utcCalendar()
        if let tIndex = digitsOnly.firstIndex(of: "T") {
            let datePart = String(digitsOnly[..<tIndex])
            let timePart = String(digitsOnly[digitsOnly.index(after: tIndex)...])
            if let built = parseCompactDateTimeParts(
                datePart: datePart,
                timePart: timePart,
                calendar: calendar
            ) {
                return built
            }
        }
        let cleanDate = raw.replacingOccurrences(of: "-", with: "")
        if cleanDate.count == 8,
            let year = Int(cleanDate.prefix(4)),
            let month = Int(cleanDate.dropFirst(4).prefix(2)),
            let day = Int(cleanDate.suffix(2))
        {
            return calendar.date(
                from: DateComponents(
                    timeZone: .gmt,
                    year: year,
                    month: month,
                    day: day,
                    hour: endOfDay ? 23 : 0,
                    minute: endOfDay ? 59 : 0,
                    second: endOfDay ? 59 : 0
                )
            )
        }
        return ViewerCalendar.parseISO8601(raw)
    }

    private static func parseCompactDateTimeParts(
        datePart: String,
        timePart: String,
        calendar: Calendar
    ) -> Date? {
        guard datePart.count == 8, timePart.count == 6,
            let year = Int(datePart.prefix(4)),
            let month = Int(datePart.dropFirst(4).prefix(2)),
            let day = Int(datePart.suffix(2)),
            let hour = Int(timePart.prefix(2)),
            let minute = Int(timePart.dropFirst(2).prefix(2)),
            let second = Int(timePart.suffix(2))
        else { return nil }
        return calendar.date(
            from: DateComponents(
                timeZone: .gmt,
                year: year,
                month: month,
                day: day,
                hour: hour,
                minute: minute,
                second: second
            )
        )
    }

    private static func resolveAnchorDate(
        dueDate: String?,
        dueDatetime: String?,
        dtstart: Date?,
        referenceDate: Date
    ) -> Date {
        if let dueDatetime, !dueDatetime.isEmpty,
            let parsed = ViewerCalendar.parseISO8601(dueDatetime)
        {
            return parsed
        }
        if let dueDate, !dueDate.isEmpty, let parsed = parseCompactDate(dueDate, endOfDay: false) {
            return parsed
        }
        if let dtstart {
            return dtstart
        }
        return utcCalendar().startOfDay(for: referenceDate)
    }

    private static func utcWeekdayZeroBased(_ date: Date) -> Int {
        (utcCalendar().component(.weekday, from: date) - 1 + 7) % 7
    }

    private static func stepDaily(anchor: Date, draft: FacetRecurrenceDraft) -> Date {
        let calendar = utcCalendar()
        if draft.byDay.isEmpty {
            return calendar.date(byAdding: .day, value: draft.interval, to: anchor) ?? anchor
        }
        let allowed = Set(draft.byDay.map { $0.weekday.rawValue })
        for step in 1...400 {
            let candidate =
                calendar.date(byAdding: .day, value: step * draft.interval, to: anchor) ?? anchor
            if allowed.contains(utcWeekdayZeroBased(candidate)) {
                return candidate
            }
        }
        return calendar.date(byAdding: .day, value: draft.interval, to: anchor) ?? anchor
    }

    private static func stepWeekly(anchor: Date, draft: FacetRecurrenceDraft) -> Date {
        let calendar = utcCalendar()
        if draft.byDay.isEmpty {
            return calendar.date(byAdding: .day, value: 7 * draft.interval, to: anchor) ?? anchor
        }
        let anchorMonOffset = (utcWeekdayZeroBased(anchor) + 6) % 7
        let weekMonday =
            calendar.date(byAdding: .day, value: -anchorMonOffset, to: anchor) ?? anchor
        let offsets = Array(Set(draft.byDay.map { ($0.weekday.rawValue + 6) % 7 })).sorted()
        if let sameWeekNext = offsets.first(where: { $0 > anchorMonOffset }) {
            return calendar.date(byAdding: .day, value: sameWeekNext, to: weekMonday) ?? anchor
        }
        let nextWeekMonday =
            calendar.date(byAdding: .day, value: 7 * draft.interval, to: weekMonday) ?? anchor
        return calendar.date(
            byAdding: .day,
            value: offsets.first ?? anchorMonOffset,
            to: nextWeekMonday
        ) ?? anchor
    }

    private static func stepMonthly(anchor: Date, draft: FacetRecurrenceDraft) -> Date {
        let calendar = utcCalendar()
        let anchorParts = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: anchor
        )
        let year = anchorParts.year ?? 1970
        let month = anchorParts.month ?? 1
        let day = anchorParts.day ?? 1

        if !draft.byMonthDay.isEmpty || !draft.byDay.isEmpty {
            if let constrained = stepConstrainedMonthly(
                year: year,
                month: month,
                day: day,
                anchorParts: anchorParts,
                draft: draft
            ) {
                return constrained
            }
        }

        let target = shiftYearMonth(year: year, month: month, monthsToAdd: draft.interval)
        let clampedDay = min(day, daysInMonth(year: target.year, month: target.month))
        return makeUTCDate(
            year: target.year,
            month: target.month,
            day: clampedDay,
            anchorParts: anchorParts
        ) ?? anchor
    }

    private static func stepConstrainedMonthly(
        year: Int,
        month: Int,
        day: Int,
        anchorParts: DateComponents,
        draft: FacetRecurrenceDraft
    ) -> Date? {
        let sameMonth = resolveMonthlyDays(year: year, month: month, draft: draft)
        if let nextDayInMonth = sameMonth.first(where: { $0 > day }),
            let built = makeUTCDate(
                year: year,
                month: month,
                day: nextDayInMonth,
                anchorParts: anchorParts
            )
        {
            return built
        }
        for step in 1...24 {
            let shifted = shiftYearMonth(
                year: year,
                month: month,
                monthsToAdd: step * draft.interval
            )
            let resolved = resolveMonthlyDays(
                year: shifted.year,
                month: shifted.month,
                draft: draft
            )
            if let firstDay = resolved.first,
                let built = makeUTCDate(
                    year: shifted.year,
                    month: shifted.month,
                    day: firstDay,
                    anchorParts: anchorParts
                )
            {
                return built
            }
        }
        return nil
    }

    private static func stepYearly(anchor: Date, draft: FacetRecurrenceDraft) -> Date {
        let calendar = utcCalendar()
        let anchorParts = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: anchor
        )
        let targetYear = (anchorParts.year ?? 1970) + draft.interval
        let targetMonth = anchorParts.month ?? 1
        let resolvedDays =
            draft.byMonthDay.isEmpty
            ? []
            : resolveMonthDaySpecs(year: targetYear, month: targetMonth, specs: draft.byMonthDay)
        let chosenDay =
            resolvedDays.first
            ?? min(anchorParts.day ?? 1, daysInMonth(year: targetYear, month: targetMonth))
        return makeUTCDate(
            year: targetYear,
            month: targetMonth,
            day: chosenDay,
            anchorParts: anchorParts
        ) ?? anchor
    }

    private static func resolveMonthlyDays(
        year: Int,
        month: Int,
        draft: FacetRecurrenceDraft
    ) -> [Int] {
        if !draft.byMonthDay.isEmpty {
            return resolveMonthDaySpecs(year: year, month: month, specs: draft.byMonthDay)
        }
        let maxDay = daysInMonth(year: year, month: month)
        let calendar = utcCalendar()
        var matched: Set<Int> = []
        for spec in draft.byDay {
            let daysForWeekday = (1...maxDay).filter { candidateDay in
                guard
                    let candidateDate = calendar.date(
                        from: DateComponents(
                            timeZone: .gmt,
                            year: year,
                            month: month,
                            day: candidateDay
                        )
                    )
                else { return false }
                return utcWeekdayZeroBased(candidateDate) == spec.weekday.rawValue
            }
            if let ordinal = spec.ordinal {
                let index = ordinal > 0 ? ordinal - 1 : daysForWeekday.count + ordinal
                if daysForWeekday.indices.contains(index) {
                    matched.insert(daysForWeekday[index])
                }
            } else {
                matched.formUnion(daysForWeekday)
            }
        }
        return matched.sorted()
    }

    private static func resolveMonthDaySpecs(year: Int, month: Int, specs: [Int]) -> [Int] {
        let maxDay = daysInMonth(year: year, month: month)
        var resolved: Set<Int> = []
        for spec in specs {
            let day = spec > 0 ? spec : maxDay + 1 + spec
            if (1...maxDay).contains(day) {
                resolved.insert(day)
            }
        }
        return resolved.sorted()
    }

    private static func shiftYearMonth(
        year: Int,
        month: Int,
        monthsToAdd: Int
    ) -> (year: Int, month: Int) {
        let zeroBased = year * 12 + (month - 1) + monthsToAdd
        let nextYear = Int(floor(Double(zeroBased) / 12.0))
        let nextMonth = ((zeroBased % 12) + 12) % 12 + 1
        return (nextYear, nextMonth)
    }

    private static func daysInMonth(year: Int, month: Int) -> Int {
        let calendar = utcCalendar()
        guard
            let date = calendar.date(
                from: DateComponents(timeZone: .gmt, year: year, month: month, day: 1)
            ),
            let range = calendar.range(of: .day, in: .month, for: date)
        else { return 30 }
        return range.count
    }

    private static func makeUTCDate(
        year: Int,
        month: Int,
        day: Int,
        anchorParts: DateComponents
    ) -> Date? {
        utcCalendar().date(
            from: DateComponents(
                timeZone: .gmt,
                year: year,
                month: month,
                day: day,
                hour: anchorParts.hour ?? 0,
                minute: anchorParts.minute ?? 0,
                second: anchorParts.second ?? 0
            )
        )
    }
}
