public import TaskNotesUniFFI

/// What the Today screen shows, derived from one store snapshot.
///
/// ## The filter is the React Native app's, expressed in core calls
///
/// `useTasks.todayTasks` is the specification: not archived, still active, and
/// then a split — a **recurring** task is included when the core says its rule
/// has an occurrence today, and a **plain** one when its due date is today or
/// already past. The split matters and is easy to get wrong: a recurring task
/// is usually scheduled-only with no due date at all, so a due-date test alone
/// hides every repeating task on the screen whose entire job is to show them.
///
/// The recurring branch keeps the row visible **even when today's occurrence is
/// already checked off**, which is deliberate: completing an occurrence mutates
/// `completeInstances` and not `status`, so the task stays live, and the row
/// staying put is what makes the completion feel like it landed rather than
/// like the task vanished.
///
/// ## Order is never touched
///
/// The rows come out in exactly the order the core produced them. That order is
/// the user's — the core carries it in an `IndexMap` and it crosses the FFI as
/// an ordered `Vec` — and a tidying sort on this side would silently override
/// it on every screen at once. This type filters and derives; it does not
/// reorder, and there is a test that says so.
public struct TodayList: Sendable, Equatable {
    /// The calendar every row below was derived against.
    ///
    /// Carried rather than re-read so the heading, the buckets, and the
    /// completion targets are all answers about the same instant.
    public let calendar: ViewerCalendar

    /// The rows, in the core's order.
    public let rows: [TaskRowState]

    /// `Wednesday, July 22` — the screen's day heading.
    public let heading: String

    /// `No tasks` / `1 task` / `7 tasks` — the count beside the heading.
    ///
    /// The React Native app's exact wording, because it is the same product.
    public var countLabel: String {
        switch rows.count {
        case 0: "No tasks"
        case 1: "1 task"
        case let count: "\(count) tasks"
        }
    }

    public var isEmpty: Bool { rows.isEmpty }

    /// Derive the screen from a snapshot.
    ///
    /// - Parameters:
    ///   - tasks: `TaskNotesStore.tasks`, in the core's order.
    ///   - pendingTaskIds: `TaskNotesStore.pendingTaskIds`.
    ///   - calendar: where and when the viewer is.
    ///   - text: the locale formatter; injected so a test can pin a locale.
    /// - Returns: the screen, with its rows in the core's order.
    /// - Throws: `CoreError` when the core rejects the viewer's calendar or one
    ///   of the tasks' own stored values.
    public static func build(
        tasks: [CoreTask],
        pendingTaskIds: [TaskId],
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText()
    ) throws(CoreError) -> TodayList {
        // A set, because `pendingTaskIds` is scanned once per surviving task
        // and a linear search would make a large vault quadratic on every
        // keystroke that redraws the list.
        let pending = Set(pendingTaskIds)
        var included: [TaskRowState] = []
        for task in tasks where try belongsOnToday(task, calendar: calendar) {
            included.append(
                try TaskRowState(
                    task: task,
                    isPending: pending.contains(task.id),
                    calendar: calendar,
                    text: text
                )
            )
        }
        return TodayList(
            calendar: calendar,
            rows: included,
            heading: try text.dayHeading(calendar.today)
        )
    }

    /// ``build(tasks:pendingTaskIds:calendar:text:)``, as a `Result`.
    ///
    /// A SwiftUI `body` cannot `try`, and a helper that wraps the throwing call
    /// at the call site does not compile: a closure written inside a
    /// `@MainActor` view infers `any Error` as its thrown type, which no longer
    /// converts to the `throws(CoreError)` parameter. Doing the conversion here,
    /// inside the module where isolation is uniform, keeps the typed error all
    /// the way to the view — which is the whole reason it is typed.
    public static func of(
        tasks: [CoreTask],
        pendingTaskIds: [TaskId],
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText()
    ) -> Result<TodayList, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> TodayList in
            try build(
                tasks: tasks, pendingTaskIds: pendingTaskIds, calendar: calendar, text: text)
        }
    }

    /// Whether a task belongs on the Today screen.
    ///
    /// Every clause is a call into the core. Nothing here knows what "active"
    /// means, what a recurrence rule does, or how a stored date resolves to a
    /// civil day — those are the three answers that would otherwise be written
    /// once per platform.
    private static func belongsOnToday(
        _ task: CoreTask,
        calendar: ViewerCalendar
    ) throws(CoreError) -> Bool {
        // `/v2` list responses include archived tasks, matching the plugin;
        // every screen filters them client-side.
        guard !task.archived, taskStatusIsActive(status: task.status) else { return false }

        if let rule = task.recurrence, !rule.isEmpty {
            // The active-status guard above still applies, and has to: checking
            // off an occurrence does not change `status`, so a *globally* done
            // or cancelled recurring task must not reappear every time its rule
            // fires.
            return try CoreErrors.rethrowingCore("expanding the rule on \(task.id)") {
                try recurrenceOccursOn(
                    text: rule,
                    scheduled: task.scheduled,
                    dateCreated: task.dateCreated,
                    date: calendar.today
                )
            }
        }

        guard let due = task.due else { return false }
        let civil = try CoreErrors.rethrowingCore("reading the due date on \(task.id)") {
            try dateParseLocal(raw: due, viewerUtcOffsetSeconds: calendar.utcOffsetSeconds)
        }
        guard let resolved = civil else { return false }
        return try CoreErrors.rethrowingCore("bucketing the due date on \(task.id)") {
            try dateIsToday(date: resolved, today: calendar.today)
                || dateIsOverdue(date: resolved, today: calendar.today)
        }
    }
}
