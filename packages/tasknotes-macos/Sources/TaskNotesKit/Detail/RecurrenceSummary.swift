public import TaskNotesUniFFI

/// Everything the inspector can honestly say about a repeating task's rule.
///
/// ## 🔴 The rule itself is shown verbatim, and that is a reported gap
///
/// The core exports `recurrenceFrequency()`, `recurrenceFiniteInstanceCount()`,
/// `recurrenceIsExpandable()` and `recurrenceNextUncompletedOccurrence()` —
/// every one of which is a whole answer to a whole question — but it exports
/// **no human-readable summary of the rule**.
///
/// Building "Every 2 weeks on Mon, Wed" in Swift from `Frequency` alone is not
/// an option, and the reason is not effort. `Frequency` carries `FREQ` and
/// nothing else, so a Swift sentence assembled from it would silently drop
/// `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYSETPOS` and `UNTIL` — printing
/// "Weekly" over a rule that fires every *other* Tuesday. That is not a cosmetic
/// error: a user reading it would believe something false about when their task
/// repeats, and would only find out by missing it. Restating the RFC 5545
/// grammar on the Swift side is also exactly the duplication the shared core
/// exists to prevent — it is the 1Password failure mode, one layer down, and
/// Windows would need a third copy.
///
/// So this type deliberately **does not describe the rule**. It shows the raw
/// `RRULE` string, and around it only facts the core computed:
/// how many occurrences remain if the rule is finite, whether the core can
/// expand it at all, when the next open occurrence falls, and which date the
/// rule is measured from. ``needsCoreSummary`` marks the hole so it is visible
/// in the UI rather than only in this comment.
///
/// The ask is a `recurrence_summary(text, scheduled, date_created) -> String`
/// in `tasknotes-core`, validated against `@tasknotes/fixtures`' recurrence
/// corpus like every other recurrence answer. Until it lands, the rule row is
/// read-only apart from stopping the repetition, which needs no rule
/// construction at all.
public struct RecurrenceSummary: Sendable, Equatable {
    /// The stored rule, exactly as the vault holds it.
    ///
    /// Shown verbatim and monospaced. It is not friendly, and pretending
    /// otherwise is what this type refuses to do.
    public let rule: String

    /// How many occurrences the rule produces in total, when it is finite.
    ///
    /// `nil` means the rule never stops. Straight from
    /// `recurrenceFiniteInstanceCount`, which reads `COUNT` and `UNTIL` — two of
    /// the parts a Swift-side summary would have dropped.
    public let finiteInstanceCount: UInt32?

    /// Whether the core can expand the rule.
    ///
    /// `false` is the honest reading of a rule the engine cannot make sense of.
    /// It matters here because the recurrence engine **fails open** — an
    /// unparseable rule is treated as firing, so the task keeps appearing rather
    /// than vanishing — and without this flag the inspector would show a broken
    /// rule as if it were working.
    public let isExpandable: Bool

    /// The next occurrence that is neither completed nor skipped, if there is
    /// one.
    ///
    /// From `recurrenceNextUncompletedOccurrence`, so it accounts for
    /// `completeInstances` and `skippedInstances` — which a naive "next date
    /// after today" would not.
    public let next: DateBadge?

    /// Which date the rule is measured from.
    ///
    /// A closed two-case enum from the core, so offering it as a control
    /// reimplements nothing. An absent stored value reads as ``/scheduled``,
    /// which is the core's own documented reading and not a default invented
    /// here.
    public let anchor: RecurrenceAnchor

    /// Whether the stored anchor was absent, and this is therefore the core's
    /// reading rather than the user's choice.
    public let anchorIsImplied: Bool

    /// Always `true`, and it is a value rather than a comment so the gap is
    /// visible in the running app.
    ///
    /// The inspector renders it as the note explaining why the rule cannot be
    /// edited here. When `recurrence_summary()` lands this property and its
    /// note go away together.
    public var needsCoreSummary: Bool { true }

    /// Derive the summary for a task, or `nil` when it does not repeat.
    ///
    /// An **empty** `recurrence` is not a rule: the core reads it as the no-rule
    /// case, and treating `Some("")` as a rule is a mistake that only shows up
    /// on tasks somebody edited by hand in the vault.
    ///
    /// - Throws: `CoreError` when the core rejects the task's own stored
    ///   values. Loud on purpose — these came out of the core's own snapshot.
    public static func of(
        task: CoreTask,
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText()
    ) throws(CoreError) -> RecurrenceSummary? {
        guard let stored = task.recurrence, !stored.isEmpty else { return nil }

        let measuredFrom = task.recurrenceAnchor ?? .scheduled
        let count = try CoreErrors.rethrowingCore("counting the occurrences of \(task.id)") {
            try recurrenceFiniteInstanceCount(
                text: stored, scheduled: task.scheduled, dateCreated: task.dateCreated)
        }
        let upcoming = try CoreErrors.rethrowingCore("finding the next occurrence of \(task.id)") {
            try recurrenceNextUncompletedOccurrence(
                text: stored,
                scheduled: task.scheduled,
                dateCreated: task.dateCreated,
                today: calendar.today,
                anchor: measuredFrom,
                completeInstances: task.completeInstances,
                skippedInstances: task.skippedInstances
            )
        }

        return RecurrenceSummary(
            rule: stored,
            finiteInstanceCount: count,
            isExpandable: recurrenceIsExpandable(
                text: stored, scheduled: task.scheduled, dateCreated: task.dateCreated),
            next: try upcoming.map { date throws(CoreError) in
                try DateBadge.of(occurrence: date, calendar: calendar, text: text)
            },
            anchor: measuredFrom,
            anchorIsImplied: task.recurrenceAnchor == nil
        )
    }

    /// What the occurrence count says, in words.
    ///
    /// Only ever restates the core's number. "Repeats indefinitely" is the
    /// honest rendering of `nil`, which is what `COUNT`-less and `UNTIL`-less
    /// rules produce.
    public var occurrenceDescription: String {
        guard let finiteInstanceCount else { return "Repeats indefinitely" }
        return finiteInstanceCount == 1 ? "1 occurrence" : "\(finiteInstanceCount) occurrences"
    }

    /// The command that stops the task repeating.
    ///
    /// The one recurrence edit that is safe to offer without a rule summary,
    /// because it constructs no rule: `clear` deletes the frontmatter key, and
    /// the task becomes a plain one.
    ///
    /// The anchor is deliberately **not** cleared alongside it. It is a separate
    /// frontmatter key, clearing two keys in one gesture is more than the user
    /// asked for, and a leftover anchor on a non-repeating task means nothing to
    /// the core.
    public static var stopRepeating: TaskFieldEdit { .recurrence(nil) }
}
