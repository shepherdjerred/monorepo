public import TaskNotesUniFFI

/// One task, as a row renders it.
///
/// Everything here is *derived*, and every derivation is a call into the Rust
/// core. Nothing in this file decides what a date means, whether a rule fires,
/// or which status counts as finished — those are the answers a shared core
/// exists to give once. What this type adds is only the shape: a flat value a
/// SwiftUI row can read without calling across the FFI on every redraw, which
/// SwiftUI would otherwise do dozens of times per scroll.
public struct TaskRowState: Sendable, Equatable, Identifiable {
    /// The task, exactly as the core produced it.
    public let task: CoreTask

    /// Whether an unacknowledged command is queued against this task.
    public let isPending: Bool

    /// Whether the task repeats.
    ///
    /// An *empty* `recurrence` is not recurring — the core reads it as the
    /// no-rule case, and treating `Some("")` as a rule is a mistake that only
    /// shows up on tasks somebody edited by hand in the vault.
    public let isRecurring: Bool

    /// Whether the row reads as done **right now**.
    ///
    /// For a recurring task this is the state of the occurrence a click would
    /// target, not of the task as a whole — so the checkbox and the gesture can
    /// never disagree about which thing they are talking about. That agreement
    /// is the entire point of routing both through ``completionTarget``.
    public let isCompleted: Bool

    /// Whether this row is no longer live work — for either of the two
    /// unrelated reasons it can stop being so.
    ///
    /// ⚠️ **Two facts, and reading only one of them was a bug.** A row can be
    /// finished because *the occurrence shown* was ticked (``isCompleted``,
    /// which for a recurring task is the state of the occurrence a click would
    /// target), or because *the task itself* is in a terminal status. For a
    /// plain task the two coincide, which is what makes the divergence easy to
    /// miss. For a recurring one they are independent — ``isCompleted`` reads
    /// `completeInstances` and never `status` — so a **cancelled or done
    /// recurring task drew exactly like a live one**, struck through nowhere.
    ///
    /// Only Browse can show it: Today and Upcoming filter terminal tasks out,
    /// so neither screen the row was designed against could reveal it.
    ///
    /// ## Why this lives here rather than in the view that reads it
    ///
    /// It was a `private var` on `TaskRowView` first. That put it above the
    /// SwiftUI line, where the only coverage available is an image snapshot a
    /// human has to look at — and the plan is explicit that the Linux row is
    /// the sole *enforced* gate, so correctness belongs below that line
    /// wherever it can go. Here it is a pure function of a `CoreTask` and one
    /// core call, and a headless test pins all four combinations.
    ///
    /// ## The Kanban card deliberately does not use this
    ///
    /// A board's column already states the status, so spending the
    /// strikethrough on it too would be redundant. A list has no column, so
    /// there the strikethrough is the only channel "not live work" has and it
    /// carries both reasons. Same two facts, different channel budgets — the
    /// divergence is deliberate and neither file should be "fixed" to match the
    /// other. The checkbox stays occurrence-level on both, because the gesture
    /// is.
    public var isRetired: Bool {
        isCompleted || isTerminal
    }

    /// Whether the **task itself** is in a terminal status — the second of the
    /// two facts ``isRetired`` combines, on its own.
    ///
    /// This is what a Kanban card keys its strikethrough on, and it is here for
    /// the reason ``isRetired`` is: it was a `private var` on `KanbanCardView`
    /// first, which put it above the SwiftUI line where an image a human looks
    /// at is the only coverage available. Both halves now sit below it, and the
    /// relationship between them — `isRetired == isCompleted || isTerminal` —
    /// is a property a headless test can state rather than a coincidence two
    /// view files have to maintain separately.
    ///
    /// It is deliberately the *same word* ``KanbanColumn/isTerminal`` uses, and
    /// the same core predicate behind it. A board's column **is** a status, so
    /// "this task is terminal" and "this column is terminal" are one question
    /// asked of two things — and a card is struck through exactly when the
    /// column it sits in is terminal, which is the invariant the board's whole
    /// channel split rests on.
    ///
    /// `taskStatusIsActive` negated, never a list of "finished-ish" statuses
    /// restated here: which two of the six count as terminal is the core's
    /// answer, and Rust is where it is given once.
    public var isTerminal: Bool {
        !taskStatusIsActive(status: task.status)
    }

