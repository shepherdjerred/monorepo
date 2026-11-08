import TaskNotesKit

internal import struct Foundation.Calendar
internal import struct Foundation.Date

enum FacetRecurrenceCadence: String, CaseIterable, Identifiable {
    case daily
    case weekly
    case monthly
    case yearly

    var id: Self { self }
    var label: String { rawValue.capitalized }
}

enum FacetRecurrenceMonthlyMode: String, CaseIterable, Identifiable {
    case dayOfMonth
    case ordinalWeekday

    var id: Self { self }
    var label: String {
        switch self {
        case .dayOfMonth: "Day of Month"
        case .ordinalWeekday: "Ordinal Weekday"
        }
    }
}

enum FacetRecurrenceEnding: String, CaseIterable, Identifiable {
    case never
    case onDate
    case afterOccurrences

    var id: Self { self }
    var label: String {
        switch self {
        case .never: "Never"
        case .onDate: "On Date"
        case .afterOccurrences: "After Occurrences"
        }
    }
}

struct FacetRecurrencePatternSeed {
    var cadence = FacetRecurrenceCadence.daily
    var weekdays: Set<FacetCommonWeekday> = []
    var monthlyMode = FacetRecurrenceMonthlyMode.dayOfMonth
    var monthDay: UInt8
    var ordinal = FacetMonthlyOrdinal.first
    var ordinalWeekday: FacetCommonWeekday
    var yearlyMonth: UInt8
    var yearlyDay: UInt8

    init(pattern: FacetCommonRecurrencePattern, start: String) {
        monthDay = FacetRecurrenceEditorSheet.day(of: start)
        ordinalWeekday = FacetRecurrenceEditorSheet.weekday(of: start)
        yearlyMonth = FacetRecurrenceEditorSheet.month(of: start)
        yearlyDay = FacetRecurrenceEditorSheet.day(of: start)
        switch pattern {
        case .daily:
            break
        case .weekly(let selected):
            cadence = .weekly
            weekdays = Set(selected)
        case .monthlyDayOfMonth(let selectedDay):
            cadence = .monthly
            monthDay = selectedDay
        case .monthlyOrdinalWeekday(let selectedOrdinal, let selectedWeekday):
            cadence = .monthly
            monthlyMode = .ordinalWeekday
            ordinal = selectedOrdinal
            ordinalWeekday = selectedWeekday
        case .yearlyMonthDay(let selectedMonth, let selectedDay):
            cadence = .yearly
            yearlyMonth = selectedMonth
            yearlyDay = selectedDay
        }
        if weekdays.isEmpty {
            weekdays = [FacetRecurrenceEditorSheet.weekday(of: start)]
        }
    }
}

struct FacetFacetRecurrenceEndingSeed {
    let ending: FacetRecurrenceEnding
    let date: Date
    let count: UInt32

    init(ending: FacetCommonRecurrenceEnd, startDate: Date) {
        switch ending {
        case .never:
            self.ending = .never
            date = startDate
            count = 10
        case .onDate(let endDate):
            self.ending = .onDate
            date = FacetCivilDay.date(of: endDate) ?? startDate
            count = 10
        case .afterOccurrences(let occurrences):
            self.ending = .afterOccurrences
            date = startDate
            count = occurrences
        }
    }
}

extension FacetRecurrenceEditorSheet {
    private static var recurrenceCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = .current
        calendar.timeZone = .current
        return calendar
    }

    static let allWeekdays: [FacetCommonWeekday] = [
        .monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday,
    ]

    static let allOrdinals: [FacetMonthlyOrdinal] = [
        .first, .second, .third, .fourth, .fifth, .last,
    ]

    static func weekday(of civil: String) -> FacetCommonWeekday {
        guard let date = FacetCivilDay.date(of: civil) else { return .monday }
        return weekdayByFoundationIndex[recurrenceCalendar.component(.weekday, from: date)]
            ?? .monday
    }

    static func month(of civil: String) -> UInt8 {
        guard let date = FacetCivilDay.date(of: civil) else { return 1 }
        return UInt8(recurrenceCalendar.component(.month, from: date))
    }

    static func day(of civil: String) -> UInt8 {
        guard let date = FacetCivilDay.date(of: civil) else { return 1 }
        return UInt8(recurrenceCalendar.component(.day, from: date))
    }

    static func shortLabel(_ value: FacetCommonWeekday) -> String {
        String(longLabel(value).prefix(1))
    }

    static func longLabel(_ value: FacetCommonWeekday) -> String {
        switch value {
        case .monday: "Monday"
        case .tuesday: "Tuesday"
        case .wednesday: "Wednesday"
        case .thursday: "Thursday"
        case .friday: "Friday"
        case .saturday: "Saturday"
        case .sunday: "Sunday"
        }
    }

    static func ordinalLabel(_ value: FacetMonthlyOrdinal) -> String {
        switch value {
        case .first: "First"
        case .second: "Second"
        case .third: "Third"
        case .fourth: "Fourth"
        case .fifth: "Fifth"
        case .last: "Last"
        }
    }

    static func monthLabel(_ month: UInt8) -> String {
        let symbols = recurrenceCalendar.monthSymbols
        let index = Int(month) - 1
        guard symbols.indices.contains(index) else { return "Month \(month)" }
        return symbols[index]
    }

    private static let weekdayByFoundationIndex: [Int: FacetCommonWeekday] = [
        1: .sunday,
        2: .monday,
        3: .tuesday,
        4: .wednesday,
        5: .thursday,
        6: .friday,
        7: .saturday,
    ]
}

enum FacetCivilDay {
    private static var iso: Date.ISO8601FormatStyle {
        Date.ISO8601FormatStyle(timeZone: .current).year().month().day()
    }
    static func iso(of date: Date) -> String { iso.format(date) }
    static func date(of civil: String) -> Date? {
        switch Result(catching: { try iso.parse(civil) }) {
        case .success(let date): date
        case .failure: nil
        }
    }
}
