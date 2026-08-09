import Foundation
internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

/// Saved views: the stored shape, and the fact that a view is a query and not a
/// query engine.
///
/// `saved-views.ts` was deliberately not ported to Rust — it imports a Feather
/// icon type, so it is a UI record — so the **envelope** is this shell's: an id,
/// a name, a symbol, and where the search field starts. The **query** inside it
/// is not: `base` and `sort` hold `filterChainToJson` / `sortConfigToJson`
/// output verbatim, which is what stops a second client spelling a sort key
/// differently in the same file.
///
/// The round-trip cases are still exhaustive over every dimension rather than
/// spot checks, because a dimension silently dropped on write is invisible until
/// somebody reopens the app.
@Suite("Saved views")
@MainActor
struct SavedViewTests {
    /// A fresh install gets the two views the React Native app ships.
    @Test("an untouched store is seeded with the shipped views")
    func seeded() {
        let store = SavedViewStore(defaults: SavedViewFixtures.defaults())
        #expect(store.views.map(\.name) == ["Job Search", "School"])
        #expect(store.lastError == nil)
    }

    /// Seeding happens for an **absent** key, never for an empty list.
    ///
    /// Deleting your last saved view has to stay deleted. "Absent" and "empty"
    /// being different states is the only thing that makes that possible, and it
    /// is the classic place a defaults-backed store gets it wrong.
    @Test("an emptied store stays empty across a reload")
    func emptyIsNotAbsent() {
        let suite = SavedViewFixtures.defaults()
        let store = SavedViewStore(defaults: suite)
        for view in store.views {
            store.remove(id: view.id)
        }
        #expect(store.views.isEmpty)

        let reopened = SavedViewStore(defaults: suite)
        #expect(reopened.views.isEmpty)
    }

    /// Every dimension survives a write and a read, including the ones the core
    /// only just grew.
    ///
    /// ⚠️ The free-text `query` dimension is the newest and the easiest to drop:
    /// it was added to `FilterConfig` after this record was designed, and a
    /// record that forgot it would silently turn a saved search into a saved
    /// filter with no search.
    @Test("every filter dimension survives a round trip")
    func roundTripsEveryDimension() {
        let suite = SavedViewFixtures.defaults()
        var filter = FilterConfig.unfiltered
        filter.projects = ["[[Areas/Work|Work]]"]
        filter.contexts = ["home"]
        filter.tags = ["release"]
        filter.statuses = [.open, .inProgress]
        filter.priorities = [.highest, .low]
        filter.hasNoDueDate = true
        filter.query = "invoice"

        let store = SavedViewStore(defaults: suite)
        store.save(
            name: "Everything",
            symbol: .bolt,
            draft: SavedViewDraft(
                base: .of(filter),
                search: filter.query,
                sort: SortConfig(field: .effectiveDate, direction: .desc)
            ),
            id: "everything"
        )

        let reopened = SavedViewStore(defaults: suite)
        let restored = reopened.view(id: "everything")
        #expect(restored?.name == "Everything")
        #expect(restored?.symbol == .bolt)
        #expect(restored?.draft.base == FilterChain.of(filter))
        #expect(restored?.draft.sort == SortConfig(field: .effectiveDate, direction: .desc))
        #expect(reopened.lastError == nil)
    }

    /// Every sort key round-trips, including `effectiveDate`.
    ///
    /// The persisted names are now the **core's**, from `sortConfigToJson`, so
    /// this case no longer guards a table written on this side — the core's own
    /// tests pin the spellings. What it still guards is that this file carries
    /// the document through untouched for every key the menu offers, which is
    /// the half the core cannot see.
    ///
    /// The argument list is authored, so it can fall behind `SortField`. That is
    /// tolerable now in a way it was not before: a variant this list misses is
    /// still spelled correctly by `serde`'s `rename_all` and still round-trips,
    /// where previously it would have had no persisted name at all.
    @Test(
        "every sort key and direction round-trips",
        arguments: [SortField.dueDate, .priority, .title, .effectiveDate],
        [SortDirection.asc, SortDirection.desc]
    )
    func sortRoundTrips(field: SortField, direction: SortDirection) {
        let suite = SavedViewFixtures.defaults()
        let sort = SortConfig(field: field, direction: direction)
        let store = SavedViewStore(defaults: suite)
        store.save(name: "Sorted", symbol: .star, draft: SavedViewDraft(sort: sort), id: "sorted")

        let reopened = SavedViewStore(defaults: suite)
        #expect(reopened.view(id: "sorted")?.draft.sort == sort)
    }

    /// "As synced" is a real choice, and an absent sort is how it is stored.
    @Test("an unsorted view stays unsorted")
    func unsortedRoundTrips() {
        let suite = SavedViewFixtures.defaults()
        let store = SavedViewStore(defaults: suite)
        store.save(name: "As synced", symbol: .tray, draft: SavedViewDraft(), id: "synced")
        #expect(SavedViewStore(defaults: suite).view(id: "synced")?.draft.sort == nil)
    }