    /// The occurrence date a completion gesture targets, for a recurring task;
    /// `nil` for a plain one, whose gesture moves `status` and involves no date.
    ///
    /// Computed by the core's `recurrenceCompletionTargetDate`. See
    /// ``completionCommand`` for why it is never "today".
    public let completionTarget: String?

    /// The due date badge, or `nil` when the task has no readable due date.
    public let due: DateBadge?

    /// The scheduled date badge, or `nil` when the task has no readable
    /// scheduled date.
    ///
    /// Separate from ``due`` rather than folded into it because they are
    /// different claims — a deadline and a plan — and the one surface that
    /// edits a date edits `due` alone.
    public let scheduled: DateBadge?

    /// ``completionTarget`` as the row prints it; `nil` for a plain task.
    ///
    /// Derived from the same string in the same branch, so the words a reader
    /// sees and the date a click writes cannot drift apart. That pairing is the
    /// whole reason this exists rather than the view formatting the target
    /// itself.
    public let occurrence: DateBadge?

    /// The date the row shows.
    ///
    /// **A recurring task is usually `scheduled`-only, with no due date at
    /// all** — which is exactly why it is on the Today screen, since the filter
    /// admits it because its *rule* fires today. Printing `due` alone therefore
    /// left the one column that explains the row's presence empty on precisely
    /// the rows whose date is the reason they are there. The occurrence is that
    /// date, and it is also the date the checkbox acts on.
    ///
    /// **A plain task can be `scheduled`-only too** — work planned for a day
    /// with no deadline attached — and that is the date Today and Upcoming
    /// admitted it on, so it is the date the row owes the reader. The fallback
    /// order is `due` before `scheduled` because
    /// ``CoreTask/civilEffectiveDate(_:)`` decides membership in that order,
    /// and on a grouped screen this badge *is* the day heading the row files
    /// under: printing a different field than the screen judged would put the
    /// row under a day it does not claim.
    public var displayDate: DateBadge? { occurrence ?? due ?? scheduled }

    public var id: TaskId { task.id }

    /// The command a completion gesture on this row dispatches.
    ///
    /// ⚠️ **A recurring task completes its scheduled occurrence, never the day
    /// of the click.** A rule that fires on the 1st, completed on the 12th,
    /// must record `…-01`: the plugin reads an occurrence as done only when
    /// that occurrence's own date is in `completeInstances`, so a `…-12` entry
    /// is orphaned against a day the rule never fires on, the occurrence still
    /// reads as open, and the task reappears as if untouched. That was a live
    /// bug in the React Native app.
    ///
    /// A plain task takes `taskStatusNext`, which is the core's toggle policy
    /// rather than this layer's — everything unfinished becomes done, and
    /// everything else reopens.
    public var completionCommand: CommandInput {
        guard let completionTarget else {
            return .setStatus(taskId: task.id, status: taskStatusNext(status: task.status))
        }
        return .setInstanceComplete(
            taskId: task.id, date: completionTarget, completed: !isCompleted)
    }

    /// The command that deletes this row's task.
    public var deleteCommand: CommandInput { .delete(taskId: task.id) }

    /// The command that gives this row's task a priority.
    public func priorityCommand(_ priority: Priority) -> CommandInput {
        .update(taskId: task.id, payload: UpdateTaskRequest.settingPriority(priority))
    }

    /// The command that schedules this row's task for `date`, as `YYYY-MM-DD`.
    public func scheduleCommand(due date: String?) -> CommandInput {
        .update(taskId: task.id, payload: UpdateTaskRequest.settingDue(date))
    }

