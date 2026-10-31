public import TaskNotesUniFFI

// Native form values keep generated members behind the portable host seam.
public enum FacetCommonWeekday: String, Sendable, Hashable, CaseIterable {
    case monday, tuesday, wednesday, thursday, friday, saturday, sunday
    private static let mapping: [(Self, CommonWeekday)] = [
        (.monday, .monday), (.tuesday, .tuesday), (.wednesday, .wednesday),
        (.thursday, .thursday), (.friday, .friday), (.saturday, .saturday), (.sunday, .sunday),
    ]
    fileprivate var core: CommonWeekday {
        guard let pair = Self.mapping.first(where: { $0.0 == self }) else {
            preconditionFailure("Missing weekday host mapping")
        }
        return pair.1
    }
    fileprivate init(_ core: CommonWeekday) {
        guard let pair = Self.mapping.first(where: { $0.1 == core }) else {
            preconditionFailure("Unknown core weekday")
        }
        self = pair.0
    }
}
public enum FacetMonthlyOrdinal: String, Sendable, Hashable, CaseIterable {
    case first, second, third, fourth, fifth, last
    private static let mapping: [(Self, MonthlyOrdinal)] = [
        (.first, .first), (.second, .second), (.third, .third), (.fourth, .fourth),
        (.fifth, .fifth), (.last, .last),
    ]
    fileprivate var core: MonthlyOrdinal {
        guard let pair = Self.mapping.first(where: { $0.0 == self }) else {
            preconditionFailure("Missing ordinal host mapping")
        }
        return pair.1
    }
    fileprivate init(_ core: MonthlyOrdinal) {
        guard let pair = Self.mapping.first(where: { $0.1 == core }) else {
            preconditionFailure("Unknown core monthly ordinal")
        }
        self = pair.0
    }
}
public enum FacetRecurrenceAnchor: Sendable, Hashable { case scheduled, completion }
public enum FacetCommonRecurrencePattern: Sendable {
    case daily
    case weekly(weekdays: [FacetCommonWeekday])
    case monthlyDayOfMonth(day: UInt8)
    case monthlyOrdinalWeekday(ordinal: FacetMonthlyOrdinal, weekday: FacetCommonWeekday)
    case yearlyMonthDay(month: UInt8, day: UInt8)
    fileprivate var core: CommonRecurrencePattern {
        switch self {
        case .daily: .daily
        case .weekly(let weekdays): .weekly(weekdays: weekdays.map(\.core))
        case .monthlyDayOfMonth(let day): .monthlyDayOfMonth(day: day)
        case .monthlyOrdinalWeekday(let ordinal, let weekday):
            .monthlyOrdinalWeekday(ordinal: ordinal.core, weekday: weekday.core)
        case .yearlyMonthDay(let month, let day): .yearlyMonthDay(month: month, day: day)
        }
    }
    fileprivate init(_ value: CommonRecurrencePattern) {
        switch value {
        case .daily: self = .daily
        case .weekly(let days): self = .weekly(weekdays: days.map(FacetCommonWeekday.init))
        case .monthlyDayOfMonth(let day): self = .monthlyDayOfMonth(day: day)
        case .monthlyOrdinalWeekday(let ordinal, let day):
            self = .monthlyOrdinalWeekday(
                ordinal: FacetMonthlyOrdinal(ordinal), weekday: FacetCommonWeekday(day))
        case .yearlyMonthDay(let month, let day): self = .yearlyMonthDay(month: month, day: day)
        }
    }
}
public enum FacetCommonRecurrenceEnd: Sendable {
    case never
    case onDate(String)
    case afterOccurrences(UInt32)
    fileprivate var core: CommonRecurrenceEnd {
        switch self {
        case .never: .never
        case .onDate(let day): .onDate(day)
        case .afterOccurrences(let count): .afterOccurrences(count)
        }
    }
    fileprivate init(_ value: CommonRecurrenceEnd) {
        switch value {
        case .never: self = .never
        case .onDate(let day): self = .onDate(day)
        case .afterOccurrences(let count): self = .afterOccurrences(count)
        }
    }
}
public struct FacetCommonRecurrenceDraft: Sendable {
    public let interval: UInt32
    public let pattern: FacetCommonRecurrencePattern
    public let ending: FacetCommonRecurrenceEnd
    public init(
        interval: UInt32, pattern: FacetCommonRecurrencePattern, ending: FacetCommonRecurrenceEnd
    ) {
        self.interval = interval
        self.pattern = pattern
        self.ending = ending
    }
    fileprivate init(_ value: CommonRecurrenceDraft) {
        self.init(
            interval: value.interval, pattern: FacetCommonRecurrencePattern(value.pattern),
            ending: FacetCommonRecurrenceEnd(value.ending))
    }
}
public struct FacetRecurrenceEdit: Sendable {
    public let rule: String
    public let start: String
    public let anchor: FacetRecurrenceAnchor
    public let writesScheduled: Bool
    /// Decide the Scheduled field change off the UI actor, alongside rule construction.
    public static func requiresScheduledWrite(
        storedScheduled: String?, initialStart: String, selectedStart: String,
        startWasResolved: Bool, replacingUnsupported: Bool
    ) -> Bool {
        if !startWasResolved || storedScheduled?.isEmpty != false || selectedStart != initialStart {
            return true
        }
        // A replacement drops the old rule's inline DTSTART. Preserve its chosen
        // anchor without overwriting an already matching Scheduled date-time.
        return replacingUnsupported
            && recurrenceResolvedStart(
                text: "FREQ=DAILY", scheduled: storedScheduled, dateCreated: nil) != selectedStart
    }