    /// The scope a view produces is its filter **minus the search**, and the
    /// seed is the search and the sort.
    ///
    /// The split matters: a search that narrowed the list while the search field
    /// sat empty would make "no matches" unexplainable, and a *filter* the
    /// reader could clear would let "Clear Filters" delete the view's own
    /// definition.
    @Test("a view's filter is its scope and its search and sort are the seed")
    func scopeAndSeed() {
        var filter = FilterConfig.unfiltered
        filter.projects = ["Work"]
        filter.query = "invoice"
        let view = SavedView(
            id: "v",
            name: "Work invoices",
            symbol: .briefcase,
            draft: SavedViewDraft(
                scope: nil,
                query: TaskListQuery(
                    filter: filter, sort: SortConfig(field: .priority, direction: .desc)))
        )

        #expect(view.scope.title == "Work invoices")
        #expect(view.scope.baseFilter.filters.flatMap(\.projects) == ["Work"])
        #expect(view.scope.baseFilter.filters.allSatisfy { $0.query.isEmpty })
        #expect(view.seededQuery.search == "invoice")
        #expect(view.seededQuery.sort == SortConfig(field: .priority, direction: .desc))
        // The structured dimensions are *not* in the seed; they are applied
        // underneath, so clearing the filters cannot strip them.
        #expect(view.seededQuery.filter.projects.isEmpty)
    }

    /// Keeping an already-scoped screen composes the two narrowings as an
    /// **and**, which is the whole reason the affordance can be offered at all.
    ///
    /// ⚠️ The failure this guards against is silent and generous: a *Website*
    /// screen narrowed to *Admin*, saved as one merged `FilterConfig`, would
    /// have held `projects: ["Website", "Admin"]` — which the core reads as a
    /// union, so the view would quietly show every Website task **and** every
    /// Admin task. Nothing would look broken; the list would just be wrong.
    /// The assertion is therefore on rendered rows, not on the record.
    @Test("a scoped screen is kept as a conjunction, not as a merged filter")
    func scopedScreenKeepsItsAnd() throws {
        let scope = try #require(TaskEntity(kind: .project, name: "[[Website]]")).scope
        var reader = FilterConfig.unfiltered
        reader.projects = ["[[Admin]]"]

        let draft = SavedViewDraft(scope: scope, query: TaskListQuery(filter: reader))
        #expect(draft.base.filters.count == 2, "two links, not one merged record")

        let view = SavedView(id: "both", name: "Website admin", symbol: .folder, draft: draft)
        let model = try TaskListModel.build(
            section: .browse,
            tasks: SavedViewFixtures.crossProject,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            query: view.seededQuery,
            text: fixedText(),
            scope: view.scope
        )
        #expect(
            model.rows.map(\.task.title) == ["Both"],
            "a merged record would have admitted the two single-project rows too")
    }

    /// The reader's search comes back in the search field, not in the scope.
    @Test("a kept search seeds the field rather than narrowing invisibly")
    func keptSearchSeedsTheField() throws {
        let scope = try #require(TaskEntity(kind: .project, name: "[[Website]]")).scope
        let draft = SavedViewDraft(scope: scope, query: TaskListQuery(search: "invoice"))

        #expect(draft.search == "invoice")
        #expect(draft.base.filters.allSatisfy { $0.query.isEmpty })
        #expect(draft.base.filters.count == 1, "an otherwise-empty reader filter adds no link")
    }

    /// A two-link chain survives storage, which is the part a round trip of one
    /// link could not have shown.
    @Test("a conjunction survives a write and a read")
    func conjunctionRoundTrips() throws {
        let suite = SavedViewFixtures.defaults()
        let scope = try #require(TaskEntity(kind: .context, name: "work")).scope
        var reader = FilterConfig.unfiltered
        reader.tags = ["release"]
        let draft = SavedViewDraft(scope: scope, query: TaskListQuery(filter: reader))

        let store = SavedViewStore(defaults: suite)
        store.save(name: "Work releases", symbol: .bolt, draft: draft, id: "wr")

        let reopened = SavedViewStore(defaults: suite)
        #expect(reopened.view(id: "wr")?.draft == draft)
        #expect(reopened.lastError == nil)
    }

    /// A saved view narrows a list exactly like any other scope, and the same
    /// screen renders it.
    @Test("a saved view renders as a scoped list")
    func rendersAsAList() throws {
        let store = SavedViewStore(defaults: SavedViewFixtures.defaults())
        let jobSearch = try #require(store.view(id: "job-search"))

        let model = try TaskListModel.build(
            section: .browse,
            tasks: SavedViewFixtures.vault,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            query: jobSearch.seededQuery,
            text: fixedText(),
            scope: jobSearch.scope
        )

        #expect(model.heading == "Job Search")
        #expect(model.rows.map(\.task.title) == ["Apply to Acme", "Follow up"])
    }

    /// The same saved view, as a board.
    ///
    /// This is the React Native `SavedViewScreen`'s header button — *open the
    /// Job Search kanban* — with no job-search-shaped code behind it.
    @Test("the same saved view renders as a scoped board")
    func rendersAsABoard() throws {
        let store = SavedViewStore(defaults: SavedViewFixtures.defaults())
        let jobSearch = try #require(store.view(id: "job-search"))

        let board = try KanbanBoard.build(
            tasks: SavedViewFixtures.vault,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            query: jobSearch.seededQuery,
            text: fixedText(),
            scope: jobSearch.scope
        )

        #expect(board.heading == "Job Search")
        #expect(board.cardCount == 2)
        #expect(board.columns.count == taskStatusAll().count)
    }

    @Test("a nameless view is refused rather than stored")
    func namelessIsRefused() {
        let store = SavedViewStore(defaults: SavedViewFixtures.defaults())
        let before = store.views.count
        #expect(store.save(name: "   ", symbol: .star, draft: SavedViewDraft()) == nil)
        #expect(store.views.count == before)
        #expect(store.lastError != nil)
    }

    @Test("renaming keeps the id, so a link to the view keeps working")
    func renameKeepsIdentity() throws {
        let suite = SavedViewFixtures.defaults()
        let store = SavedViewStore(defaults: suite)
        var view = try #require(store.view(id: "school"))
        view.name = "Coursework"
        view.symbol = .book
        store.update(view)

        let reopened = SavedViewStore(defaults: suite)
        #expect(reopened.view(id: "school")?.name == "Coursework")
        #expect(
            TaskNotesURL.savedView(id: "school").url.absoluteString == "tasknotes://view/school")
    }

    @Test("restoring defaults puts back only what is missing")
    func restoreDefaults() {
        let store = SavedViewStore(defaults: SavedViewFixtures.defaults())
        store.remove(id: "school")
        store.save(name: "Mine", symbol: .flag, draft: SavedViewDraft(), id: "mine")
        store.restoreDefaults()

        #expect(store.views.map(\.id) == ["job-search", "mine", "school"])
    }
}

