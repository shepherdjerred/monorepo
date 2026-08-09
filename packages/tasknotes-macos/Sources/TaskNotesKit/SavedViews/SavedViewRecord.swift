internal import TaskNotesUniFFI

internal import struct Foundation.Data
internal import class Foundation.JSONDecoder
internal import class Foundation.JSONEncoder

/// The on-disk shape of a saved view.
///
/// ## Why there is a separate record at all
///
/// `TaskListQuery` holds `FilterConfig` and `SortConfig`, which are UniFFI
/// records. They are not `Codable`, and making them so would be a retroactive
/// conformance on another module's types — the kind of thing that becomes a
/// warning, then an error, and that a second copy of the bindings would break.
/// More importantly, **UniFFI record field order is the ABI**: `FilterConfig`
/// is actively growing a field, and a synthesized `Codable` keyed on property
/// names would have silently started emitting a different document the day it
/// landed. Spelling the persisted document out means adding a dimension to the
/// core is a compile error here rather than a format change nobody reviewed.
///
/// ## The vocabulary is the core's, wherever the core has one
///
/// Statuses and priorities persist as `task_status_wire_value` and
/// `priority_wire_value` and parse back through `task_status_parse` /
/// `priority_parse`. Those are the strings the vault itself uses, so a stored
/// view says `in-progress` for the same reason a note's frontmatter does, and a
/// second client reading this file needs no table.
///
/// ## 🔴 Sort has no such vocabulary, and that is a reported gap
///
/// The core exports `task_status_wire_value` / `task_status_parse` and
/// `priority_wire_value` / `priority_parse`, but **nothing equivalent for
/// `SortField` or `SortDirection`** — even though both are `serde`-derived in
/// Rust with an explicit `rename_all`, so the strings already exist there. So
/// ``SortFieldName`` below is this shell inventing a persisted vocabulary for a
/// core type, which is precisely the thing this project exists to stop.
///
/// The right fix is one of:
///
///   * export `sort_field_wire_value` / `sort_field_parse` and the direction
///     pair, matching what already exists for status and priority; or, better,
///   * export `filter_config_to_json` / `filter_config_from_json` and
///     `sort_config_to_json` / `sort_config_from_json`, at which point this
///     whole file collapses into two core calls and the persisted document
///     *is* the core's own serde representation — which is what makes a Windows
///     client read a macOS saved view correctly by construction rather than by
///     someone reading this comment.
///
/// Until then the forward direction is an exhaustive `switch`, so a new
/// `SortField` variant is a compile error here; the reverse direction is a
/// lookup over ``SortFieldName/all``, which that same compile error is the cue
/// to extend.
struct SavedViewRecord: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let symbol: String
    let filter: FilterRecord
    /// Absent means "as synced", which is a real choice and not a missing one.
    let sort: SortRecord?

    init(_ view: SavedView) {
        self.id = view.id
        self.name = view.name
        self.symbol = view.symbol.rawValue
        self.filter = FilterRecord(view.query.filter)
        self.sort = view.query.sort.map(SortRecord.init)
    }

    /// The view this record describes, or a failure naming what was wrong.
    ///
    /// Parse, don't validate: a `SavedView` value cannot exist unless every
    /// stored status, priority, symbol and sort key was one this build
    /// recognises, so nothing downstream re-checks them.
    func view() throws(CoreError) -> SavedView {
        guard let resolvedSymbol = SavedViewSymbol(rawValue: symbol) else {
            throw CoreError.Validation(
                message: "saved view \(id) uses an unknown symbol “\(symbol)”")
        }
        guard !name.trimmingWhitespace().isEmpty else {
            throw CoreError.Validation(message: "saved view \(id) has no name")
        }
        return SavedView(
            id: id,
            name: name,
            symbol: resolvedSymbol,
            query: TaskListQuery(
                filter: try filter.filterConfig(),
                sort: try sort?.sortConfig()
            )
        )
    }
}

/// The persisted form of the core's filter record.
struct FilterRecord: Codable, Equatable, Sendable {
    let projects: [String]
    let contexts: [String]
    let tags: [String]
    /// Core wire values — `open`, `in-progress`, … — not Swift case names.
    let statuses: [String]
    /// Core wire values, likewise.
    let priorities: [String]
    let hasNoDueDate: Bool
    /// The free-text dimension. One field per `FilterConfig` dimension, so a
    /// dimension the core adds is a missing initializer argument here rather
    /// than a silent hole in what gets persisted.
    let query: String

