public import TaskNotesUniFFI

/// Turning what the user typed into a create command.
///
/// The parsing is entirely the core's `parseTaskInput`, which is the same
/// natural-language pass the React Native quick-add box runs — so
/// `Pay rent tomorrow !high #home` means the same thing on both clients,
/// including the parts that are arbitrary (which sigil is a project, whether a
/// bare weekday means this week or next).
public enum QuickAdd {
    /// The create command for a line of typed text, or `nil` when the line is
    /// only whitespace.
    ///
    /// `nil` rather than a thrown error for an empty line, because pressing
    /// Return in an empty field is not a mistake to report — it is a gesture
    /// that means nothing yet.
    ///
    /// - Throws: `CoreError` when the core cannot parse the input at all.
    ///   Surfaced rather than degraded to a plain-title create: silently
    ///   dropping the date the user typed is worse than saying it was not
    ///   understood.
    public static func command(
        for input: String,
        calendar: ViewerCalendar
    ) throws(CoreError) -> CommandInput? {
        let trimmed = input.trimmingWhitespace()
        guard !trimmed.isEmpty else { return nil }

        let parsed = try CoreErrors.rethrowingCore("parsing \(trimmed)") {
            try parseTaskInput(input: trimmed, today: calendar.today)
        }
        return .create(
            payload: CreateTaskRequest(
                title: parsed.title,
                details: nil,
                status: nil,
                priority: parsed.priority,
                due: parsed.due,
                scheduled: nil,
                contexts: parsed.contexts,
                projects: parsed.projects,
                tags: parsed.tags,
                recurrence: parsed.recurrence,
                recurrenceAnchor: nil,
                timeEstimate: nil,
                extraFields: nil
            )
        )
    }

    /// ``command(for:calendar:)``, as a `Result`.
    ///
    /// See `TaskListModel.of` for why the wrapping happens in this module rather
    /// than at the SwiftUI call site.
    public static func parsing(
        _ input: String,
        calendar: ViewerCalendar
    ) -> Result<CommandInput?, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> CommandInput? in
            try command(for: input, calendar: calendar)
        }
    }
}

extension String {
    /// Whitespace and newlines trimmed from both ends.
    ///
    /// Spelled here rather than reaching for Foundation's
    /// `trimmingCharacters(in: .whitespacesAndNewlines)` so this file needs no
    /// Foundation import at all; `Character.isWhitespace` is the standard
    /// library's own Unicode property and covers the same set.
    public func trimmingWhitespace() -> String {
        String(drop(while: \.isWhitespace).reversed().drop(while: \.isWhitespace).reversed())
    }
}
