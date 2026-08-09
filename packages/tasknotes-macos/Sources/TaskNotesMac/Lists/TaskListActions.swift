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

    /// Put the caret in the toolbar's search field.
    ///
    /// Search is `⌘F` on the list you are already looking at, not a screen you
    /// navigate to. That is one of the translations the plan calls for: the
    /// React Native app pushes a whole `SearchScreen` because a phone has one
    /// column and no room for a field beside a title, while a Mac window has a
    /// toolbar and a Find command that every application already answers.
    let find: () -> Void

    /// Drop every filter and the search text.
    ///
    /// Reachable from the menu bar as well as the filter menu because a list
    /// narrowed to nothing is exactly the situation where the control that
    /// un-narrows it is hardest to find — and on a screen showing no rows, the
    /// filter menu is the only thing on it.
    let clearFilters: () -> Void

    /// Whether anything is selected, which is what makes the row commands
    /// applicable.
    let hasSelection: Bool

    /// Whether a pass is already running, which is what makes Refresh
    /// inapplicable.
    let isRefreshing: Bool

    /// Whether anything is being hidden, which is what makes Clear applicable.
    let isNarrowed: Bool
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
