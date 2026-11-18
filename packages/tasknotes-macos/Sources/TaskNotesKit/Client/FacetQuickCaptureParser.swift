import Foundation

/// Visual chip emitted by `FacetQuickCaptureParser` for live preview strips.
public struct FacetCaptureChip: Sendable, Equatable, Hashable, Identifiable {
    public enum Kind: String, Sendable, Equatable, Hashable {
        case date
        case recurrence
        case priority
        case project
        case label
    }

    public let kind: Kind
    public let text: String

    public var id: String { "\(kind.rawValue):\(text)" }

    public init(kind: Kind, text: String) {
        self.kind = kind
        self.text = text
    }
}

/// Complete parsed quick-capture result ready for previewing and task creation.
public struct FacetParsedCapture: Sendable, Equatable {
    public let title: String
    public let projectId: String
    public let sectionId: String?
    public let priority: Priority
    public let dueDate: String?
    public let dueDatetime: String?
    public let dueTimezone: String?
    public let dueString: String?
    public let recurrenceRule: String?
    public let labelIds: [String]
    public let unmatchedLabels: [String]
    public let chips: [FacetCaptureChip]

    public var isEmpty: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public func makeTaskAddArgs(description: String? = nil, parentId: String? = nil) -> TaskAddArgs
    {
        TaskAddArgs(
            title: title,
            project_id: projectId,
            section_id: sectionId,
            parent_id: parentId,
            description: description,
            priority: priority,
            child_order: nil,
            due_date: dueDate,
            due_datetime: dueDatetime,
            due_timezone: dueTimezone,
            due_string: dueString,
            recurrence_rule: recurrenceRule,
            label_ids: labelIds.isEmpty ? nil : labelIds
        )
    }
}

/// Pure-Swift Todoist-style natural-language quick capture parser.
public enum FacetQuickCaptureParser {
    internal struct CaptureWorkingState {
        var text: String
        var projectId: String
        var sectionId: String?
        var priority: Priority = .p4
        var labelIds: [String] = []
        var unmatchedLabels: [String] = []
        var chips: [FacetCaptureChip] = []
    }

    public static func parse(
        _ rawInput: String,
        projects: [Project] = [],
        sections: [Section] = [],
        labels: [Label] = [],
        defaultProjectId: String = "",
        calendar: ViewerCalendar = ViewerCalendar()
    ) -> FacetParsedCapture {
        var state = CaptureWorkingState(
            text: rawInput.trimmingCharacters(in: .whitespacesAndNewlines),
            projectId: defaultProjectId
        )
        let recurrence = extractRecurrence(from: &state.text)
        let explicitTime = extractClockTime(from: &state.text)
        let dateMatch = extractDatePhrase(from: &state.text, calendar: calendar)

        extractProjectAndSection(into: &state, projects: projects, sections: sections)
        extractLabels(into: &state, labels: labels)
        if let priority = extractPriority(from: &state.text) {
            state.priority = priority
            state.chips.append(FacetCaptureChip(kind: .priority, text: priority.rawValue))
        }

        return finalizeCapture(
            state: state,
            dateMatch: dateMatch,
            explicitTime: explicitTime,
            recurrence: recurrence,
            calendar: calendar
        )
    }

