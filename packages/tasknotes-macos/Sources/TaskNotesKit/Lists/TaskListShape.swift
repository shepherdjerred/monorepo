public import TaskNotesUniFFI

/// The four list screens, expressed as the handful of things that differ
/// between them.
///
/// ## Why one shape rather than four screens
///
/// Today, Inbox and Upcoming are near-identical in the React Native app —
/// three copies of a filter bar, a list, a floating action button and a bulk
/// action bar, differing in a predicate and two strings. Browse adds a filter
/// and sort surface that all three already had. Copying `TodayView` three times
/// would have made every subsequent row change a four-file edit, and the row is
/// the part of this app most likely to change.
///
/// So the screens are **configurations, not implementations**. What genuinely
/// varies is enumerated here and nowhere else:
///
///   * which tasks belong (``admits(_:calendar:)``),
///   * whether rows are grouped under day headings (``isGrouped``),
///   * where the list starts sorted (``defaultSort``),
///   * what the heading and the empty state say.
///
/// Everything else — the row, the compose field, the context menu, multi-select,
/// the sync banner, filtering, sorting, search — is the same code on all four.
///
/// ## Parameterized on ``SidebarSection`` on purpose
///
/// A separate `TaskListKind` enum would have to be kept in step with the
/// sidebar's four destinations by hand, and the compiler would not notice when
/// it drifted. There is exactly one set of list screens in this app, the
/// sidebar already names it, and both are exhaustively matched.
extension SidebarSection {
    /// Whether rows are grouped under headings the core's `dateGroup` supplies.
    ///
    /// Only Upcoming. The other three are one flat list — a Today screen split
    /// into "Overdue" and "Today" reads as two screens sharing a scroll view,
    /// and Inbox is undated by construction.
    public var isGrouped: Bool {
        switch self {
        case .upcoming: true
        case .today, .inbox, .browse: false
        }
    }

    /// Where the list starts sorted, or `nil` for the order the core produced.
    ///
    /// ⚠️ `nil` is a real answer and not a missing default. The core carries
    /// list order in an `IndexMap`, that order is the user's, and three of the
    /// four screens have no business overriding it:
    ///
    ///   * **Today** is a short list whose order the Phase 8 design pinned, with
    ///     a test that says so.
    ///   * **Inbox** holds tasks with no date at all, so a due-date sort would
    ///     order them by nothing.
    ///   * **Upcoming** takes its chronology from its day headings, so sorting
    ///     the rows underneath them by date again would say the same thing
    ///     twice.
    ///
    /// **Browse** is the screen whose whole subject is the corpus, so it starts
    /// where the React Native app's `DEFAULT_SORT` starts. On every screen the
    /// sort is the user's to change, and "As Synced" — this `nil` — is one of
    /// the choices offered.
    public var defaultSort: SortConfig? {
        switch self {
        case .today, .inbox, .upcoming: nil
        case .browse: SortConfig(field: .dueDate, direction: .asc)
        }
    }

    /// How far ahead Upcoming looks.
    ///
    /// Unbounded, which is the React Native reading for dated tasks and the
    /// only one that gives the far end of the agenda anywhere to appear. It
    /// costs nothing for recurring tasks either, because a rule contributes
    /// exactly one row — its next uncompleted occurrence — rather than an
    /// expansion that would have to be bounded to terminate.
    ///
    /// A property rather than a literal so that a horizon control, if one is
    /// ever wanted, has one place to change.
    public var horizon: UpcomingHorizon {
        switch self {
        case .upcoming: .unbounded
        // Not "no horizon": the other three never ask the question, and a
        // sentinel would be a fourth state that means nothing.
        case .today, .inbox, .browse: .unbounded
        }
    }

    /// The screen's title line.
    ///
    /// Today is the one screen whose subject is a *day*, so the day is the
    /// heading and the destination's name would be redundant above a window
    /// title that already says it. The other three are named collections, and
    /// their name is the honest heading.
    func heading(
        on calendar: ViewerCalendar,
        text: TaskDateText
    ) throws(CoreError) -> String {
        switch self {
        case .today: try text.dayHeading(calendar.today)
        case .inbox, .upcoming, .browse: title
        }
    }

