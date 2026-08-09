public import TaskNotesUniFFI

/// What the core understood from a line of quick-add text.
///
/// ## Why the panel shows this at all
///
/// `Fix the boiler !high p:Admin @home tomorrow` is a syntax, and a syntax
/// nobody can see the result of is a syntax nobody learns. The inline compose
/// row in a list screen can get away with staying silent — the row appears in
/// the list a moment later and the list is right there to check. The floating
/// panel cannot: it is dismissed on Return and the window it was floating over
/// is usually not TaskNotes, so the created task is *never seen*. The preview
/// is what closes that loop, and it is the reason this type exists rather than
/// the panel simply calling ``QuickAdd/command(for:calendar:)`` on submit.
///
/// ## Nothing here parses anything
///
/// Every field below is a restatement of one `parseTaskInput` result. That is
/// the whole point: the same call the create command is built from is the call
/// the preview renders, so what the panel promises and what it creates cannot
/// disagree. A Swift-side "highlighter" that re-found the tokens with its own
/// regexes would be a second parser, one that would drift from the core's on
/// the first ambiguous input — and the React Native app's
/// `NaturalLanguageInput` is exactly that shape, which is why it is not what
/// was ported.
public struct QuickAddPreview: Sendable, Equatable {
    /// The title left after the recognised tokens were removed.
    ///
    /// Empty when the line is blank, or when it holds nothing but tokens —
    /// `!high @home` names a priority and a context and no task, and creating a
    /// task called "" from it would be worse than declining.
    public let title: String

    /// Everything the core recognised, in the order the panel prints it.
    public let marks: [QuickAddMark]

    /// Whether Return would create something.
    public var isSubmittable: Bool { !title.isEmpty }

    /// The preview for a line of typed text.
    ///
    /// A `Result` rather than `throws`, for the reason `TaskListModel.of` is:
    /// this is called from a SwiftUI `body`, which cannot `try`, and the failure
    /// is worth showing rather than swallowing — a date the core rejects is the
    /// one thing about a quick-add line the user most needs told before they
    /// press Return.
    public static func of(
        _ input: String,
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText()
    ) -> Result<QuickAddPreview, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> QuickAddPreview in
            try parsing(input, calendar: calendar, text: text)
        }
    }

    private static func parsing(
        _ input: String,
        calendar: ViewerCalendar,
        text: TaskDateText
    ) throws(CoreError) -> QuickAddPreview {
        let trimmed = input.trimmingWhitespace()
        guard !trimmed.isEmpty else { return QuickAddPreview(title: "", marks: []) }

        let parsed = try CoreErrors.rethrowingCore("parsing \(trimmed)") {
            try parseTaskInput(input: trimmed, today: calendar.today)
        }
        return QuickAddPreview(
            title: parsed.title.trimmingWhitespace(),
            marks: try marks(of: parsed, calendar: calendar, text: text)
        )
    }

    /// The recognised tokens, in a fixed reading order.
    ///
    /// Date first, then priority, then the three name lists, then the rule.
    /// Fixed rather than "the order they were typed", because the panel is read
    /// at a glance and a row of marks whose positions moved with the wording
    /// would have to be read word by word every time.
    private static func marks(
        of parsed: NlpParseResult,
        calendar: ViewerCalendar,
        text: TaskDateText
    ) throws(CoreError) -> [QuickAddMark] {
        var recognised: [QuickAddMark] = []
        if let due = parsed.due {
            // `of(occurrence:)` rather than `of(stored:)`: this date came out of
            // the core's own parser, so a value that does not read back as a
            // date is the core changing underneath us, not a human typing
            // something odd into frontmatter.
            let badge = try DateBadge.of(occurrence: due, calendar: calendar, text: text)
            recognised.append(QuickAddMark(kind: .due(badge), text: badge.text))
        }
        if let priority = parsed.priority {
            recognised.append(
                QuickAddMark(
                    kind: .priority(priority),
                    text: priorityLabel(priority: priority)
                )
            )
        }
        // `projectDisplayName` is the core's, and it is not cosmetic: a project
        // is stored as `[[Admin]]` or as a vault path, and printing either
        // verbatim in a chip would show the user something they did not type.
        recognised += (parsed.projects ?? []).map {
            QuickAddMark(kind: .project, text: projectDisplayName(value: $0))
        }
        recognised += (parsed.contexts ?? []).map { QuickAddMark(kind: .context, text: $0) }
        recognised += (parsed.tags ?? []).map { QuickAddMark(kind: .tag, text: $0) }
        if let recurrence = parsed.recurrence, !recurrence.isEmpty {
            // ⚠️ Unreachable today, and kept anyway. The core's parser
            // recognises no recurrence phrase — `nlp/mod.rs` sets the field to
            // `None` with a comment saying so — but the field is part of
            // `NlpParseResult`, and a preview that dropped a value the core
            // handed it would go quietly wrong on the day it starts filling it
            // in. Cheaper to be right now than to remember later.
            //
            // Verbatim, and deliberately so — the same stance
            // `RecurrenceSummary` takes, for the same reason: the core exports
            // no human-readable summary of an `RRULE`, and one assembled in
            // Swift from `FREQ` alone would silently drop `INTERVAL` and
            // `BYDAY` and tell the user something false about when their task
            // repeats.
            recognised.append(QuickAddMark(kind: .recurrence, text: recurrence))
        }
        return recognised
    }
}

/// One thing the core recognised in a quick-add line.
public struct QuickAddMark: Sendable, Equatable, Identifiable {
    /// Which kind of token this is, carrying whatever the renderer needs.
    ///
    /// The payloads exist so the panel can draw a recognised priority with the
    /// *same* mark a task row draws — the exclamation ramp, never a colour — and
    /// a recognised date with the same emphasis a row's date badge gets. A chip
    /// that invented its own vocabulary would teach a second one.
    public enum Kind: Sendable, Equatable {
        /// A due date, already bucketed and worded by the core and the locale.
        case due(DateBadge)
        /// A priority. Drawn as a mark, never as a colour.
        case priority(Priority)
        case project
        case context
        case tag
        /// A recurrence rule, shown verbatim.
        case recurrence
    }

    public let kind: Kind

    /// What the mark prints.
    public let text: String

    public var id: String { "\(key).\(text)" }

    /// The SF Symbol beside the text, or `nil` when the kind draws its own.
    ///
    /// `nil` for priority because a priority mark *is* a glyph — the same
    /// `exclamationmark.3` ramp a task row uses — and pairing it with a second
    /// icon would put two symbols on one chip.
    public var systemImage: String? {
        switch kind {
        case .due: "calendar"
        case .priority: nil
        case .project: "folder"
        case .context: "at"
        case .tag: "number"
        case .recurrence: "repeat"
        }
    }

    /// What VoiceOver says instead of reading a bare word out of context.
    public var spoken: String {
        switch kind {
        case .due(let badge): badge.isOverdue ? "Due \(text), late" : "Due \(text)"
        case .priority: "\(text) priority"
        case .project: "Project \(text)"
        case .context: "Context \(text)"
        case .tag: "Tag \(text)"
        case .recurrence: "Repeats: \(text)"
        }
    }

    private var key: String {
        switch kind {
        case .due: "due"
        case .priority: "priority"
        case .project: "project"
        case .context: "context"
        case .tag: "tag"
        case .recurrence: "recurrence"
        }
    }
}