    private static func finalizeCapture(
        state: CaptureWorkingState,
        dateMatch: DatePhraseMatch?,
        explicitTime: ClockTime?,
        recurrence: String?,
        calendar: ViewerCalendar
    ) -> FacetParsedCapture {
        var chips = state.chips
        let resolvedDueDate = dateMatch?.civilDate ?? (recurrence != nil ? calendar.today : nil)
        let resolvedDueLabel = dateMatch?.label ?? (recurrence != nil ? "Today" : nil)
        var dueDatetime: String?
        if let civil = resolvedDueDate, let clock = explicitTime {
            dueDatetime = buildDueDatetime(
                civilDate: civil,
                clock: clock,
                timeZone: calendar.timeZone
            )
        }
        if let labelText = resolvedDueLabel {
            let timeSuffix = explicitTime.map { " \($0.display)" } ?? ""
            chips.append(FacetCaptureChip(kind: .date, text: labelText + timeSuffix))
        }
        if let rule = recurrence {
            chips.append(
                FacetCaptureChip(kind: .recurrence, text: FacetRecurrenceCodec.summary(for: rule))
            )
        }
        return FacetParsedCapture(
            title: collapseSpaces(state.text),
            projectId: state.projectId,
            sectionId: state.sectionId,
            priority: state.priority,
            dueDate: resolvedDueDate,
            dueDatetime: dueDatetime,
            dueTimezone: (resolvedDueDate != nil || dueDatetime != nil)
                ? calendar.timeZone.identifier : nil,
            dueString: dateMatch?.rawPhrase,
            recurrenceRule: recurrence,
            labelIds: state.labelIds,
            unmatchedLabels: state.unmatchedLabels,
            chips: chips
        )
    }