    /// Derive a row from a task.
    ///
    /// - Parameters:
    ///   - task: the task, exactly as the core produced it.
    ///   - isPending: whether an unacknowledged command is queued against it.
    ///   - calendar: where and when the viewer is.
    ///   - text: the locale formatter; injected so a test can pin a locale.
    ///   - occurrence: the occurrence this row is **about**, for a recurring
    ///     task, or `nil` to use the core's own completion target.
    ///
    ///     ⚠️ Not a convenience. Upcoming shows a recurring task at its *next*
    ///     occurrence, and the row's date and its checkbox must agree about
    ///     which occurrence that is — a row printing "Friday" whose checkbox
    ///     completes last Tuesday is the exact drawn-versus-acted disagreement
    ///     ``completionCommand`` exists to prevent. Supplying the date here
    ///     routes the badge, the completion state and the command through one
    ///     value, so they cannot come apart. It is ignored for a plain task,
    ///     which has no occurrences to be about.
    /// - Throws: `CoreError` when the core rejects one of the task's own stored
    ///   values. That is a loud failure on purpose: the values reaching here
    ///   came out of the core's own snapshot, so a rejection means the vault
    ///   holds something the core cannot read, and rendering a plausible
    ///   fallback would hide it.
    public init(
        task: CoreTask,
        isPending: Bool,
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText(),
        about occurrence: String? = nil
    ) throws(CoreError) {
        self.task = task
        self.isPending = isPending

        let rule = task.recurrenceRule
        self.isRecurring = rule != nil

        self.due = try DateBadge.of(stored: task.due, calendar: calendar, text: text)
        self.scheduled = try DateBadge.of(stored: task.scheduled, calendar: calendar, text: text)

        if rule == nil {
            self.completionTarget = nil
            self.occurrence = nil
            // `is_completed` is the core's `!is_active`, and asking for the
            // negation of the exported predicate is not a reimplementation of
            // it — restating the two-of-six membership in a Swift switch would
            // be.
            self.isCompleted = !taskStatusIsActive(status: task.status)
        } else {
            // Spelled out rather than `occurrence ?? try …`: a `??` whose
            // right-hand side throws widens the expression's thrown type back
            // to `any Error`, which no longer converts to this initializer's
            // `throws(CoreError)`.
            let target: String
            if let occurrence {
                target = occurrence
            } else {
                target = try CoreErrors.rethrowingCore(
                    "resolving the occurrence a completion on \(task.id) targets"
                ) {
                    try recurrenceCompletionTargetDate(
                        scheduled: task.scheduled,
                        due: task.due,
                        anchor: task.recurrenceAnchor,
                        today: calendar.today
                    )
                }
            }
            self.completionTarget = target
            self.occurrence = try DateBadge.of(
                occurrence: target, calendar: calendar, text: text)
            self.isCompleted = task.completeInstances.contains(target)
        }
    }
}

extension UpdateTaskRequest {
    /// A partial update that touches priority and nothing else.
    ///
    /// The core's update request is genuinely three-state — `TextUpdate` has
    /// `unchanged`, `clear` and `set` — so "leave it alone" is expressible and
    /// there is no risk of a partial edit silently clearing a field it did not
    /// mention. Spelling all thirteen fields at each call site would bury that.
    public static func settingPriority(_ priority: Priority) -> Self {
        Self(
            title: nil,
            details: .unchanged,
            status: nil,
            priority: priority,
            due: .unchanged,
            scheduled: .unchanged,
            contexts: nil,
            projects: nil,
            tags: nil,
            recurrence: .unchanged,
            recurrenceAnchor: .unchanged,
            timeEstimate: .unchanged,
            extraFields: nil
        )
    }

    /// A partial update that sets or clears the due date and nothing else.
    ///
    /// `nil` is `clear`, not `unchanged` — "no date" is a thing a user asks
    /// for, and the three-state type is what makes the difference sayable.
    public static func settingDue(_ date: String?) -> Self {
        Self(
            title: nil,
            details: .unchanged,
            status: nil,
            priority: nil,
            due: date.map { .set(value: $0) } ?? .clear,
            scheduled: .unchanged,
            contexts: nil,
            projects: nil,
            tags: nil,
            recurrence: .unchanged,
            recurrenceAnchor: .unchanged,
            timeEstimate: .unchanged,
            extraFields: nil
        )
    }
}
