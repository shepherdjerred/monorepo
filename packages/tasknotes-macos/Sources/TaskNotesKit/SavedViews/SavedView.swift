// `internal`, not `public`: nothing below exposes a `TaskNotesUniFFI` type in a
// public signature — `FilterConfig` appears only inside ``SavedView/defaults``'s
// body, and the scope this type hands out carries it on ``TaskListScope``'s
// surface rather than on this one. `InternalImportsByDefault` is on, so a
// `public import` that no public declaration needs is an error here.
internal import TaskNotesUniFFI

/// A query somebody kept.
///
/// ## A saved view is a stored ``TaskListQuery``, and nothing more
///
/// The React Native `saved-views.ts` is the one domain file that was
/// **deliberately not ported to Rust**, because it imports a Feather icon type
/// — it is a UI record, not domain logic. So the storage shape is the shell's
/// to define, which is what this file does.
///
/// What it must not become is a second query engine. Everything that *decides*
/// which tasks a view contains is already exported: `FilterConfig`,
/// `SortConfig`, `task_filter_apply`, `task_sort_apply`. A saved view therefore
/// holds one `TaskListQuery` and hands it to the same ``TaskListModel`` every
/// other screen uses. There is no membership rule in this file, and there must
/// never be one.
///
/// ## Its filter is a base; its search and sort are a starting point
///
/// This mirrors `SavedViewScreen`, which applies `view.filter` to the corpus
/// and then puts a `FilterSortBar` on top of the result. So:
///
///   * ``query``'s **filter** becomes the screen's ``TaskListScope`` — the
///     narrowing "Clear Filters" cannot remove, because clearing the filters on
///     *Job Search* must leave you on Job Search.
///   * ``query``'s **search and sort** seed the reader's own query, which they
///     are then free to change. A stored sort that could not be changed would
///     make the column headers of a saved view worse than those of every other
///     screen.
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

    /// The view's filter, search and sort, exactly as ``TaskListQuery`` spells
    /// them for every other screen.
    public var query: TaskListQuery

    public init(id: String, name: String, symbol: SavedViewSymbol, query: TaskListQuery) {
        self.id = id
        self.name = name
        self.symbol = symbol
        self.query = query
    }

    /// The view as a narrowing a list screen or a board can carry.
    ///
    /// The free-text dimension is lifted out of the base and handed to the
    /// reader instead. It is the one dimension with a visible control bound to
    /// it, and a search that narrowed the list while the search field sat empty
    /// would make "no matches" unexplainable — there would be nothing on screen
    /// saying what was hiding the rows.
    public var scope: TaskListScope {
        var base = query.filter
        base.query = ""
        return TaskListScope(
            title: name,
            systemImage: symbol.systemImage,
            baseFilter: base,
            emptyTitle: "No tasks in \(name)",
            emptyDescription: "Tasks matching this view appear here.",
            identity: "view.\(id)"
        )
    }

    /// Where the reader's own query starts on this screen.
    ///
    /// The stored filter's structured dimensions are *not* included: they are
    /// the scope, applied underneath, and putting them here as well would
    /// filter twice and let "Clear Filters" strip the view's own definition.
    /// The search and the sort are here precisely because they are the two the
    /// reader is meant to change.
    public var seededQuery: TaskListQuery {
        TaskListQuery(search: query.search, filter: .unfiltered, sort: query.sort)
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
                query: TaskListQuery(filter: jobSearch)
            ),
            SavedView(
                id: "school",
                name: "School",
                symbol: .book,
                query: TaskListQuery(filter: school)
            ),
        ]
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
