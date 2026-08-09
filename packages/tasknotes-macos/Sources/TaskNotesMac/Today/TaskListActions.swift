internal import SwiftUI

/// What the menu bar can ask the frontmost task list to do.
///
/// ## Why a focused value and not a shared object
///
/// The menu bar is one thing and there can be many windows. A menu item must
/// act on the window the user is looking at and must be **disabled, never
/// hidden** when no window can service it. `@FocusedValue` is exactly that
/// contract: the frontmost scene publishes its capabilities, the commands read
/// them, and `nil` means "there is no list in front of you", which renders as
/// greyed out rather than absent.
///
/// A singleton would get both halves wrong — it would act on whichever window
/// registered last, and it would never be absent, so the items would stay
/// enabled over a Settings window that cannot possibly complete a task.
struct TaskListActions {
    let newTask: () -> Void
    let refresh: () -> Void
    let complete: () -> Void
    let delete: () -> Void

    /// Whether anything is selected, which is what makes the row commands
    /// applicable.
    let hasSelection: Bool

    /// Whether a pass is already running, which is what makes Refresh
    /// inapplicable.
    let isRefreshing: Bool
}

private struct TaskListActionsKey: FocusedValueKey {
    typealias Value = TaskListActions
}

extension FocusedValues {
    /// The frontmost task list's action surface, if there is one.
    var taskListActions: TaskListActions? {
        get { self[TaskListActionsKey.self] }
        set { self[TaskListActionsKey.self] = newValue }
    }
}
