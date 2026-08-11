// `localizedStandardCompare` is the only thing needed from Foundation here, and
// it is needed for the reason the plan gives for parking collation in the
// shell: a menu of names should read in the viewer's own language.
internal import Foundation
public import TaskNotesUniFFI

/// Everything the user has done to narrow a list: what they typed, what they
/// filtered to, and how they asked it ordered.
///
/// One value rather than three pieces of view state, because the three are only
/// ever read together and an empty one is the honest spelling of "show me
/// everything". It is also what makes ``TaskListModel`` a pure function of a
/// snapshot plus a query, which is what lets the whole derivation be tested
/// without a window.
public struct TaskListQuery: Sendable, Equatable {
    /// What the search field holds. Empty means no search.
    ///
    /// A window onto `filter.query`, not a field of its own. Search **is** a
    /// filter dimension — the core made it one — and keeping a second copy
    /// beside the record it belongs to is how the two would drift the first
    /// time something cleared one and not the other. The accessor exists only
    /// so the search field has something plain to bind to.
    public var search: String {
        get { filter.query }
        set { filter.query = newValue }
    }

    /// The core's on-device filter, free-text query included.
    /// ``FilterConfig/unfiltered`` — every list empty, the flag off, the query
    /// blank — is the app's `EMPTY_FILTER` and matches everything.
    public var filter: FilterConfig

    /// How the list is ordered, or `nil` for the order the core produced.
    ///
    /// `nil` is offered to the user as **As Synced**, and it is a real choice
    /// rather than an absent one: the core carries the vault's own order and a
    /// list that always imposed a sort would make that order unreachable.
    public var sort: SortConfig?

    /// A query that narrows nothing, ordered as the screen prefers.
    public init(section: SidebarSection) {
        self.init(sort: section.defaultSort)
    }

    /// - Parameters:
    ///   - search: what the search field holds, or `nil` to take whatever
    ///     `filter` already carries in its own free-text dimension.
    ///
    ///     ⚠️ **`nil` rather than `""`, and that is a data-loss fix rather than
    ///     a nicety.** ``search`` writes through into `filter.query`, so with a
    ///     `""` default `TaskListQuery(filter: stored)` silently *erased* the
    ///     stored filter's free-text dimension — the caller said nothing about
    ///     the search and got it cleared. A saved view holding a search round
    ///     tripped as one holding none. `nil` is the only spelling of "I am not
    ///     talking about the search" that a defaulted parameter has.
    ///   - filter: the core's filter record, free-text dimension included.
    ///   - sort: how the list is ordered, or `nil` for the core's own order.
    public init(
        search: String? = nil,
        filter: FilterConfig = .unfiltered,
        sort: SortConfig? = nil
    ) {
        self.filter = filter
        self.sort = sort
        // After `filter`, because it writes through into it — and only when the
        // caller actually named a search.
        if let search { self.search = search }
    }

    /// Whether anything is being hidden.
    ///
    /// Sorting is excluded deliberately — by the core, not here: reordering a
    /// list removes nothing from it, and this value's only job is to answer
    /// "is this list empty because the vault is empty, or because I hid
    /// things?".
    public var isNarrowing: Bool { taskFilterIsActive(filter: filter) }

    /// How many dimensions are filtered, for the toolbar's badge.
    ///
    /// The core's own `FilterConfig::active_count`, so the number beside the
    /// funnel and the predicate that empties the list can never disagree about
    /// what "filtered" means. Search counts as one of them, which is right:
    /// it is a dimension of the same record and it hides rows the same way.
    public var activeFilterCount: Int { Int(taskFilterActiveCount(filter: filter)) }

    /// Drop every filter and the search, keeping the ordering.
    ///
    /// One assignment, because the search lives inside the filter.
    public mutating func clearNarrowing() {
        filter = .unfiltered
    }
}

extension FilterConfig {
    /// The filter that keeps everything — the app's `EMPTY_FILTER`.
    ///
    /// Spelled once here because the generated memberwise initializer takes
    /// seven arguments and UniFFI emits no defaults for most of them, so every
    /// call site would otherwise restate seven empty values to say "no filter".
    public static var unfiltered: FilterConfig {
        FilterConfig(
            projects: [],
            contexts: [],
            tags: [],
            statuses: [],
            priorities: [],
            hasNoDueDate: false,
            query: ""
        )
    }

