internal import SwiftUI
internal import TaskNotesKit

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

    /// What this screen would be kept as, if the reader asked for it.
    ///
    /// ## Why this travels on the focused value
    ///
    /// The control that keeps a view lives in the **sidebar**, next to the
    /// views it would join, while the query lives in the **detail pane**.
    /// `focusedSceneValue` is the seam that already connects those two for the
    /// menu bar, so the sidebar reads the frontmost screen's query the same way
    /// the Task menu reads its selection — rather than the window hoisting a
    /// copy of every screen's query into shared state.
    ///
    /// ## Why it is no longer optional
    ///
    /// It used to be `nil` on any screen that already carried a
    /// ``TaskListScope`` — a project, a context, a tag, another saved view —
    /// and the sidebar's `+` greyed out there. The reason was real: a saved
    /// view stored exactly one `FilterConfig`, two narrowings were in force,
    /// and merging them by concatenating each dimension turns an **and** into
    /// an **or** — a *Website* screen narrowed to *Admin* would have been kept
    /// as *"Website or Admin"*.
    ///
    /// The core now exports `FilterChain`, so the stored value is the whole
    /// stack joined by the core's own `and` and there is nothing left to merge.
    /// The composition happens in ``SavedViewDraft/init(scope:query:)``, which
    /// conjoins rather than combines, so every screen can be kept and the
    /// affordance is simply enabled.
    let saveableView: SavedViewDraft
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