    /// Whether this task belongs on this screen, and which occurrence the row
    /// is about when it does.
    ///
    /// Every clause routes through the core. Nothing here decides what "active"
    /// means, when a rule fires, which day a stored value falls on, or what
    /// counts as upcoming — those are the four answers a shared core exists to
    /// give once, and the four that produced *"different search results in a
    /// different order"* when 1Password wrote them per platform.
    ///
    /// - Returns: ``TaskAdmission/excluded``, or ``TaskAdmission/included(about:)``
    ///   carrying the occurrence this screen is showing the task for — `nil`
    ///   for "whatever the core's completion target says", which is what every
    ///   screen but Upcoming means.
    /// - Throws: `CoreError` when the core rejects the viewer's calendar or one
    ///   of the task's own stored values.
    func admits(
        _ task: CoreTask,
        calendar: ViewerCalendar
    ) throws(CoreError) -> TaskAdmission {
        // `/v2` list responses include archived tasks, matching the plugin;
        // every screen filters them client-side.
        guard !task.archived else { return .excluded }

        switch self {
        case .today: return try admitsOnToday(task, calendar: calendar)
        case .inbox: return try admitsInInbox(task, calendar: calendar)
        case .upcoming: return try admitsOnUpcoming(task, calendar: calendar)
        // Browse is the unfiltered corpus, completed tasks included: it is the
        // only screen where the status filter has anything to bite on, and a
        // "browse everything" list that silently hides two of six statuses is
        // not browsing everything.
        case .browse: return .included(about: nil)
        }
    }

    /// Today: due today, already overdue, or a rule that fires today.
    ///
    /// The split matters and is easy to get wrong. A recurring task is usually
    /// scheduled-only with **no due date at all**, so a due-date test alone
    /// hides every repeating task on the screen whose entire job is to show
    /// them.
    ///
    /// The recurring branch keeps the row visible even when today's occurrence
    /// is already checked off, which is deliberate: completing an occurrence
    /// mutates `completeInstances` and not `status`, so the task stays live,
    /// and the row staying put is what makes the completion feel like it landed
    /// rather than like the task vanished.
    private func admitsOnToday(
        _ task: CoreTask,
        calendar: ViewerCalendar
    ) throws(CoreError) -> TaskAdmission {
        guard taskStatusIsActive(status: task.status) else { return .excluded }

        if let rule = task.recurrenceRule {
            // The active-status guard above still applies, and has to: checking
            // off an occurrence does not change `status`, so a *globally* done
            // or cancelled recurring task must not reappear every time its rule
            // fires.
            let fires = try CoreErrors.rethrowingCore("expanding the rule on \(task.id)") {
                try recurrenceOccursOn(
                    text: rule,
                    scheduled: task.scheduled,
                    dateCreated: task.dateCreated,
                    date: calendar.today
                )
            }
            return fires ? .included(about: nil) : .excluded
        }

        guard let due = try task.civilDue(calendar) else { return .excluded }
        let belongs = try CoreErrors.rethrowingCore("bucketing the due date on \(task.id)") {
            try dateIsToday(date: due, today: calendar.today)
                || dateIsOverdue(date: due, today: calendar.today)
        }
        return belongs ? .included(about: nil) : .excluded
    }

    /// Inbox: everything the user has told the app nothing about.
    ///
    /// ⚠️ **Stricter than the React Native screen, deliberately.** There the
    /// test is `projects.length === 0`, which puts a task with a project-free
    /// title, a context, a due date and a weekly rule into the triage bucket —
    /// a task that is, by any reading, already triaged. Inbox is worth having
    /// only if reaching zero means something, and it cannot mean anything while
    /// fully-organized tasks keep landing in it.
    ///
    /// So the test is *no organizing metadata of any kind*: no project, no
    /// context, no date the core can read on either field, and no recurrence
    /// rule. A date the core **cannot** read — `due: someday`, typed by hand
    /// into frontmatter — counts as no date, which is right: that is a task
    /// needing attention, and Inbox is where attention is paid.
    private func admitsInInbox(
        _ task: CoreTask,
        calendar: ViewerCalendar
    ) throws(CoreError) -> TaskAdmission {
        guard taskStatusIsActive(status: task.status),
            task.projects.isEmpty,
            task.contexts.isEmpty,
            task.recurrenceRule == nil,
            try task.civilDue(calendar) == nil,
            try task.civilScheduled(calendar) == nil
        else { return .excluded }
        return .included(about: nil)
    }