    /// Add or remove one value from a dimension, as a menu toggle does.
    ///
    /// Written as four small mutating helpers rather than one keypath-driven
    /// generic because `FilterConfig` is a generated record whose dimensions
    /// hold three different element types, and a generic over them would buy
    /// nothing but indirection.
    public mutating func toggleProject(_ value: String) {
        projects = Self.toggled(value, in: projects)
    }

    public mutating func toggleContext(_ value: String) {
        contexts = Self.toggled(value, in: contexts)
    }

    public mutating func toggleTag(_ value: String) {
        tags = Self.toggled(value, in: tags)
    }

    public mutating func toggleStatus(_ value: TaskStatus) {
        statuses = Self.toggled(value, in: statuses)
    }

    public mutating func togglePriority(_ value: Priority) {
        priorities = Self.toggled(value, in: priorities)
    }

    /// The value removed if it was there, appended if it was not.
    ///
    /// Appended rather than inserted in sorted position: the order of a
    /// filter's own values is never read — the core tests membership — and
    /// keeping selection order makes the menu's checkmarks stable as the user
    /// works through it.
    private static func toggled<Value: Equatable>(
        _ value: Value,
        in values: [Value]
    ) -> [Value] {
        guard let index = values.firstIndex(of: value) else { return values + [value] }
        var without = values
        without.remove(at: index)
        return without
    }
}

/// The values a filter menu can offer, taken from one screen's own corpus.
///
/// Scoped to the screen rather than to the vault so the menu never offers a
/// project that would empty the list — an option that can only produce "no
/// results" is a trap, not a choice.
public struct TaskListFacets: Sendable, Equatable {
    /// Project display names, one per distinct project.
    public let projects: [String]

    /// Context names.
    public let contexts: [String]

    /// Tag names, without the leading `#`.
    public let tags: [String]

    public var isEmpty: Bool { projects.isEmpty && contexts.isEmpty && tags.isEmpty }

    /// Nothing to offer.
    ///
    /// What a screen shows when the derivation failed: the menus stay present
    /// and empty rather than disappearing, because a control that vanishes when
    /// something goes wrong tells the reader nothing about what went wrong.
    public static var empty: TaskListFacets { TaskListFacets(of: []) }

    /// Collect the facets present in a list of tasks.
    ///
    /// ⚠️ **Projects are deduplicated with `projectMatches` — the very
    /// predicate the filter runs — and not by string equality or by canonical
    /// path.** A project is stored as either a bare name or an Obsidian
    /// wikilink, and `[[Areas/Work|Work]]` and `Work` are the same project. A
    /// first version keyed on `projectPath`, which is stricter than
    /// `projectMatches`: it made those two distinct menu entries that both
    /// selected both tasks, so choosing either produced a checkmark next to a
    /// value that did not describe the result. Using the filter's own predicate
    /// makes the offered value and the selected set agree by construction.
    ///
    /// The **display name** is what is offered, and that is safe rather than
    /// lucky: `project_keys` includes the display name among the four
    /// spellings a value is recognised by, so a menu entry always matches the
    /// tasks it was collected from.
    init(of tasks: [CoreTask]) {
        var seenProjects: [String] = []
        var seenContexts: Set<String> = []
        var seenTags: Set<String> = []

        for task in tasks {
            for project in task.projects {
                let name = projectDisplayName(value: project)
                if !seenProjects.contains(where: { projectMatches(left: $0, right: name) }) {
                    seenProjects.append(name)
                }
            }
            seenContexts.formUnion(task.contexts)
            seenTags.formUnion(task.tags)
        }

        self.projects = Self.ordered(seenProjects)
        self.contexts = Self.ordered(seenContexts)
        self.tags = Self.ordered(seenTags)
    }

    /// Names in the reading order of the viewer's own language.
    ///
    /// `localizedStandardCompare` rather than `<`, and rather than the core's
    /// `compare_titles`. The plan parks collation explicitly and names moving
    /// it into the shell as the *better* of the two options, because each
    /// platform's native collation is more correct than a portable
    /// approximation could be. That reasoning applies exactly here: these are
    /// names in a menu, read by one person on one machine, and nothing
    /// cross-platform depends on their order.
    private static func ordered(_ names: some Collection<String>) -> [String] {
        names.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
}
