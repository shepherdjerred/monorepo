import TaskNotesKit
import TaskNotesUniFFI

/// A task carrying the fields the inspector cares about.
///
/// Separate from `TestSupport`'s `coreTask`, which was shaped for list rows and
/// exposes neither `tags`, `timeEstimate` nor `details` — the three fields the
/// detail panel exists to edit. Widening the shared one would mean every list
/// test grew three parameters it does not use.
func detailTask(
    id: String,
    title: String,
    status: TaskStatus = .open,
    priority: Priority = .normal,
    due: String? = nil,
    scheduled: String? = nil,
    recurrence: String? = nil,
    recurrenceAnchor: RecurrenceAnchor? = nil,
    completeInstances: [String] = [],
    skippedInstances: [String] = [],
    projects: [ProjectName] = [],
    contexts: [ContextName] = [],
    tags: [TagName] = [],
    timeEstimate: UInt32? = nil,
    details: String? = nil,
    dateCreated: String? = nil
) -> CoreTask {
    CoreTask(
        id: id,
        path: id,
        title: title,
        status: status,
        priority: priority,
        due: due,
        scheduled: scheduled,
        contexts: contexts,
        projects: projects,
        tags: tags,
        recurrence: recurrence,
        recurrenceAnchor: recurrenceAnchor,
        completeInstances: completeInstances,
        skippedInstances: skippedInstances,
        completedDate: nil,
        dateCreated: dateCreated,
        dateModified: nil,
        timeEstimate: timeEstimate,
        timeEntries: [],
        blockedBy: [],
        reminders: [],
        archived: false,
        totalTrackedTime: 0,
        isBlocked: false,
        isBlocking: false,
        extraFields: "{}",
        details: details
    )
}

/// Where and when the inspector's tests stand.
///
/// A Wednesday in a real zone, pinned. Every date the panel shows is derived
/// against one of these, and a test that read the machine's clock would render
/// differently tomorrow — which is exactly the failure the pinning exists to
/// prevent.
let detailCalendar = fixedCalendar()

/// A row, derived the way a list derives it.
///
/// Through `TaskRowState` rather than by hand: `isCompleted`, the completion
/// target and the due badge are all core answers, and a fixture that set them
/// directly would describe a state the app cannot reach.
func detailRow(
    _ task: CoreTask,
    isPending: Bool = false
) throws(CoreError) -> TaskRowState {
    try TaskRowState(task: task, isPending: isPending, calendar: detailCalendar)
}
