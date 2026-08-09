import Foundation
internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

/// Saved views: the stored shape, and the fact that a view is a query and not a
/// query engine.
///
/// `saved-views.ts` was deliberately not ported to Rust — it imports a Feather
/// icon type, so it is a UI record — which means the **storage shape is this
/// shell's invention** and nothing validates it but these tests. That is why
/// the round-trip cases below are exhaustive over every dimension rather than
/// spot checks: a field silently dropped on write is invisible until somebody
/// reopens the app.
@Suite("Saved views")
@MainActor
struct SavedViewTests {
    /// A fresh install gets the two views the React Native app ships.
    @Test("an untouched store is seeded with the shipped views")
    func seeded() {
        let store = SavedViewStore(defaults: Self.defaults())
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
        let suite = Self.defaults()
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
        let suite = Self.defaults()
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
            query: TaskListQuery(
                filter: filter,
                sort: SortConfig(field: .effectiveDate, direction: .desc)
            ),
            id: "everything"
        )

        let reopened = SavedViewStore(defaults: suite)
        let restored = reopened.view(id: "everything")
        #expect(restored?.name == "Everything")
        #expect(restored?.symbol == .bolt)
        #expect(restored?.query.filter == filter)
        #expect(restored?.query.sort == SortConfig(field: .effectiveDate, direction: .desc))
        #expect(reopened.lastError == nil)
    }

    /// Every sort key round-trips, including `effectiveDate`.
    ///
    /// 🔴 The persisted names for `SortField` are **this shell's invention** —
    /// the core exports `task_status_wire_value` and `priority_wire_value` but
    /// nothing equivalent for sort. This is the only thing standing between a
    /// future client and a differently-spelled sort key, so it is exhaustive
    /// over the keys the menu offers.
    @Test(
        "every sort key and direction round-trips",
        arguments: [SortField.dueDate, .priority, .title, .effectiveDate],
        [SortDirection.asc, SortDirection.desc]
    )
    func sortRoundTrips(field: SortField, direction: SortDirection) {
        let suite = Self.defaults()
        let sort = SortConfig(field: field, direction: direction)
        let store = SavedViewStore(defaults: suite)
        store.save(name: "Sorted", symbol: .star, query: TaskListQuery(sort: sort), id: "sorted")

        let reopened = SavedViewStore(defaults: suite)
        #expect(reopened.view(id: "sorted")?.query.sort == sort)
    }

    /// "As synced" is a real choice, and an absent sort is how it is stored.
    @Test("an unsorted view stays unsorted")
    func unsortedRoundTrips() {
        let suite = Self.defaults()
        let store = SavedViewStore(defaults: suite)
        store.save(name: "As synced", symbol: .tray, query: TaskListQuery(), id: "synced")
        #expect(SavedViewStore(defaults: suite).view(id: "synced")?.query.sort == nil)
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
            query: TaskListQuery(
                filter: filter, sort: SortConfig(field: .priority, direction: .desc))
        )

        #expect(view.scope.title == "Work invoices")
        #expect(view.scope.baseFilter.projects == ["Work"])
        #expect(view.scope.baseFilter.query.isEmpty)
        #expect(view.seededQuery.search == "invoice")
        #expect(view.seededQuery.sort == SortConfig(field: .priority, direction: .desc))
        // The structured dimensions are *not* in the seed; they are applied
        // underneath, so clearing the filters cannot strip them.
        #expect(view.seededQuery.filter.projects.isEmpty)
    }

    /// A saved view narrows a list exactly like any other scope, and the same
    /// screen renders it.
    @Test("a saved view renders as a scoped list")
    func rendersAsAList() throws {
        let store = SavedViewStore(defaults: Self.defaults())
        let jobSearch = try #require(store.view(id: "job-search"))

        let model = try TaskListModel.build(
            section: .browse,
            tasks: Self.vault,
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
        let store = SavedViewStore(defaults: Self.defaults())
        let jobSearch = try #require(store.view(id: "job-search"))

        let board = try KanbanBoard.build(
            tasks: Self.vault,
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
        let store = SavedViewStore(defaults: Self.defaults())
        let before = store.views.count
        #expect(store.save(name: "   ", symbol: .star, query: TaskListQuery()) == nil)
        #expect(store.views.count == before)
        #expect(store.lastError != nil)
    }

    @Test("renaming keeps the id, so a link to the view keeps working")
    func renameKeepsIdentity() throws {
        let suite = Self.defaults()
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
        let store = SavedViewStore(defaults: Self.defaults())
        store.remove(id: "school")
        store.save(name: "Mine", symbol: .flag, query: TaskListQuery(), id: "mine")
        store.restoreDefaults()

        #expect(store.views.map(\.id) == ["job-search", "mine", "school"])
    }

    /// Unreadable stored data is **reported and preserved**, never silently
    /// replaced with the defaults.
    ///
    /// Resetting would look like a fresh install and would destroy work with no
    /// message anywhere. The bytes are parked under a backup key so a later
    /// write cannot take them with it.
    @Test("a corrupt document is surfaced rather than quietly reset")
    func corruptDocument() {
        let suite = Self.defaults()
        let garbage = Data("not json at all".utf8)
        suite.set(garbage, forKey: "red.sjer.tasknotes.savedViews")

        let store = SavedViewStore(defaults: suite)
        #expect(store.views.isEmpty)
        #expect(store.lastError != nil)
        #expect(suite.data(forKey: "red.sjer.tasknotes.savedViews.unreadable") == garbage)
    }

    /// A stored symbol this build does not know is a decode failure, not a
    /// blank rectangle in the sidebar.
    @Test("an unknown symbol is refused at the boundary")
    func unknownSymbol() throws {
        let suite = Self.defaults()
        let document = """
            [{"id":"x","name":"X","symbol":"unicorn","filter":{"projects":[],"contexts":[],\
            "tags":[],"statuses":[],"priorities":[],"hasNoDueDate":false,"query":""}}]
            """
        suite.set(Data(document.utf8), forKey: "red.sjer.tasknotes.savedViews")

        let store = SavedViewStore(defaults: suite)
        #expect(store.views.isEmpty)
        #expect(store.lastError != nil)
    }

    /// A status this build does not know is likewise refused, through the
    /// **core's** parser rather than a table restated here.
    @Test("an unknown status is refused by the core's own parser")
    func unknownStatus() throws {
        let suite = Self.defaults()
        let document = """
            [{"id":"x","name":"X","symbol":"star","filter":{"projects":[],"contexts":[],\
            "tags":[],"statuses":["procrastinating"],"priorities":[],"hasNoDueDate":false,\
            "query":""}}]
            """
        suite.set(Data(document.utf8), forKey: "red.sjer.tasknotes.savedViews")

        let store = SavedViewStore(defaults: suite)
        #expect(store.views.isEmpty)
        #expect(store.lastError != nil)
    }

    /// Statuses and priorities persist as the **vault's own** words, not Swift
    /// case names.
    ///
    /// A second client reading this document needs no translation table, which
    /// is the whole reason the core's `wire_value` functions are used instead of
    /// `String(describing:)`.
    @Test("statuses and priorities persist as the core's wire values")
    func persistsCoreVocabulary() throws {
        let suite = Self.defaults()
        var filter = FilterConfig.unfiltered
        filter.statuses = [.inProgress]
        filter.priorities = [.highest]

        let store = SavedViewStore(defaults: suite)
        store.save(name: "Hot", symbol: .bolt, query: TaskListQuery(filter: filter), id: "hot")

        let raw = try #require(suite.data(forKey: "red.sjer.tasknotes.savedViews"))
        let text = try #require(String(data: raw, encoding: .utf8))
        #expect(text.contains("\"\(taskStatusWireValue(status: .inProgress))\""))
        #expect(text.contains("\"\(priorityWireValue(priority: .highest))\""))
    }

    // ── Fixture ────────────────────────────────────────────────────────────

    /// A defaults suite nobody else shares.
    ///
    /// `UserDefaults(suiteName:)` with a fresh UUID rather than `.standard`:
    /// these cases write, and a test that wrote into the developer's own
    /// preferences would rewrite their saved views.
    private static func defaults() -> UserDefaults {
        guard let suite = UserDefaults(suiteName: "red.sjer.tasknotes.tests.\(UUID().uuidString)")
        else {
            // Unreachable: the only documented failure is a name that is a
            // reserved domain, and a UUID-suffixed one is not.
            preconditionFailure("UserDefaults refused a scratch suite name")
        }
        return suite
    }

    private static let vault: [CoreTask] = [
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
