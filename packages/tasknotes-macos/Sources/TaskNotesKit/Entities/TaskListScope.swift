public import TaskNotesUniFFI

/// A narrowing a screen carries *underneath* whatever the reader does to it.
///
/// ## Why this is not just another filter
///
/// A list screen already has a `FilterConfig` — the one the toolbar's filter
/// menu writes, which "Clear Filters" empties. A project screen needs a second
/// one that behaves differently: clearing the filters on the **Website** screen
/// must leave you on the Website screen, not silently promote you to Browse. So
/// the two are separate values applied in sequence, and only the upper one is
/// the reader's to clear.
///
/// That sequence is also why they are not merged into one `FilterConfig`.
/// The core's semantics are *"every dimension must pass, any value within a
/// dimension"* — so concatenating two filters' `projects` lists would turn an
/// **and** into an **or**, and a saved view scoped to *Website* narrowed to
/// *Admin* would start showing both.
///
/// The narrowing this type carries is therefore a **`FilterChain`**, the core's
/// own conjunction, rather than a single `FilterConfig`. That is what lets a
/// scoped screen be kept as a saved view at all: the stored value is the whole
/// stack, joined by the core's `and`, and no shell ever has to decide how two
/// filters combine. `FilterChain`'s own documentation works through why the
/// merge is not merely awkward but impossible — a union within a dimension, an
/// empty intersection that has no spelling, and a `query` field that holds one
/// phrase.
///
/// ## One type, three producers
///
/// ``TaskEntity`` makes one per project, context and tag. ``SavedView`` makes
/// one per stored view. The Kanban board takes one so that "the board for this
/// project" is the same code as "the board". Nothing else varies between those
/// screens, which is the whole reason the entity screens are configurations
/// rather than three near-copies of the list.
public struct TaskListScope: Sendable, Equatable {
    /// The screen's heading and window title.
    public let title: String

    /// The SF Symbol naming this scope in a sidebar or a toolbar.
    ///
    /// A name rather than an `Image`: this target has no SwiftUI, by design.
    public let systemImage: String

    /// The narrowing itself, as the core's own conjunction of filter records.
    ///
    /// Usually one filter — a project, a context, a tag. More than one when the
    /// scope came from a saved view that was kept while another scope was
    /// already in force.
    public let baseFilter: FilterChain

    /// What an empty screen says it is empty *of*.
    public let emptyTitle: String

    /// The sentence under it.
    public let emptyDescription: String

    /// A stable key for view identity and accessibility identifiers.
    ///
    /// Distinct per scope, and derived from what the scope *is* rather than
    /// from its title — two projects can share a display name (`[[A/Work]]` and
    /// `[[B/Work]]` both read as `Work`), and a screen identity that collided
    /// would carry one screen's selection and search into the other.
    public let identity: String

    public init(
        title: String,
        systemImage: String,
        baseFilter: FilterChain,
        emptyTitle: String,
        emptyDescription: String,
        identity: String
    ) {
        self.title = title
        self.systemImage = systemImage
        self.baseFilter = baseFilter
        self.emptyTitle = emptyTitle
        self.emptyDescription = emptyDescription
        self.identity = identity
    }

    /// The tasks this scope admits, out of everything the store holds.
    ///
    /// One call into `taskFilterChainApply`, guarded by the core's own
    /// `taskFilterChainIsActive` — the same guard and the same order
    /// ``TaskListModel`` already uses for the reader's filter, because copying
    /// every task across the FFI to apply a filter that filters nothing is the
    /// common case for a saved view that only sorts.
    public func narrow(_ tasks: [CoreTask]) -> [CoreTask] {
        guard taskFilterChainIsActive(chain: baseFilter) else { return tasks }
        return taskFilterChainApply(tasks: tasks, chain: baseFilter)
    }
}

extension FilterChain {
    /// A chain that narrows nothing.
    public static var unfiltered: FilterChain { FilterChain(filters: []) }

    /// The chain narrowing by exactly one filter.
    public static func of(_ filter: FilterConfig) -> FilterChain {
        FilterChain(filters: [filter])
    }

    /// This chain with `filter` conjoined, unless it narrows nothing.
    ///
    /// An inactive filter is dropped rather than appended: it would change no
    /// answer and would make an otherwise-identical saved view compare unequal
    /// and persist differently. The "does it narrow anything" question is the
    /// core's, through `taskFilterIsActive`, so this cannot disagree with the
    /// badge beside the filter menu.
    public func and(_ filter: FilterConfig) -> FilterChain {
        guard taskFilterIsActive(filter: filter) else { return self }
        return FilterChain(filters: filters + [filter])
    }
}
