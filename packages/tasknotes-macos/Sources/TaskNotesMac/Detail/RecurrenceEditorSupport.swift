internal import TaskNotesUniFFI

internal import struct Foundation.Calendar
internal import struct Foundation.Date

enum RecurrenceCadence: String, CaseIterable, Identifiable {
    case daily
    case weekly
    case monthly
    case yearly

    var id: Self { self }
    var label: String { rawValue.capitalized }
}

enum RecurrenceMonthlyMode: String, CaseIterable, Identifiable {
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

enum RecurrenceEnding: String, CaseIterable, Identifiable {
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

struct RecurrencePatternSeed {
    var cadence = RecurrenceCadence.daily
    var weekdays: Set<CommonWeekday> = []
    var monthlyMode = RecurrenceMonthlyMode.dayOfMonth
    var monthDay: UInt8
    var ordinal = MonthlyOrdinal.first
    var ordinalWeekday: CommonWeekday
    var yearlyMonth: UInt8
    var yearlyDay: UInt8

    init(pattern: CommonRecurrencePattern, start: String) {
        monthDay = RecurrenceEditorSheet.day(of: start)
        ordinalWeekday = RecurrenceEditorSheet.weekday(of: start)
        yearlyMonth = RecurrenceEditorSheet.month(of: start)
        yearlyDay = RecurrenceEditorSheet.day(of: start)
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
            weekdays = [RecurrenceEditorSheet.weekday(of: start)]
        }
    }
}

struct RecurrenceEndingSeed {
    let ending: RecurrenceEnding
    let date: Date
    let count: UInt32

    init(ending: CommonRecurrenceEnd, startDate: Date) {
        switch ending {
        case .never:
            self.ending = .never
            date = startDate
            count = 10
        case .onDate(let endDate):
            self.ending = .onDate
            date = CivilDay.date(of: endDate) ?? startDate
            count = 10
        case .afterOccurrences(let occurrences):
            self.ending = .afterOccurrences
            date = startDate
            count = occurrences
        }
    }
}

extension RecurrenceEditorSheet {
    static let allWeekdays: [CommonWeekday] = [
        .monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday,
    ]

    static let allOrdinals: [MonthlyOrdinal] = [
        .first, .second, .third, .fourth, .fifth, .last,
    ]

    static func weekday(of civil: String) -> CommonWeekday {
        guard let date = CivilDay.date(of: civil) else { return .monday }
        return weekdayByFoundationIndex[Calendar.current.component(.weekday, from: date)]
            ?? .monday
    }

    static func month(of civil: String) -> UInt8 {
        guard let date = CivilDay.date(of: civil) else { return 1 }
        return UInt8(Calendar.current.component(.month, from: date))
    }

    static func day(of civil: String) -> UInt8 {
        guard let date = CivilDay.date(of: civil) else { return 1 }
        return UInt8(Calendar.current.component(.day, from: date))
    }

    static func shortLabel(_ value: CommonWeekday) -> String {
        String(longLabel(value).prefix(1))
    }

    static func longLabel(_ value: CommonWeekday) -> String {
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

    static func ordinalLabel(_ value: MonthlyOrdinal) -> String {
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
        let symbols = Calendar.current.monthSymbols
        let index = Int(month) - 1
        guard symbols.indices.contains(index) else { return "Month \(month)" }
        return symbols[index]
    }

    private static let weekdayByFoundationIndex: [Int: CommonWeekday] = [
        1: .sunday,
        2: .monday,
        3: .tuesday,
        4: .wednesday,
        5: .thursday,
        6: .friday,
        7: .saturday,
    ]
}
