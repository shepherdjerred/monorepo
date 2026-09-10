import Foundation
internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

/// What a saved view **is on disk**, as opposed to what it does.
///
/// Split from ``SavedViewTests`` because the two ask different questions of
/// different owners. That file asserts behaviour: seeding, renaming, what a view
/// narrows to. This one asserts the **document**, which is now two documents
/// nested — this shell's envelope (id, name, symbol, where the search field
/// starts) wrapping the core's own `filterChainToJson` / `sortConfigToJson`
/// output verbatim.
///
/// The split is also why the cases below read as literals: a persisted format is
/// a compatibility surface, and a test that built its fixture by calling the
/// same encoder it is checking would agree with any format at all.
@Suite("Saved view storage")
@MainActor
struct SavedViewRecordTests {
    /// Unreadable stored data is **reported and preserved**, never silently
    /// replaced with the defaults.
    ///
    /// Resetting would look like a fresh install and would destroy work with no
    /// message anywhere. The bytes are parked under a backup key so a later
    /// write cannot take them with it.
    @Test("a corrupt document is surfaced rather than quietly reset")
    func corruptDocument() {
        let suite = SavedViewFixtures.defaults()
        let garbage = Data("not json at all".utf8)
        suite.set(garbage, forKey: "red.sjer.tasknotes.savedViews")

        let store = SavedViewStore(defaults: suite)
        // Recovered to the defaults rather than left empty. The invariant
        // these cases exist for is *reported and preserved* — `lastError`
        // below, and the backup key — not the recovery strategy. Leaving the
        // undecodable bytes in place made the app nag on every launch; see
        // `SavedViewStore.load`.
        #expect(store.views.map(\.name) == ["Job Search", "School"])
        #expect(store.lastError != nil)
        #expect(suite.data(forKey: "red.sjer.tasknotes.savedViews.unreadable") == garbage)
    }

    /// A stored symbol this build does not know is a decode failure, not a
    /// blank rectangle in the sidebar.
    ///
    /// The symbol is one of the three things this shell genuinely does own, so
    /// it is spelled out in the document below alongside the core's opaque
    /// `base`.
    @Test("an unknown symbol is refused at the boundary")
    func unknownSymbol() throws {
        let suite = SavedViewFixtures.defaults()
        suite.set(
            Data(SavedViewFixtures.stored(symbol: "unicorn", base: #"{}"#).utf8),
            forKey: "red.sjer.tasknotes.savedViews")

        let store = SavedViewStore(defaults: suite)
        // Recovered to the defaults rather than left empty. The invariant
        // these cases exist for is *reported and preserved* — `lastError`
        // below, and the backup key — not the recovery strategy. Leaving the
        // undecodable bytes in place made the app nag on every launch; see
        // `SavedViewStore.load`.
        #expect(store.views.map(\.name) == ["Job Search", "School"])
        #expect(store.lastError != nil)
    }

    /// A status this build does not know is refused by the **core's** parser,
    /// reached through the document rather than through a table restated here.
    @Test("an unknown status is refused by the core's own parser")
    func unknownStatus() throws {
        let suite = SavedViewFixtures.defaults()
        suite.set(
            Data(
                SavedViewFixtures.stored(
                    symbol: "star", base: #"{"filters":[{"statuses":["procrastinating"]}]}"#
                ).utf8),
            forKey: "red.sjer.tasknotes.savedViews")

        let store = SavedViewStore(defaults: suite)
        // Recovered to the defaults rather than left empty. The invariant
        // these cases exist for is *reported and preserved* — `lastError`
        // below, and the backup key — not the recovery strategy. Leaving the
        // undecodable bytes in place made the app nag on every launch; see
        // `SavedViewStore.load`.
        #expect(store.views.map(\.name) == ["Job Search", "School"])
        #expect(store.lastError != nil)
    }

    /// A sort key this build does not know is refused too — which is the whole
    /// point of the sort codec.
    ///
    /// ⚠️ This is the case that used to be **unreachable from a second client**.
    /// The persisted names for `SortField` were authored in this shell, so a
    /// Windows client would have invented its own and the two documents would
    /// have disagreed in a way nothing could detect. `sortConfigFromJson` is now
    /// the only reader, and it refuses rather than defaulting: a list quietly
    /// ordered by due date because the stored key was not recognised looks
    /// exactly like one that worked.
    @Test("an unknown sort key is refused rather than defaulted")
    func unknownSortKey() throws {
        let suite = SavedViewFixtures.defaults()
        suite.set(
            Data(
                SavedViewFixtures.stored(
                    symbol: "star", base: #"{}"#,
                    sort: #"{"field":"scheduled","direction":"asc"}"#
                ).utf8),
            forKey: "red.sjer.tasknotes.savedViews")

        let store = SavedViewStore(defaults: suite)
        // Recovered to the defaults rather than left empty. The invariant
        // these cases exist for is *reported and preserved* — `lastError`
        // below, and the backup key — not the recovery strategy. Leaving the
        // undecodable bytes in place made the app nag on every launch; see
        // `SavedViewStore.load`.
        #expect(store.views.map(\.name) == ["Job Search", "School"])
        #expect(store.lastError != nil)
    }

    /// The stored query is the **core's own document**, verbatim.
    ///
    /// Two assertions, and the second is the one that changed. Statuses and
    /// priorities persist as the vault's own words — that was already true
    /// through `taskStatusWireValue`. What is new is that the *whole record* is
    /// the core's: the bytes under `base` are exactly what `filterChainToJson`
    /// produced, so a second client reading this file needs no table for any
    /// part of it, including the sort key that this shell used to name itself.
    @Test("the stored query is the core's own document, byte for byte")
    func persistsCoreVocabulary() throws {
        let suite = SavedViewFixtures.defaults()
        var filter = FilterConfig.unfiltered
        filter.statuses = [.inProgress]
        filter.priorities = [.highest]
        let chain = FilterChain.of(filter)
        let sort = SortConfig(field: .effectiveDate, direction: .desc)

        let store = SavedViewStore(defaults: suite)
        store.save(
            name: "Hot", symbol: .bolt, draft: SavedViewDraft(base: chain, sort: sort), id: "hot")

        let raw = try #require(suite.data(forKey: "red.sjer.tasknotes.savedViews"))
        let text = try #require(String(data: raw, encoding: .utf8))

        // JSON inside JSON, so the core's document appears escaped. Comparing
        // against the escaping of the core's *actual* output rather than
        // against a literal is what makes this an identity check instead of a
        // second transcription of the format.
        let escape = { (document: String) in
            document.replacingOccurrences(of: "\"", with: "\\\"")
        }
        #expect(text.contains(escape(try filterChainToJson(chain: chain))))
        #expect(text.contains(escape(try sortConfigToJson(sort: sort))))
        // …and the vault's own words are in there, which is what a person
        // reading the file by hand would look for.
        #expect(text.contains(taskStatusWireValue(status: .inProgress)))
        #expect(text.contains(priorityWireValue(priority: .highest)))
    }
}
