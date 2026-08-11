internal import SwiftUI
internal import TaskNotesKit

/// What the frontmost task list currently has selected, for the inspector.
///
/// ## Why a focused value rather than shared state
///
/// This is the same contract ``TaskListActions`` already uses, for the same
/// reason: the inspector is a property of a *window*, and a window inspects
/// whatever the list in front of the user has selected. A shared object would
/// make two windows fight over one selection, and it could never be absent — so
/// the inspector would keep showing a task from a window nobody is looking at.
///
/// `nil` is a real and frequent state: a Settings window is frontmost, or the
/// list has nothing selected. The inspector renders it as an empty state rather
/// than hiding, because a panel that vanishes teaches nobody where it went.
///
/// ## The rows are carried, not the ids
///
/// A ``TaskRowState`` already carries every derivation the inspector needs —
/// the completion target, the due badge, whether the rule fires — and every one
/// of those is a call into the Rust core. Passing ids would mean re-deriving all
/// of it a second time, against a second read of the clock, so a task could
/// legitimately read as overdue in the list and not overdue in the inspector.
/// Passing the derived rows makes that impossible by construction.
struct InspectorSubject: Equatable {
    /// The selected rows, in the order the list shows them.
    let rows: [TaskRowState]

    /// The single selected row, or `nil` for an empty or multiple selection.
    ///
    /// Editing needs exactly one subject: a form bound to two tasks would have
    /// to invent a reading for "two different titles", and every honest answer
    /// to that is a different screen.
    var single: TaskRowState? {
        rows.count == 1 ? rows.first : nil
    }
}

private struct InspectorSubjectKey: FocusedValueKey {
    typealias Value = InspectorSubject
}

extension FocusedValues {
    /// The frontmost task list's selection, if there is one.
    var inspectorSubject: InspectorSubject? {
        get { self[InspectorSubjectKey.self] }
        set { self[InspectorSubjectKey.self] = newValue }
    }
}

/// The window's inspector panel, as something a menu item can act on.
///
/// Published by ``RootView``, which owns the presentation state, and read by
/// the menu bar and by any list's context menu. Splitting it out means the
/// "Edit…" item in a row's context menu does not have to know where the panel
/// lives — it asks the frontmost window to reveal its own.
struct InspectorPresentation {
    /// Whether the panel is showing.
    let isPresented: Bool

    /// Show the panel, or hide it if it is already showing.
    let toggle: () -> Void

    /// Show the panel, without the hide half.
    ///
    /// What a row's "Edit…" command wants: choosing Edit on a task should never
    /// be the thing that closes the editor.
    let reveal: () -> Void
}

private struct InspectorPresentationKey: FocusedValueKey {
    typealias Value = InspectorPresentation
}

extension FocusedValues {
    /// The frontmost window's inspector panel, if it has one.
    var inspectorPresentation: InspectorPresentation? {
        get { self[InspectorPresentationKey.self] }
        set { self[InspectorPresentationKey.self] = newValue }
    }
}
