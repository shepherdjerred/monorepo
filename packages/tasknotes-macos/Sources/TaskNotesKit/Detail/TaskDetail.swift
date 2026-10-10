public import TaskNotesUniFFI

/// One task, as the inspector shows it.
///
/// ## Derived from the row, not from the task
///
/// The inspector is handed the ``TaskRowState`` the list already built, and
/// everything the two surfaces share is read off that one value rather than
/// recomputed. That is not a saving, it is a correctness property: the row's
/// completion target, due badge and recurring-or-not are all core answers taken
/// against a specific ``ViewerCalendar``, and deriving them a second time — a
/// few milliseconds later, possibly across midnight — would let the same task
/// read as overdue in the list and not overdue in the panel beside it.
///
/// What this type adds is only what a row has no room for: the scheduled date,
/// the recurrence summary, the parsed note body, and the two labels the core
/// spells for us.
public struct TaskDetail: Sendable, Equatable, Identifiable {
    /// The row this was derived from, and the task inside it.
    public let row: TaskRowState

    /// The calendar every date below was derived against.
    public let calendar: ViewerCalendar

    /// The scheduled-date badge, or `nil` when there is no readable one.
    ///
    /// A row shows one date; the inspector shows both, because this is where
    /// somebody comes to find out *why* a task is on today's list — and for a
    /// recurring task the answer is almost always `scheduled` rather than `due`.
    public let scheduled: DateBadge?

    /// The rule summary, or `nil` when the task does not repeat.
    public let recurrence: RecurrenceSummary?

    /// The note body, parsed for display.
    public let body: MarkdownBody

    /// The status, as the core spells it.
    public let statusText: String

    /// The priority, as the core spells it.
    public let priorityText: String

    public var task: CoreTask { row.task }
    public var id: TaskId { row.id }

    /// The due-date badge, straight from the row.
    public var due: DateBadge? { row.due }

    /// Whether the task repeats.
    public var isRecurring: Bool { row.isRecurring }

    /// Derive the inspector's state from a row.
    ///
    /// - Throws: `CoreError` when the core rejects one of the task's own stored
    ///   values. Loud on purpose, for the same reason ``TaskRowState`` is: these
    ///   values came out of the core's own snapshot, so a rejection means the
    ///   vault holds something the core cannot read.
    public static func build(
        row: TaskRowState,
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText()
    ) throws(CoreError) -> TaskDetail {
        let subject = row.task
        return TaskDetail(
            row: row,
            calendar: calendar,
            scheduled: try DateBadge.of(stored: subject.scheduled, calendar: calendar, text: text),
            recurrence: try RecurrenceSummary.of(task: subject, calendar: calendar, text: text),
            body: try MarkdownBody.of(source: subject.details ?? ""),
            statusText: taskStatusLabel(status: subject.status),
            priorityText: priorityLabel(priority: subject.priority)
        )
    }

    /// ``build(row:calendar:text:)``, as a `Result`.
    ///
    /// A SwiftUI `body` cannot `try`, and a closure written inside a
    /// `@MainActor` view infers `any Error` as its thrown type, which no longer
    /// converts to a `throws(CoreError)` parameter. Doing the conversion inside
    /// this module keeps the typed error all the way to the view.
    public static func of(
        row: TaskRowState,
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText()
    ) -> Result<TaskDetail, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> TaskDetail in
            try build(row: row, calendar: calendar, text: text)
        }
    }
}