    public static func build(
        draft: FacetCommonRecurrenceDraft, start: String, anchor: FacetRecurrenceAnchor,
        writesScheduled: Bool
    ) -> Result<Self, CoreError> {
        let common = CommonRecurrenceDraft(
            interval: draft.interval, pattern: draft.pattern.core, ending: draft.ending.core)
        return TaskRecurrenceEdit.build(
            draft: common, start: start, anchor: anchor == .scheduled ? .scheduled : .completion,
            writesScheduled: writesScheduled
        ).map {
            Self(
                rule: $0.rule, start: $0.start, anchor: anchor, writesScheduled: $0.writesScheduled)
        }
    }
}

public struct FacetRecurrenceProjection: Sendable {
    public let start: String
    public let hasResolvedStart: Bool
    public let editableDraft: FacetCommonRecurrenceDraft?
    public let summary: String?
    public static func load(rule: String?, scheduled: String?, dateCreated: String?, today: String)
        -> Self
    {
        let text = rule ?? ""
        // An empty core recurrence has no anchor. The fixed probe asks Rust for
        // the effective anchor of a newly selected repeat without persisting a rule.
        let probe = text.isEmpty ? "FREQ=DAILY" : text
        let planned = scheduled.flatMap { $0.isEmpty ? nil : $0 }
        let created = dateCreated.flatMap { $0.isEmpty ? nil : $0 }
        let coreStart = recurrenceResolvedStart(
            text: probe, scheduled: planned, dateCreated: created)
        let newWithoutAnchor = text.isEmpty && planned == nil && created == nil
        let resolvedStart =
            coreStart
            ?? (newWithoutAnchor
                ? recurrenceResolvedStart(text: probe, scheduled: today, dateCreated: nil) : nil)
        let editorStart = resolvedStart ?? today
        return Self(
            start: editorStart, hasResolvedStart: resolvedStart != nil,
            editableDraft: resolvedStart.flatMap {
                recurrenceParseCommon(text: probe, start: $0).map(FacetCommonRecurrenceDraft.init)
            },
            summary: rule.flatMap {
                recurrenceSummary(text: $0, scheduled: scheduled, dateCreated: dateCreated)
            })
    }
}