    /// Upcoming: the forward agenda, today excluded.
    ///
    /// Today is excluded because it has a screen of its own — that is the
    /// core's own reading of `is_upcoming`, not a second opinion formed here.
    ///
    /// ⚠️ **A recurring task appears at its next uncompleted occurrence, and on
    /// this screen the checkbox completes that occurrence.** Everywhere else a
    /// completion targets `recurrenceCompletionTargetDate` — the *current*
    /// occurrence, which may be in the past. On a forward-looking agenda that
    /// would put a row under "Friday" whose checkbox silently completed
    /// Tuesday, which is exactly the drawn-versus-acted disagreement the row
    /// design forbids. The row is about the occurrence the screen is showing,
    /// so the gesture is too; ``TaskAdmission/included(about:)`` is how that
    /// travels.
    private func admitsOnUpcoming(
        _ task: CoreTask,
        calendar: ViewerCalendar
    ) throws(CoreError) -> TaskAdmission {
        guard taskStatusIsActive(status: task.status) else { return .excluded }

        if let rule = task.recurrenceRule {
            let next = try CoreErrors.rethrowingCore("finding the next occurrence of \(task.id)") {
                try recurrenceNextUncompletedOccurrence(
                    text: rule,
                    scheduled: task.scheduled,
                    dateCreated: task.dateCreated,
                    today: calendar.today,
                    anchor: task.recurrenceAnchor ?? .scheduled,
                    completeInstances: task.completeInstances,
                    skippedInstances: task.skippedInstances
                )
            }
            guard let next, try isUpcoming(next, calendar: calendar) else { return .excluded }
            return .included(about: next)
        }

        guard let due = try task.civilDue(calendar), try isUpcoming(due, calendar: calendar) else {
            return .excluded
        }
        return .included(about: nil)
    }

    private func isUpcoming(
        _ date: String,
        calendar: ViewerCalendar
    ) throws(CoreError) -> Bool {
        try CoreErrors.rethrowingCore("deciding whether \(date) is upcoming") {
            try dateIsUpcoming(date: date, today: calendar.today, horizon: horizon)
        }
    }
}

/// Whether a screen takes a task, and which occurrence it takes it for.
enum TaskAdmission: Sendable, Equatable {
    /// The task does not belong on this screen.
    case excluded

    /// The task belongs.
    ///
    /// - Parameter about: the occurrence the row is about, or `nil` to let
    ///   ``TaskRowState`` resolve the core's own completion target — which is
    ///   what every screen except Upcoming means.
    case included(about: String?)
}

extension CoreTask {
    /// The recurrence rule, or `nil` when there is not one.
    ///
    /// An *empty* `recurrence` is not recurring — the core reads it as the
    /// no-rule case, and treating `Some("")` as a rule is a mistake that only
    /// shows up on tasks somebody edited by hand in the vault.
    var recurrenceRule: String? {
        recurrence.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The civil day this task's `due` value falls on for this viewer, or `nil`
    /// when there is no value or it is in no shape the core recognises.
    func civilDue(_ calendar: ViewerCalendar) throws(CoreError) -> String? {
        try Self.civil(due, calendar: calendar, what: "the due date on \(id)")
    }

    /// The civil day this task's `scheduled` value falls on for this viewer.
    func civilScheduled(_ calendar: ViewerCalendar) throws(CoreError) -> String? {
        try Self.civil(scheduled, calendar: calendar, what: "the scheduled date on \(id)")
    }

    private static func civil(
        _ stored: String?,
        calendar: ViewerCalendar,
        what: String
    ) throws(CoreError) -> String? {
        guard let stored else { return nil }
        return try CoreErrors.rethrowingCore("reading \(what)") {
            try dateParseLocal(raw: stored, viewerUtcOffsetSeconds: calendar.utcOffsetSeconds)
        }
    }
}