    private static func collapseSpaces(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private static func extractPriority(from text: inout String) -> Priority? {
        let pattern = #"(?:^|\s)(?:p|!)([1-4])(?=\s|$)"#
        guard let regex = findMatch(pattern: pattern, in: text, caseInsensitive: true) else {
            return nil
        }
        let digit = substring(in: text, range: regex.range(at: 1))
        replaceRange(regex.range, in: &text)
        let table: [String: Priority] = ["1": .p1, "2": .p2, "3": .p3, "4": .p4]
        return table[digit]
    }

    private static func extractProjectAndSection(
        into state: inout CaptureWorkingState,
        projects: [Project],
        sections: [Section]
    ) {
        let pattern = #"(?:^|\s)#(?:"([^"]+)"|([A-Za-z0-9_-]+))(?:/([A-Za-z0-9_-]+))?(?=\s|$)"#
        guard let match = findMatch(pattern: pattern, in: state.text, caseInsensitive: false) else {
            return
        }
        let quoted = substring(in: state.text, range: match.range(at: 1))
        let bare = substring(in: state.text, range: match.range(at: 2))
        let sectionName = substring(in: state.text, range: match.range(at: 3))
        let projectName = !quoted.isEmpty ? quoted : bare
        guard !projectName.isEmpty else { return }
        replaceRange(match.range, in: &state.text)

        let activeProjects = projects.filter { !$0.is_deleted && !$0.is_archived }
        guard
            let matchedProject = activeProjects.first(where: {
                $0.name.caseInsensitiveCompare(projectName) == .orderedSame
            })
        else {
            state.chips.append(FacetCaptureChip(kind: .project, text: "#\(projectName)"))
            return
        }
        state.projectId = matchedProject.id
        var chipLabel = "#\(matchedProject.name)"
        if !sectionName.isEmpty,
            let matchedSection = sections.first(where: {
                !$0.is_deleted && $0.project_id == matchedProject.id
                    && $0.name.caseInsensitiveCompare(sectionName) == .orderedSame
            })
        {
            state.sectionId = matchedSection.id
            chipLabel += "/\(matchedSection.name)"
        }
        state.chips.append(FacetCaptureChip(kind: .project, text: chipLabel))
    }

    private static func extractLabels(into state: inout CaptureWorkingState, labels: [Label]) {
        let pattern = #"(?:^|\s)@([A-Za-z0-9_-]+)(?=\s|$)"#
        let activeLabels = labels.filter { !$0.is_deleted }
        while let match = findMatch(pattern: pattern, in: state.text, caseInsensitive: false) {
            let labelName = substring(in: state.text, range: match.range(at: 1))
            replaceRange(match.range, in: &state.text)
            guard !labelName.isEmpty else { continue }
            if let existing = activeLabels.first(where: {
                $0.name.caseInsensitiveCompare(labelName) == .orderedSame
            }) {
                if !state.labelIds.contains(existing.id) {
                    state.labelIds.append(existing.id)
                }
                state.chips.append(FacetCaptureChip(kind: .label, text: "@\(existing.name)"))
            } else {
                let alreadyQueued = state.unmatchedLabels.contains {
                    $0.caseInsensitiveCompare(labelName) == .orderedSame
                }
                if !alreadyQueued {
                    state.unmatchedLabels.append(labelName)
                }
                state.chips.append(FacetCaptureChip(kind: .label, text: "@\(labelName)"))
            }
        }
    }

    private static func extractRecurrence(from text: inout String) -> String? {
        if let fixed = extractFixedRecurrence(from: &text) {
            return fixed
        }
        return extractParameterizedRecurrence(from: &text)
    }

    private static func extractFixedRecurrence(from text: inout String) -> String? {
        let fixedPatterns: [(String, String)] = [
            (#"(?:^|\s)every\s+(?:weekday|workday)s?(?=\s|$)"#, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"),
            (#"(?:^|\s)every\s+weekend(?=\s|$)"#, "FREQ=WEEKLY;BYDAY=SA,SU"),
            (#"(?:^|\s)(?:every\s+day|daily)(?=\s|$)"#, "FREQ=DAILY"),
            (#"(?:^|\s)(?:every\s+week|weekly)(?=\s|$)"#, "FREQ=WEEKLY"),
            (#"(?:^|\s)(?:every\s+month|monthly)(?=\s|$)"#, "FREQ=MONTHLY"),
            (#"(?:^|\s)(?:every\s+year|yearly|annually)(?=\s|$)"#, "FREQ=YEARLY"),
        ]
        for (pattern, rrule) in fixedPatterns {
            if let match = findMatch(pattern: pattern, in: text, caseInsensitive: true) {
                replaceRange(match.range, in: &text)
                return rrule
            }
        }
        return nil
    }

    private static func extractParameterizedRecurrence(from text: inout String) -> String? {
        let intervalPattern = #"(?:^|\s)every\s+(\d+)\s+(day|week|month|year)s?(?=\s|$)"#
        if let match = findMatch(pattern: intervalPattern, in: text, caseInsensitive: true),
            let count = Int(substring(in: text, range: match.range(at: 1))),
            count > 0
        {
            let unit = substring(in: text, range: match.range(at: 2)).lowercased()
            replaceRange(match.range, in: &text)
            let freq = frequencyCode(for: unit)
            return count == 1 ? "FREQ=\(freq)" : "FREQ=\(freq);INTERVAL=\(count)"
        }

        let dayTokens =
            "mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|"
            + "monday|tuesday|wednesday|thursday|friday|saturday|sunday"
        let weekdayListPattern =
            "(?:^|\\s)every\\s+((?:(?:\(dayTokens))(?:\\s*,\\s*|\\s+and\\s+|\\s+)?)+)(?=\\s|$)"
        if let match = findMatch(pattern: weekdayListPattern, in: text, caseInsensitive: true) {
            let list = substring(in: text, range: match.range(at: 1))
            let codes = parseWeekdayRRuleCodes(list)
            if !codes.isEmpty {
                replaceRange(match.range, in: &text)
                return "FREQ=WEEKLY;BYDAY=\(codes.joined(separator: ","))"
            }
        }
        return nil
    }

    private static func frequencyCode(for unit: String) -> String {
        let table = ["day": "DAILY", "week": "WEEKLY", "month": "MONTHLY"]
        return table[unit] ?? "YEARLY"
    }

    private static func parseWeekdayRRuleCodes(_ phrase: String) -> [String] {
        let tokens = phrase.lowercased().components(
            separatedBy: CharacterSet.alphanumerics.inverted
        )
        let mapping: [String: String] = [
            "mon": "MO", "monday": "MO",
            "tue": "TU", "tues": "TU", "tuesday": "TU",
            "wed": "WE", "wednesday": "WE",
            "thu": "TH", "thur": "TH", "thurs": "TH", "thursday": "TH",
            "fri": "FR", "friday": "FR",
            "sat": "SA", "saturday": "SA",
            "sun": "SU", "sunday": "SU",
        ]
        var codes: [String] = []
        for token in tokens where token != "and" && !token.isEmpty {
            if let code = mapping[token], !codes.contains(code) {
                codes.append(code)
            }
        }
        return codes
    }
}
