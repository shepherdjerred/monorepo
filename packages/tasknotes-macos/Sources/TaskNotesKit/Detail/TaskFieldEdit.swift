public import TaskNotesUniFFI

/// One committed field change, as the command that records it.
///
/// ## Editing is dispatch, and one field at a time
///
/// Every case below turns into `CommandInput.update`, which goes through
/// `TaskNotesStore.dispatch` into the offline queue and reconciles like any
/// other mutation. Nothing here mutates a `CoreTask`: the snapshot the UI reads
/// is the core's, and a local edit applied on top of it would be invisible to
/// the queue, lost on the next pull, and impossible to retry.
///
/// The inspector commits **per field** rather than staging a whole form behind
/// a Save button, which is the macOS idiom — Get Info, Xcode's inspectors, and
/// the Finder all behave this way. That choice is also what makes the
/// three-state payload safe, and this is the part worth reading twice.
///
/// ## `unchanged` / `clear` / `set`, and why absence is not emptiness
///
/// `UpdateTaskRequest`'s clearable fields are `TextUpdate`, `MinutesUpdate` and
/// `RecurrenceAnchorUpdate`, each with three states that mean three different
/// things **in the vault's frontmatter**:
///
/// | state       | wire        | effect on the note                    |
/// |-------------|-------------|---------------------------------------|
/// | `unchanged` | key absent  | the frontmatter key is left alone     |
/// | `clear`     | key `null`  | the frontmatter key is **deleted**    |
/// | `set`       | key + value | the key is written                    |
///
/// Confusing the first two is silent data loss: a form that spelled every field
/// on every save would send `clear` for each one the user never opened, and the
/// user's `due`, `recurrence` and `timeEstimate` would quietly disappear from
/// the note. Per-field commit removes the possibility rather than guarding
/// against it — each case below builds a payload in which **exactly one** field
/// is not `unchanged`, and ``UpdateTaskRequest/untouched`` is the only way any
/// of them is constructed.
///
/// ⚠️ The three list fields do **not** work this way, and the difference is a
/// trap. `projects`, `contexts` and `tags` are plain `[T]?`: `nil` is
/// *unchanged* and `[]` is *the empty list*, which is a real value meaning "this
/// task has no projects". So clearing a list is `set` to `[]`, never `nil` —
/// exactly inverted from the clearable fields above.
///
/// ⚠️ `title`, `status` and `priority` are `Optional` for the same
/// unchanged-means-absent reason, and the core documents that they **cannot be
/// cleared**. There is no `TaskFieldEdit` that clears a title; see
/// ``TaskTextEdit/retitling(_:of:)``.
public enum TaskFieldEdit: Sendable, Equatable {
    /// A new title. Never empty — the core cannot clear one.
    case title(TaskTitle)

    /// A new workflow status.
    case status(TaskStatus)

    /// A new priority.
    case priority(Priority)

    /// The due date as `YYYY-MM-DD`; `nil` deletes the key.
    case due(String?)

    /// The scheduled date as `YYYY-MM-DD`; `nil` deletes the key.
    case scheduled(String?)

    /// The full replacement project list; `[]` means "no projects".
    case projects([ProjectName])

    /// The full replacement context list; `[]` means "no contexts".
    case contexts([ContextName])

    /// The full replacement tag list; `[]` means "no tags".
    case tags([TagName])

    /// The RFC 5545 rule; `nil` stops the task repeating.
    case recurrence(String?)

    /// What the rule is measured from; `nil` deletes the key.
    case recurrenceAnchor(RecurrenceAnchor?)

    /// The estimate in whole minutes; `nil` deletes the key.
    case timeEstimate(UInt32?)

    /// The note body below the frontmatter; `nil` deletes it.
    case details(String?)

