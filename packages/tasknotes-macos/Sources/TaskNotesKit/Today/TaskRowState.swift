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

    /// The occurrence date a completion gesture targets, for a recurring task;
    /// `nil` for a plain one, whose gesture moves `status` and involves no date.
    ///
    /// Computed by the core's `recurrenceCompletionTargetDate`. See
    /// ``completionCommand`` for why it is never "today".
    public let completionTarget: String?

    /// The due date badge, or `nil` when the task has no readable due date.
    public let due: DateBadge?

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
    public var displayDate: DateBadge? { occurrence ?? due }

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
    /// - Throws: `CoreError` when the core rejects one of the task's own stored
    ///   values. That is a loud failure on purpose: the values reaching here
    ///   came out of the core's own snapshot, so a rejection means the vault
    ///   holds something the core cannot read, and rendering a plausible
    ///   fallback would hide it.
    public init(
        task: CoreTask,
        isPending: Bool,
        calendar: ViewerCalendar,
        text: TaskDateText = TaskDateText()
    ) throws(CoreError) {
        self.task = task
        self.isPending = isPending

        let rule = task.recurrence.flatMap { $0.isEmpty ? nil : $0 }
        self.isRecurring = rule != nil

        self.due = try DateBadge.of(stored: task.due, calendar: calendar, text: text)

        if rule == nil {
            self.completionTarget = nil
            self.occurrence = nil
            // `is_completed` is the core's `!is_active`, and asking for the
            // negation of the exported predicate is not a reimplementation of
            // it — restating the two-of-six membership in a Swift switch would
            // be.
            self.isCompleted = !taskStatusIsActive(status: task.status)
        } else {
            let target = try CoreErrors.rethrowingCore(
                "resolving the occurrence a completion on \(task.id) targets"
            ) {
                try recurrenceCompletionTargetDate(
                    scheduled: task.scheduled,
                    due: task.due,
                    anchor: task.recurrenceAnchor,
                    today: calendar.today
                )
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
