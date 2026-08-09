// `public`, because ``SavedViewDraft`` carries `FilterChain` and `SortConfig`
// on its own surface. It was `internal` while a saved view's narrowing was a
// single `FilterConfig` reachable only through ``TaskListScope``; the chain
// changed that, and `InternalImportsByDefault` makes the distinction a build
// error rather than a style question.
public import TaskNotesUniFFI

/// A query somebody kept.
///
/// ## A saved view is a name over a stored narrowing, and nothing more
///
/// The React Native `saved-views.ts` is the one domain file that was
/// **deliberately not ported to Rust**, because it imports a Feather icon type
/// — it is a UI record, not domain logic. So the storage shape is the shell's
/// to define, which is what this file does.
///
/// What it must not become is a second query engine. Everything that *decides*
/// which tasks a view contains is already exported: `FilterConfig`,
/// `FilterChain`, `SortConfig`, `task_filter_chain_apply`, `task_sort_apply`. A
/// saved view therefore holds a ``SavedViewDraft`` and hands it to the same
/// ``TaskListModel`` every other screen uses. There is no membership rule in
/// this file, and there must never be one.
///
/// ## Its filters are a base; its search and sort are a starting point
///
/// This mirrors `SavedViewScreen`, which applies `view.filter` to the corpus
/// and then puts a `FilterSortBar` on top of the result. So:
///
///   * ``base`` becomes the screen's ``TaskListScope`` — the narrowing "Clear
///     Filters" cannot remove, because clearing the filters on *Job Search*
///     must leave you on Job Search.
///   * ``search`` and ``sort`` seed the reader's own query, which they are then
///     free to change. A stored sort that could not be changed would make the
///     column headers of a saved view worse than those of every other screen.
///
/// ## Why the base is a chain
///
/// It is a `FilterChain` — the core's conjunction — and not a single
/// `FilterConfig`, which is what lets a view be kept from a screen that already
/// has a scope. Two narrowings stacked cannot be merged into one record: a list
/// is a union *within* its dimension, so concatenating a scope's `projects`
/// with the reader's turns an **and** into an **or**. The core owns that rule;
/// see `FilterChain`. Before it existed, "keep this as a view" had to be
/// disabled on every project, context, tag and saved-view screen.
///
/// ## No colour
///
/// `SavedView` in the React Native app carries a hex `color`, drawn as a card
/// accent. It is not ported. This app spends colour on exactly two things —
/// red for *late* and orange for *flagged* — and a palette of per-view accents
/// would be a third vocabulary competing with both, in a window where the
/// sidebar row sits inches from a task row. A symbol distinguishes views
/// without claiming a meaning.
public struct SavedView: Sendable, Equatable, Identifiable {
    /// Stable across renames, because it is what a deep link and a restored
    /// window selection hold.
    ///
    /// Spelled `String` rather than through a `typealias ID = String`, and both
    /// halves of that matter. `Identifiable` infers its associated type from
    /// this declaration, so `SavedView.ID` is still `String` at every call
    /// site — while writing the typealias out trips `type_name`, whose
    /// three-character floor is right for ordinary types and wrong for the one
    /// name the standard library itself chose. Writing `let id: ID` instead is
    /// worse than either: it is circular, and the compiler quietly resolves it
    /// to `ObjectIdentifier`.
    public let id: String

    public var name: String

    public var symbol: SavedViewSymbol

    /// Everything about the view that is not its identity or its label.
    public var draft: SavedViewDraft

    public init(id: String, name: String, symbol: SavedViewSymbol, draft: SavedViewDraft) {
        self.id = id
        self.name = name
        self.symbol = symbol
        self.draft = draft
    }

    /// The view as a narrowing a list screen or a board can carry.
    ///
    /// The free-text search is deliberately not part of it — see
    /// ``SavedViewDraft/search``.
    public var scope: TaskListScope {
        TaskListScope(
            title: name,
            systemImage: symbol.systemImage,
            baseFilter: draft.base,
            emptyTitle: "No tasks in \(name)",
            emptyDescription: "Tasks matching this view appear here.",
            identity: "view.\(id)"
        )
    }

    /// Where the reader's own query starts on this screen.
    ///
    /// The stored structured dimensions are *not* included: they are the scope,
    /// applied underneath, and putting them here as well would filter twice and
    /// let "Clear Filters" strip the view's own definition. The search and the
    /// sort are here precisely because they are the two the reader is meant to
    /// change.
    public var seededQuery: TaskListQuery {
        TaskListQuery(search: draft.search, filter: .unfiltered, sort: draft.sort)
    }