/// The scratch defaults suite and the vault the saved-view cases run against.
///
/// At file scope rather than nested in the suite: the type had outgrown the
/// linter's body-length limit, and the limit was pointing at something real — a
/// test type should read as a list of what is being asserted, not as a vault
/// plus a document builder.
@MainActor
enum SavedViewFixtures {
    // ── Fixture ────────────────────────────────────────────────────────────

    /// One stored record, written by hand.
    ///
    /// `base` and `sort` are given as **plain core documents** and escaped here,
    /// because that is how a core document sits inside this shell's document:
    /// JSON in a JSON string. Writing the escaping out once, in the fixture, is
    /// what keeps the cases above readable.
    static func stored(symbol: String, base: String, sort: String? = nil) -> String {
        let escape = { (document: String) in
            document.replacingOccurrences(of: "\"", with: "\\\"")
        }
        let sortField = sort.map { #","sort":"\#(escape($0))""# } ?? ""
        return #"[{"base":"\#(escape(base))","id":"x","name":"X","search":"","#
            + #""symbol":"\#(symbol)"\#(sortField)}]"#
    }

    /// A defaults suite nobody else shares.
    ///
    /// `UserDefaults(suiteName:)` with a fresh UUID rather than `.standard`:
    /// these cases write, and a test that wrote into the developer's own
    /// preferences would rewrite their saved views.
    static func defaults() -> UserDefaults {
        guard let suite = UserDefaults(suiteName: "red.sjer.tasknotes.tests.\(UUID().uuidString)")
        else {
            // Unreachable: the only documented failure is a name that is a
            // reserved domain, and a UUID-suffixed one is not.
            preconditionFailure("UserDefaults refused a scratch suite name")
        }
        return suite
    }

    /// One task in both projects, and one in each alone.
    static let crossProject: [CoreTask] = [
        coreTask(id: "Tasks/Both.md", title: "Both", projects: ["[[Website]]", "[[Admin]]"]),
        coreTask(id: "Tasks/Site.md", title: "Site", projects: ["[[Website]]"]),
        coreTask(id: "Tasks/Ops.md", title: "Ops", projects: ["[[Admin]]"]),
    ]

    static let vault: [CoreTask] = [
        coreTask(
            id: "Tasks/Apply to Acme.md", title: "Apply to Acme",
            projects: ["[[2026 Job Search]]"]),
        coreTask(
            id: "Tasks/Follow up.md", title: "Follow up", status: .inProgress,
            projects: ["[[2026 Job Search]]"]),
        coreTask(id: "Tasks/Read chapter 4.md", title: "Read chapter 4", contexts: ["school"]),
        coreTask(id: "Tasks/Unrelated.md", title: "Unrelated"),
    ]
}
