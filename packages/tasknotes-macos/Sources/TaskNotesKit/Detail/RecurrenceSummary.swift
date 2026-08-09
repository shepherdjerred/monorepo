public import TaskNotesUniFFI

/// Everything the inspector can honestly say about a repeating task's rule.
///
/// ## Every sentence here is the core's
///
/// Nothing in this type describes a rule. `recurrenceSummary()` turns the
/// normalised rule into "Every 2 weeks on Mon, Wed"; the rest of the properties
/// are single answers to single questions the core also owns — whether it can
/// expand the rule, when the next open occurrence falls, how long the series is
/// when that is knowable, and which date it is measured from.
///
/// That division is not tidiness. `Frequency` carries `FREQ` and nothing else,
/// so a sentence assembled in Swift would silently drop `INTERVAL`, `BYDAY`,
/// `BYMONTHDAY`, `BYSETPOS` and `UNTIL` — printing "Weekly" over a rule that
/// fires every *other* Tuesday. A user reading that believes something false
/// about when their task repeats and finds out by missing it. Restating RFC 5545
/// per platform is also the 1Password failure mode one layer down, with Windows
/// needing a third copy.
public struct RecurrenceSummary: Sendable, Equatable {
    /// The stored rule, exactly as the vault holds it.
    ///
    /// Kept even when ``description`` is present, because they answer different
    /// questions — one is what the vault says, the other is what it means — and
    /// because it is what ``description``'s absence falls back to.
    public let rule: String

    /// The rule as a sentence, or `nil` when the core declines to write one.
    ///
    /// Straight from `recurrenceSummary`. `nil` means **show ``rule``
    /// verbatim**, matching what `recurrenceFrequency` already asks of a caller,
    /// and it covers three situations a reader should see identically: the rule
    /// is empty, unparsable or has no resolvable `DTSTART`; it uses a part with
    /// no unambiguous one-line reading; or it fires zero times. The core
    /// declining is deliberate — a wrong summary is strictly worse than none.
    public let description: String?

    /// How many occurrences the rule produces in total, when that is a knowable
    /// number.
    ///
    /// ⚠️ **`nil` does not mean "never stops."** Straight from
    /// `recurrenceFiniteInstanceCount`, whose own documentation lists four
    /// situations it conflates — unbounded, an `UNTIL` before the `DTSTART`
    /// (an *empty* series), a series past the reference's 10,000-instance
    /// ceiling, and a `COUNT` that is not a number, which in fact fires exactly
    /// once. See ``occurrenceDescription`` for what is drawn instead.
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
            description: recurrenceSummary(
                text: stored, scheduled: task.scheduled, dateCreated: task.dateCreated),
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

    /// What the occurrence count says, in words, or `nil` when there is nothing
    /// to say.
    ///
    /// ## Why `nil` is drawn as nothing rather than as "Repeats indefinitely"
    ///
    /// It used to say exactly that, and it was wrong in three of the four
    /// situations `recurrenceFiniteInstanceCount` returns `nil` for. With
    /// ``description`` now present the error became visible rather than merely
    /// latent: a `FREQ=DAILY;COUNT=abc` task drew **"Repeats indefinitely"**
    /// beside **"Every day, once"**, two lines of the same panel contradicting
    /// each other about the same rule.
    ///
    /// The two functions are not equally reliable and the fix is to say so
    /// rather than to average them. ``description`` is read off the *normalised*
    /// rule — the same option set that decides which days the engine emits, so
    /// it cannot disagree with the list. The count is read out of the raw text
    /// with a digits-only regex, faithfully reproducing
    /// `getFiniteRecurringInstanceCount` from `@tasknotes/model`, and it gives
    /// up on inputs the expansion handles fine.
    ///
    /// So the **summary is the authority on whether and when a rule stops**, and
    /// this is a supplementary number shown only when it is one. The count is
    /// deliberately not "fixed" to agree: `@tasknotes/model` is a third-party
    /// package this repository does not own, `@tasknotes/fixtures` records its
    /// answers — `0313-malformed-freq-daily-count-abc` pins
    /// `finiteInstanceCount: null` beside `occurrenceCount: 1` — and moving the
    /// Rust would make the corpus disagree with the oracle that generates it.
    ///
    /// Nothing is lost by drawing nothing: an unbounded rule's sentence already
    /// ends without a bound clause, which is how "Every day" says it forever.
    public var occurrenceDescription: String? {
        guard let finiteInstanceCount else { return nil }
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