    /// The two views the React Native app ships, in its own words.
    ///
    /// Seeded on first launch rather than hard-coded as a floor, so they can be
    /// renamed or deleted like any other. `DEFAULT_SAVED_VIEWS` is a constant
    /// there because that app has no way to create one; this app does, so a
    /// default that could not be removed would be the odd one out.
    public static var defaults: [SavedView] {
        var jobSearch = FilterConfig.unfiltered
        jobSearch.projects = ["[[2026 Job Search]]"]

        var school = FilterConfig.unfiltered
        school.contexts = ["school"]

        return [
            SavedView(
                id: "job-search",
                name: "Job Search",
                symbol: .briefcase,
                draft: SavedViewDraft(base: .of(jobSearch))
            ),
            SavedView(
                id: "school",
                name: "School",
                symbol: .book,
                draft: SavedViewDraft(base: .of(school))
            ),
        ]
    }
}

/// What a screen offers to keep, and what a stored view holds once it is kept.
///
/// One type for both ends because they are the same three values: a saved view
/// *is* a screen's narrowing with a name on it. Splitting them would have meant
/// two shapes to keep in step, and the sheet that names the view would be the
/// place they drifted.
public struct SavedViewDraft: Sendable, Equatable {
    /// Every narrowing in force, joined by the core's `and`.
    ///
    /// A chain rather than a filter, because a screen can carry a scope *and*
    /// the reader's own filter menu at once, and those two cannot be merged
    /// into a single record without turning an `and` into an `or`. See
    /// `FilterChain`.
    public var base: FilterChain

    /// What the search field held.
    ///
    /// Lifted out of the base and handed back to the reader as a starting
    /// point, not applied underneath. It is the one dimension with a visible
    /// control bound to it, and a search that narrowed the list while the
    /// search field sat empty would make "no matches" unexplainable — there
    /// would be nothing on screen saying what was hiding the rows.
    public var search: String

    /// How the list was ordered, or `nil` for the order the core produced.
    public var sort: SortConfig?

    public init(base: FilterChain = .unfiltered, search: String = "", sort: SortConfig? = nil) {
        self.base = base
        self.search = search
        self.sort = sort
    }

    /// What the screen showing `query` under `scope` would be kept as.
    ///
    /// The reader's structured filter is conjoined onto the scope's chain
    /// rather than merged into it, which is the whole reason this is
    /// expressible: on a *Website* screen narrowed to *Admin*, the stored value
    /// is "Website **and** Admin", and a merged record would have said "Website
    /// **or** Admin". The free-text dimension is split off into ``search``
    /// instead of being conjoined, so reopening the view puts the phrase back
    /// in the search field where the reader can see and clear it.
    public init(scope: TaskListScope?, query: TaskListQuery) {
        var reader = query.filter
        reader.query = ""
        self.init(
            base: (scope?.baseFilter ?? .unfiltered).and(reader),
            search: query.search,
            sort: query.sort
        )
    }
}

/// The symbols a saved view can be given.
///
/// A closed set rather than a free-text SF Symbol name, for the reason the
/// repository's principles give: an unrecognized name renders as a blank
/// rectangle with no diagnostic anywhere, which is a silent fallback on bad
/// data. A closed set makes an unknown stored symbol a decode failure that says
/// so.
///
/// ⚠️ Deliberately **not** `Codable`, and not raw-valued on the SF Symbol name.
/// `raw_value_for_camel_cased_codable_enum` requires a `Codable` enum's raw
/// values to match its camel-cased case names, which most SF Symbol names
/// (`list.bullet`, `calendar.badge.clock`) do not. Keeping the raw value as the
/// case name and mapping to the symbol separately satisfies both, and it means
/// the *persisted* vocabulary is this app's rather than Apple's — so a renamed
/// system symbol cannot invalidate somebody's stored views.
public enum SavedViewSymbol: String, CaseIterable, Sendable, Equatable, Hashable {
    case briefcase
    case book
    case flag
    case star
    case folder
    case tray
    case bolt
    case person
    case house
    case calendar

    /// The SF Symbol to draw.
    ///
    /// Every case's symbol happens to share its name today; the indirection is
    /// what keeps that a coincidence rather than a contract.
    public var systemImage: String {
        switch self {
        case .briefcase: "briefcase"
        case .book: "book"
        case .flag: "flag"
        case .star: "star"
        case .folder: "folder"
        case .tray: "tray"
        case .bolt: "bolt"
        case .person: "person"
        case .house: "house"
        case .calendar: "calendar"
        }
    }

    /// What a symbol picker calls this choice.
    public var title: String {
        switch self {
        case .briefcase: "Briefcase"
        case .book: "Book"
        case .flag: "Flag"
        case .star: "Star"
        case .folder: "Folder"
        case .tray: "Tray"
        case .bolt: "Bolt"
        case .person: "Person"
        case .house: "House"
        case .calendar: "Calendar"
        }
    }
}