    /// The partial update this change sends.
    ///
    /// Exactly one field differs from ``UpdateTaskRequest/untouched``. The
    /// switch is exhaustive by construction — `default:` is banned in this
    /// package precisely so that a field added to the core becomes a compile
    /// error here rather than a field the inspector silently cannot edit.
    public var payload: UpdateTaskRequest {
        var request = UpdateTaskRequest.untouched
        switch self {
        case .title(let value): request.title = value
        case .status(let value): request.status = value
        case .priority(let value): request.priority = value
        case .due(let value): request.due = TextUpdate.of(value)
        case .scheduled(let value): request.scheduled = TextUpdate.of(value)
        case .projects(let value): request.projects = value
        case .contexts(let value): request.contexts = value
        case .tags(let value): request.tags = value
        case .recurrence(let value): request.recurrence = TextUpdate.of(value)
        case .recurrenceAnchor(let value):
            request.recurrenceAnchor = value.map { .set(value: $0) } ?? .clear
        case .timeEstimate(let value):
            request.timeEstimate = value.map { .set(value: $0) } ?? .clear
        case .details(let value): request.details = TextUpdate.of(value)
        }
        return request
    }

    /// The command that records this change against a task.
    ///
    /// The id is passed **unresolved**: the core resolves a temp id through its
    /// own alias map when the command is enqueued, so an inspector left open
    /// across the acknowledgement of the create that made the task keeps
    /// working.
    public func command(for taskId: TaskId) -> CommandInput {
        .update(taskId: taskId, payload: payload)
    }
}

/// One intentional recurrence configuration change.
///
/// Unlike an ordinary field edit, applying a recurrence may need to establish
/// its Scheduled start at the same time. Keeping these fields in one update
/// prevents a sync pass from ever seeing a rule with no anchor date. Every
/// unrelated field remains ``UpdateTaskRequest/untouched``.
public struct TaskRecurrenceEdit: Sendable, Equatable {
    /// The canonical RRULE produced by the shared core.
    public let rule: String

    /// The effective Scheduled start as an ISO civil date.
    public let start: String

    /// What subsequent occurrences are measured from.
    public let anchor: RecurrenceAnchor

    /// Whether the user changed Scheduled, or recurrence is establishing it.
    public let writesScheduled: Bool

    public init(rule: String, start: String, anchor: RecurrenceAnchor, writesScheduled: Bool) {
        self.rule = rule
        self.start = start
        self.anchor = anchor
        self.writesScheduled = writesScheduled
    }

    /// Validate and serialize a core draft before constructing the update.
    public static func build(
        draft: CommonRecurrenceDraft,
        start: String,
        anchor: RecurrenceAnchor,
        writesScheduled: Bool
    ) -> Result<Self, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> Self in
            let builtRule = try CoreErrors.rethrowingCore("building a recurrence rule") {
                try recurrenceBuildCommon(draft: draft, start: start)
            }
            return Self(
                rule: builtRule,
                start: start,
                anchor: anchor,
                writesScheduled: writesScheduled
            )
        }
    }

    /// The update touching only recurrence, its anchor, and when required its start.
    public var payload: UpdateTaskRequest {
        var request = UpdateTaskRequest.untouched
        request.recurrence = .set(value: rule)
        request.recurrenceAnchor = .set(value: anchor)
        if writesScheduled {
            request.scheduled = .set(value: start)
        }
        return request
    }

    /// The command that atomically records the recurrence configuration.
    public func command(for taskId: TaskId) -> CommandInput {
        .update(taskId: taskId, payload: payload)
    }
}

extension UpdateTaskRequest {
    /// A partial update that changes nothing.
    ///
    /// The base every edit is built from, and the reason no call site ever
    /// spells thirteen fields. Spelling them by hand is how a `clear` ends up
    /// where an `unchanged` belonged, which deletes a frontmatter key the user
    /// never touched.
    public static var untouched: Self {
        Self(
            title: nil,
            details: .unchanged,
            status: nil,
            priority: nil,
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
}

extension TextUpdate {
    /// `set` for a value, `clear` for `nil`.
    ///
    /// Never `unchanged`: this exists at the point where the user *did* say
    /// something about the field, and "the user cleared it" is the whole reason
    /// `clear` is distinguishable from absence.
    static func of(_ value: String?) -> TextUpdate {
        value.map { .set(value: $0) } ?? .clear
    }
}
