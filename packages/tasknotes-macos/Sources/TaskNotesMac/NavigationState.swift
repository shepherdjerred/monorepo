public import Observation
public import TaskNotesKit

public import struct Foundation.URL

/// Which sidebar destination is selected, and nothing else.
///
/// Phase 7 is the shell only. The real `@Observable` store over the Rust core —
/// tasks, filters, sync status — arrives in Phase 8 and will sit alongside this
/// rather than inside it: navigation is a property of the window, task data is
/// a property of the vault, and conflating them is what makes a store
/// impossible to test.
///
/// Plain Observation, not TCA. The state machine already lives in Rust, so a
/// reducer layer would mostly forward to UniFFI calls at full ceremony cost.
@Observable
public final class NavigationState {
    /// The selected destination. Never optional: `NavigationSplitView` renders
    /// an empty detail pane for a `nil` selection, and a macOS window with
    /// nothing selected is a worse first-launch experience than one showing
    /// Today. Losing the selection is not a state this app has.
    public var selection: SidebarSection

    public init(selection: SidebarSection = .today) {
        self.selection = selection
    }

    /// Applies a `tasknotes://` deep link.
    ///
    /// Returns whether the URL was handled, so the caller can decide what an
    /// unknown link means rather than having that decided here. An unhandled
    /// URL leaves the selection untouched — it does not reset to a default.
    @discardableResult
    public func open(_ url: URL) -> Bool {
        guard let link = TaskNotesURL(url) else { return false }
        switch link {
        case .section(let section):
            selection = section
            return true
        }
    }
}
