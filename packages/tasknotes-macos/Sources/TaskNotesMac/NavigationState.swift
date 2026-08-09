public import Observation
public import TaskNotesKit

public import struct Foundation.URL

/// Which destination is selected, and nothing else.
///
/// Navigation is a property of the **window** — two windows have two
/// selections — while task data is a property of the vault. That is why this
/// sits beside `TaskNotesStore` rather than inside it; conflating them is what
/// makes a store impossible to test.
///
/// Plain Observation, not TCA. The state machine already lives in Rust, so a
/// reducer layer would mostly forward to UniFFI calls at full ceremony cost.
@Observable
public final class NavigationState {
    /// The selected destination. Never optional: `NavigationSplitView` renders
    /// an empty detail pane for a `nil` selection, and a macOS window with
    /// nothing selected is a worse first-launch experience than one showing
    /// Today. Losing the selection is not a state this app has.
    ///
    /// A ``TaskNotesDestination`` rather than a ``SidebarSection``, because the
    /// sidebar now lists more than the four fixed screens: the vault's
    /// projects, contexts and tags, the saved views, and the board are all
    /// selectable, and a single `List` cannot carry two selection types. The
    /// four sections keep their own `⌘1`…`⌘4` because `SidebarSection` is still
    /// what enumerates *them*.
    public var selection: TaskNotesDestination

    public init(selection: TaskNotesDestination = .default) {
        self.selection = selection
    }

    /// The selected section, when a section is what is selected.
    ///
    /// What the View menu's `Picker` binds to. A project has no `⌘n`, so the
    /// picker shows no checkmark while one is open — which is the honest
    /// reading, and better than a picker that claims Browse is selected because
    /// the project screen happens to be built out of it.
    public var selectedSection: SidebarSection? {
        get { selection.section }
        set {
            guard let newValue else { return }
            selection = .section(newValue)
        }
    }

    /// Applies a `tasknotes://` deep link.
    ///
    /// Returns whether the URL was handled, so the caller can decide what an
    /// unknown link means rather than having that decided here. An unhandled
    /// URL leaves the selection untouched — it does not reset to a default.
    ///
    /// ⚠️ A link to a **saved view that has been deleted** is handled here and
    /// rejected by the detail pane, not the other way round: this layer has no
    /// access to the saved-view store, and giving it one to pre-validate a link
    /// would put a second copy of "does this view exist" in the router. The
    /// screen says the view is gone, which is the more useful place to say it.
    @discardableResult
    public func open(_ url: URL) -> Bool {
        guard let link = TaskNotesURL(url) else { return false }
        selection = link.destination
        return true
    }
}