    init(_ filter: FilterConfig) {
        self.projects = filter.projects
        self.contexts = filter.contexts
        self.tags = filter.tags
        self.statuses = filter.statuses.map { taskStatusWireValue(status: $0) }
        self.priorities = filter.priorities.map { priorityWireValue(priority: $0) }
        self.hasNoDueDate = filter.hasNoDueDate
        self.query = filter.query
    }

    func filterConfig() throws(CoreError) -> FilterConfig {
        // Mutated from `unfiltered` rather than built positionally: the record
        // is generated, its field order is the ABI, and the core is adding a
        // seventh dimension. A memberwise call here would have to be edited on
        // that day; this does not, and a dimension this shell does not yet
        // persist simply stays at its unfiltered value.
        var filter = FilterConfig.unfiltered
        filter.projects = projects
        filter.contexts = contexts
        filter.tags = tags
        filter.statuses = try CoreErrors.rethrowingCore("reading a saved view's statuses") {
            try statuses.map { try taskStatusParse(raw: $0) }
        }
        filter.priorities = try CoreErrors.rethrowingCore("reading a saved view's priorities") {
            try priorities.map { try priorityParse(raw: $0) }
        }
        filter.hasNoDueDate = hasNoDueDate
        filter.query = query
        return filter
    }
}

/// The persisted form of the core's sort record.
struct SortRecord: Codable, Equatable, Sendable {
    let field: String
    let direction: String

    init(_ sort: SortConfig) {
        self.field = SortFieldName.of(sort.field)
        self.direction = SortDirectionName.of(sort.direction)
    }

    func sortConfig() throws(CoreError) -> SortConfig {
        guard let resolvedField = SortFieldName.field(named: field) else {
            throw CoreError.Validation(message: "“\(field)” is not a sort key this build knows")
        }
        guard let resolvedDirection = SortDirectionName.direction(named: direction) else {
            throw CoreError.Validation(
                message: "“\(direction)” is not a sort direction this build knows")
        }
        return SortConfig(field: resolvedField, direction: resolvedDirection)
    }
}

/// 🔴 The persisted names for `SortField`, invented here because the core does
/// not export any. See ``SavedViewRecord`` for the fix this is standing in for.
enum SortFieldName {
    /// Every key this build can persist and read back.
    ///
    /// Authored rather than derived — `SortField` is a generated enum with no
    /// `CaseIterable` — so it can drift. What stops it silently is ``of(_:)``
    /// below: adding a variant to the Rust enum makes that `switch`
    /// non-exhaustive, and `default:` is banned repository-wide, so the compile
    /// error lands two lines from this list.
    static let all: [SortField] = [.dueDate, .priority, .title, .effectiveDate]

    /// The persisted name for a key. Total, and exhaustive on purpose.
    static func of(_ field: SortField) -> String {
        switch field {
        case .dueDate: "dueDate"
        case .priority: "priority"
        case .title: "title"
        case .effectiveDate: "effectiveDate"
        }
    }

    static func field(named name: String) -> SortField? {
        all.first { of($0) == name }
    }
}

/// 🔴 The persisted names for `SortDirection`, same gap, same fix.
enum SortDirectionName {
    static let all: [SortDirection] = [.asc, .desc]

    static func of(_ direction: SortDirection) -> String {
        switch direction {
        case .asc: "asc"
        case .desc: "desc"
        }
    }

    static func direction(named name: String) -> SortDirection? {
        all.first { of($0) == name }
    }
}

extension SavedViewRecord {
    /// The whole collection, as the bytes that go into user defaults.
    ///
    /// Sorted keys and no pretty-printing: the value is compared against its
    /// previous encoding to decide whether a write is needed, and a document
    /// whose key order varied would rewrite on every launch.
    static func encode(_ views: [SavedView]) throws(CoreError) -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try CoreErrors.storing("writing the saved views") {
            try encoder.encode(views.map(SavedViewRecord.init))
        }
    }

    /// The collection stored in `data`, or a failure naming what was wrong.
    static func decode(_ data: Data) throws(CoreError) -> [SavedView] {
        let records = try CoreErrors.validating("reading the stored saved views") {
            try JSONDecoder().decode([SavedViewRecord].self, from: data)
        }
        var views: [SavedView] = []
        views.reserveCapacity(records.count)
        for record in records {
            views.append(try record.view())
        }
        return views
    }
}
