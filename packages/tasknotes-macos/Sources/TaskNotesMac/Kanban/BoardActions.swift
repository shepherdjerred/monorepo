internal import SwiftUI
internal import TaskNotesKit

/// What the menu bar can ask the frontmost board to do.
///
/// ## This is the keyboard half of drag-and-drop, and it is not optional
///
/// Dragging a card between columns is the interaction the board exists for on a
/// desktop — it was impractical on touch, which is why the React Native board
/// has a "Move to…" submenu and no gesture. But a drag is a **pointer-only**
/// affordance: VoiceOver cannot perform one, a keyboard cannot perform one, and
/// XCUITest cannot synthesize one. A board whose only route between columns was
/// a drag would be a feature a whole class of users does not have.
///
/// So there are three routes to the same command, and all three dispatch the
/// identical `CommandInput.setStatus`:
///
///   1. drag a card onto a column,
///   2. a card's context menu → **Move to ▸**,
///   3. **Task ▸ Move Left / Move Right**, at `⌃⌘←` and `⌃⌘→`, which is this
///      type.
///
/// `⌃⌘←/→` rather than a plainer binding because `⌘←/→` is line-start and
/// line-end inside any text field on screen, and `⌥⌘←/→` is tab switching in
/// most browsers and in Xcode. `⌃⌘` with an arrow is unclaimed on macOS and
/// reads as "move the thing" — it is what Mission Control uses for moving
/// between spaces with a window in tow.
///
/// Published as a `@FocusedValue` for the same reason ``TaskListActions`` is:
/// the menu bar is one thing and there can be many windows, so a command must
/// act on the window in front of the user and be **disabled, never hidden**
/// when no window can service it.
struct BoardActions {
    /// Whether a card is selected at all — what makes the items applicable.
    let hasSelection: Bool

    /// Whether there is a column that way. Deliberately `false` at the ends
    /// rather than wrapping: a card in the last column pressed rightwards
    /// should stay put, because a wrap silently turns "advance this" into "send
    /// it back to the start" at the moment a reader stops watching.
    let canMove: (KanbanDirection) -> Bool

    /// Move the selected card one column that way.
    let move: (KanbanDirection) -> Void
}

private struct BoardActionsKey: FocusedValueKey {
    typealias Value = BoardActions
}

extension FocusedValues {
    /// The frontmost board's action surface, if there is one.
    var boardActions: BoardActions? {
        get { self[BoardActionsKey.self] }
        set { self[BoardActionsKey.self] = newValue }
    }
}
