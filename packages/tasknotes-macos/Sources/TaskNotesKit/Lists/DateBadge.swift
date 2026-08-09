public import TaskNotesUniFFI

/// A task's date, as a row shows it.
///
/// The **bucket comes from the core** (`dateGroup`) and only the **words come
/// from Foundation**. That split is the plan's: bucketing is a decision every
/// client must agree on, and formatting is locale-bound and therefore the
/// shell's. A row that decided "overdue" by comparing strings in Swift would be
/// the 1Password failure mode in miniature.
public struct DateBadge: Sendable, Equatable {
    /// The civil date the stored value resolves to for this viewer,
    /// `YYYY-MM-DD`.
    public let date: String

    /// Which bucket the core sorts it into. Drives emphasis, never text.
    public let group: DateGroup

    /// What the row prints.
    public let text: String

    /// Whether the date has already passed, per the core's bucketing.
    ///
    /// Today is not overdue — a task due today is still due — which is the
    /// core's reading and not a judgement made here.
    public var isOverdue: Bool { group == .overdue }

    /// Derive a badge from a task's stored date value.
    ///
    /// A **factory rather than an `init?`**, because Swift cannot spell an
    /// initializer that is both failable and throwing, and the two failures
    /// here are genuinely different things that must not be collapsed:
    ///
    ///   * `nil` — the value is absent, or in no recognised shape. Normal. A
    ///     frontmatter date is whatever a human typed, and "there is no usable
    ///     date here" is a reading, not an error; the row shows no badge.
    ///   * `throws` — the *viewer's* calendar is unusable: a UTC offset outside
    ///     ±24h, or a malformed today. That is a caller contract violation and
    ///     is reported rather than rendered as a missing badge.
    public static func of(
        stored: String?,
        calendar: ViewerCalendar,
        text formatter: TaskDateText
    ) throws(CoreError) -> DateBadge? {
        guard let stored else { return nil }
        let civil = try CoreErrors.rethrowingCore("reading the date \(stored)") {
            try dateParseLocal(raw: stored, viewerUtcOffsetSeconds: calendar.utcOffsetSeconds)
        }
        guard let resolved = civil else { return nil }
        let bucket = try CoreErrors.rethrowingCore("grouping the date \(resolved)") {
            try dateGroup(date: resolved, today: calendar.today)
        }
        return DateBadge(
            date: resolved,
            group: bucket,
            text: try Self.words(for: bucket, on: resolved, formatter: formatter)
        )
    }

    /// The badge for a date the **core computed**, which must therefore render.
    ///
    /// ``of(stored:calendar:text:)`` answers `nil` for "there is no usable date
    /// here", which is the right reading of whatever a human typed into
    /// frontmatter. A recurrence's completion target is not that: it comes back
    /// from `recurrenceCompletionTargetDate` as a `YYYY-MM-DD` the core has
    /// already validated, and the core documents that a bare date parses to
    /// itself without consulting the viewer's offset at all.
    ///
    /// So `nil` here is not "no date", it is "the core changed underneath us" —
    /// and it is reported rather than rendered as a missing badge, because a
    /// recurring row silently losing its date is precisely the defect this
    /// factory exists to close.
    public static func of(
        occurrence: String,
        calendar: ViewerCalendar,
        text formatter: TaskDateText
    ) throws(CoreError) -> DateBadge {
        guard let badge = try of(stored: occurrence, calendar: calendar, text: formatter) else {
            throw CoreError.Invariant(
                message: "the completion target \(occurrence) did not read back as a date"
            )
        }
        return badge
    }

    private init(date: String, group: DateGroup, text: String) {
        self.date = date
        self.group = group
        self.text = text
    }

    /// The badge's text for a bucket.
    ///
    /// `Today` and `Tomorrow` come from the core's own heading strings, so both
    /// clients say the same words. `ThisWeek` deliberately does **not** — its
    /// heading is "This Week", which is right above a grouped section and
    /// useless on a single row, where the weekday is what a reader wants.
    /// `Overdue` and `Later` are dates, which the core states explicitly are
    /// the shell's to format.
    private static func words(
        for group: DateGroup,
        on date: String,
        formatter: TaskDateText
    ) throws(CoreError) -> String {
        switch group {
        case .overdue, .later:
            return try formatter.monthAndDay(date)
        case .thisWeek:
            return try formatter.weekday(date)
        case .today, .tomorrow:
            // Not a defensive fallback: `dateGroupHeading` is documented to
            // answer `nil` for exactly one case, `Later`, which this branch
            // cannot be. A `??` here would hide a core change instead of
            // reporting it.
            guard let heading = dateGroupHeading(group: group) else {
                throw CoreError.Invariant(
                    message: "the core supplied no heading for \(group), which only Later lacks"
                )
            }
            return heading
        }
    }
}
