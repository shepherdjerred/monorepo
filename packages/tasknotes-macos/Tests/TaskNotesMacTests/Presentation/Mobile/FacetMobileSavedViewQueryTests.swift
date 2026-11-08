import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Mobile saved views retain their own query contract") @MainActor
struct FacetMobileSavedViewQueryTests {
    @Test(arguments: ["all", "today", "inbox", "upcoming"])
    func storedScopeTextArchiveAndMissingCompletionAreNotReinterpreted(scope: String) throws {
        let stored = try view(query: [
            "scope": .string(scope), "text": .string("Needle"), "includeArchived": .bool(true),
            "upcomingDays": .integer(7), "tags": .array([.string("review")]),
        ])
        let window = FacetWindowState(
            mobileScope: scope, clock: clock(), query: ["completed": .bool(false)],
            savedView: stored)
        let query = try #require(window.query().object?.fields)
        #expect(window.selectedViewID == stored.id)
        #expect(query["scope"] == .string(scope))
        #expect(query["text"] == .string("Needle"))
        #expect(query["includeArchived"] == .bool(true))
        #expect(query["completed"] == nil)
        #expect(query["hasNoProject"] == nil)
        #expect(query["groupBy"] == nil)
        #expect(query["upcomingDays"] == .integer(7))
        #expect(query["tags"] == .array([.string("review")]))
        window.replaceQueryOptions(query)
        let unchanged = try #require(window.query().object?.fields)
        #expect(unchanged["completed"] == nil)
        #expect(unchanged["text"] == .string("Needle"))
        #expect(unchanged["includeArchived"] == .bool(true))
    }

    @Test(arguments: [FacetValue.null, .bool(false), .bool(true)])
    func explicitStoredCompletionSurvivesHydrationAndFilterEditing(completed: FacetValue) throws {
        let stored = try view(query: ["scope": .string("all"), "completed": completed])
        let window = FacetWindowState(mobileScope: "all", clock: clock(), savedView: stored)
        var query = try #require(window.query().object?.fields)
        #expect(query["completed"] == completed)
        query["sortField"] = .string("title")
        window.replaceQueryOptions(query)
        #expect(try window.query().object?.fields["completed"] == completed)
        #expect(try window.query().object?.fields["sortField"] == .string("title"))
    }

    @Test func aStoredStrictInboxCannotAlterAnotherTabsBuiltInInboxOrToday() async throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let inbox = FacetWindowState(mobileScope: "inbox", clock: clock())
        let today = FacetWindowState(mobileScope: "today", clock: clock())
        let beforeInbox = try inbox.query()
        let beforeToday = try today.query()
        let stored = try view(query: ["scope": .string("inbox"), "completed": .bool(false)])
        let saved = FacetWindowState(mobileScope: "all", clock: clock())
        await saved.apply(stored, store: store)
        #expect(try saved.query().object?.fields["scope"] == .string("inbox"))
        #expect(try saved.query().object?.fields["hasNoProject"] == nil)
        #expect(try inbox.query() == beforeInbox)
        #expect(try today.query() == beforeToday)
        saved.leaveSavedView()
        saved.savedQuery = [:]
        #expect(try saved.query().object?.fields["scope"] == .string("all"))
    }

    @Test func malformedStoredQueryFailsInsteadOfOpeningAllTasks() throws {
        let stored = try FacetFeatureProjection.decode(
            FacetSavedView.self,
            from: .object([
                "id": .string("invalid"), "revision": .string(String(repeating: "a", count: 64)),
                "view": .object(["name": .string("Malformed view"), "query": .string("invalid")]),
            ]))
        let window = FacetWindowState(mobileScope: "all", clock: clock(), savedView: stored)
        #expect(window.error != nil)
        #expect(throws: FacetContractError.unsupportedResponse) { try window.query() }
        window.leaveSavedView()
        window.savedQuery = [:]
        #expect(try window.query().object?.fields["scope"] == .string("all"))
    }

    private func view(query: [String: FacetValue]) throws -> FacetSavedView {
        try FacetFeatureProjection.decode(
            FacetSavedView.self,
            from: .object([
                "id": .string("saved-view"), "revision": .string(String(repeating: "a", count: 64)),
                "view": .object([
                    "name": .string("Exact stored query"), "query": .object(query),
                    "viewType": .string("list"),
                ]),
            ]))
    }

    private func clock() -> SystemClock {
        guard let zone = TimeZone(identifier: "America/Los_Angeles"),
            let instant = ISO8601DateFormatter().date(from: "2026-11-01T19:00:00Z")
        else { preconditionFailure("Invalid saved-view clock fixture") }
        return SystemClock(timeZone: zone, instant: { instant })
    }
}
