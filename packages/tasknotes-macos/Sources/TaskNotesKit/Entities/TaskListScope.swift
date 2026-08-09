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
/// *Admin* would start showing both. Two `apply_filter` calls compose
/// correctly; one merged record does not. There is no `FilterConfig`
/// conjunction in the FFI surface, and that absence is exactly why this type
/// applies them one after the other rather than combining them.
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

    /// The narrowing itself, as the core's own filter record.
    public let baseFilter: FilterConfig

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
        baseFilter: FilterConfig,
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
    /// One call into `taskFilterApply`, guarded by the core's own
    /// `taskFilterIsActive` — the same guard and the same order
    /// ``TaskListModel`` already uses for the reader's filter, because copying
    /// every task across the FFI to apply a filter that filters nothing is the
    /// common case for a saved view that only sorts.
    public func narrow(_ tasks: [CoreTask]) -> [CoreTask] {
        guard taskFilterIsActive(filter: baseFilter) else { return tasks }
        return taskFilterApply(tasks: tasks, filter: baseFilter)
    }
}
