internal import TaskNotesUniFFI

internal import struct Foundation.Data
internal import class Foundation.JSONDecoder
internal import class Foundation.JSONEncoder

/// The on-disk shape of a saved view.
///
/// ## The shell owns the label; the core owns the query
///
/// A saved view is two things stapled together. Its **identity and label** —
/// the id a deep link holds, the name in the sidebar, the symbol drawn beside
/// it — are this app's, invented here, and spelled out below. Its **query** is
/// the core's, and this file does not spell it at all: ``base`` and ``sort``
/// hold whatever `filterChainToJson` and `sortConfigToJson` produced, verbatim,
/// and hand it straight back to `filterChainFromJson` / `sortConfigFromJson` on
/// the way in.
///
/// ## Why the query is an opaque string
///
/// The previous version of this file transcribed the core's records field by
/// field: seven properties mirroring `FilterConfig`'s seven dimensions, plus a
/// hand-written table of strings for `SortField` and `SortDirection` because
/// nothing exported them. Every line of that was **this shell inventing a
/// persisted vocabulary for a core type** — the exact drift a shared core
/// exists to prevent, and the only thing standing between a Windows client and
/// a differently-spelled sort key in the same document.
///
/// Two concrete failures it had, neither hypothetical:
///
///   * When `FilterConfig` grew its seventh dimension, this record had to be
///     edited by hand to match, and nothing anywhere would have failed if it
///     had not been — a saved search would simply have round-tripped as a saved
///     filter with no search.
///   * `SortFieldName.all` was authored, so it could fall behind the enum. The
///     `switch` beside it made that a compile error *here*, which is a good
///     backstop and still leaves a second client with nothing at all.
///
/// A whole-record codec removes the decision instead of documenting it. There
/// is no key this file can misspell, no dimension it can omit, and no table to
/// keep in step: the persisted document **is** the core's own `serde`
/// representation.
///
/// ## What that costs, honestly
///
/// The query is JSON inside JSON, so the stored bytes carry escaped quotes and
/// this shell can no longer inspect or migrate a query it does not understand.
/// Both are the point rather than a regression — a document this file could
/// take apart is a document it could take apart *wrongly* — but the escaping is
/// genuinely uglier to read by hand, and it is the reason the compatibility
/// story below lives in the core rather than here.
///
/// ## How a view written today survives the next core change
///
/// Mechanically, in `tasknotes-core`, not by convention here:
///
///   * every `FilterConfig` and `FilterChain` field is `#[serde(default)]`, so
///     a document written before a dimension existed still loads with that
///     dimension unfiltered;
///   * both containers are JSON objects rather than arrays, so they *can* gain
///     a key;
///   * the core's own tests pin frozen literal documents in both directions, so
///     a rename, a retype, or a new field added without a default is a red test
///     in the core instead of a saved view that quietly lost something;
///   * an *unknown* sort key or status is refused rather than defaulted, which
///     is the other half of the rule: an absent key is a statement from the
///     past, an unrecognised value is one this build cannot honour.
struct SavedViewRecord: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let symbol: String

    /// The core's document for the view's conjunction of filters. Opaque here.
    let base: String

    /// What the search field held. A plain string with no vocabulary to get
    /// wrong, which is why it is stored beside the query rather than inside it.
    let search: String

    /// The core's document for the sort, or absent for "as synced" — which is a
    /// real choice and not a missing one.
    let sort: String?

    init(_ view: SavedView) throws(CoreError) {
        self.id = view.id
        self.name = view.name
        self.symbol = view.symbol.rawValue
        self.search = view.draft.search
        (self.base, self.sort) = try CoreErrors.rethrowingCore("writing saved view \(view.id)") {
            (
                try filterChainToJson(chain: view.draft.base),
                try view.draft.sort.map { try sortConfigToJson(sort: $0) }
            )
        }
    }

    /// The view this record describes, or a failure naming what was wrong.
    ///
    /// Parse, don't validate: a `SavedView` value cannot exist unless the stored
    /// symbol was one this build draws and the stored query was one the core
    /// understands, so nothing downstream re-checks them.
    func view() throws(CoreError) -> SavedView {
        guard let resolvedSymbol = SavedViewSymbol(rawValue: symbol) else {
            throw CoreError.Validation(
                message: "saved view \(id) uses an unknown symbol “\(symbol)”")
        }
        guard !name.trimmingWhitespace().isEmpty else {
            throw CoreError.Validation(message: "saved view \(id) has no name")
        }
        let draft = try CoreErrors.rethrowingCore("reading saved view \(id)") {
            SavedViewDraft(
                base: try filterChainFromJson(json: base),
                search: search,
                sort: try sort.map { try sortConfigFromJson(json: $0) }
            )
        }
        return SavedView(id: id, name: name, symbol: resolvedSymbol, draft: draft)
    }
}

extension SavedViewRecord {
    /// The whole collection, as the bytes that go into user defaults.
    ///
    /// Sorted keys and no pretty-printing: the value is compared against its
    /// previous encoding to decide whether a write is needed, and a document
    /// whose key order varied would rewrite on every launch. The *inner*
    /// documents are the core's, whose field order is its declaration order and
    /// therefore already stable.
    static func encode(_ views: [SavedView]) throws(CoreError) -> Data {
        var records: [SavedViewRecord] = []
        records.reserveCapacity(views.count)
        for view in views {
            records.append(try SavedViewRecord(view))
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try CoreErrors.storing("writing the saved views") {
            try encoder.encode(records)
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
