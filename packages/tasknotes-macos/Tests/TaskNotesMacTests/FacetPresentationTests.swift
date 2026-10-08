import Foundation
import Synchronization
import TaskNotesKit
import Testing

@testable import TaskNotesFacetUI

@MainActor
struct FacetPresentationTests {
    @Test func widgetResultCannotPublishAfterProfileABAOrAccountFence() async throws {
        let store = FacetStore()
        store.selectedProfileID = "owning-profile"
        let payload = Data("display snapshot".utf8)
        let current = await store.loadWidgetEnvelope(
            profileID: "owning-profile", load: { payload }, ownsEngine: { true })
        #expect(current == payload)
        let afterProfileABA = await store.loadWidgetEnvelope(
            profileID: "owning-profile",
            load: {
                await Task.yield()
                store.selectedProfileID = "other-profile"
                store.requestGeneration += 1
                store.selectedProfileID = "owning-profile"
                return payload
            }, ownsEngine: { true })
        #expect(afterProfileABA == nil)
        let afterAccountIntent = await store.loadWidgetEnvelope(
            profileID: "owning-profile",
            load: {
                await Task.yield()
                store.syncGeneration += 1
                return payload
            }, ownsEngine: { true })
        #expect(afterAccountIntent == nil)
        let replacedEngine = await store.loadWidgetEnvelope(
            profileID: "owning-profile", load: { payload }, ownsEngine: { false })
        #expect(replacedEngine == nil)
    }

    @Test func moreKeepsTheDisplayedQueryClockAcrossMidnight() throws {
        let before = try Date.ISO8601FormatStyle().parse("2026-10-03T23:59:00Z")
        let after = try Date.ISO8601FormatStyle().parse("2026-10-04T00:01:00Z")
        let instant = Mutex(before)
        let zone = try #require(TimeZone(secondsFromGMT: 0))
        let store = FacetStore(
            clock: SystemClock(timeZone: zone, instant: { instant.withLock { $0 } }))
        store.scope = "agenda"
        let original = store.query()
        store.displayedQuery = original
        instant.withLock { $0 = after }
        let next = try store.displayedPageQuery(offset: 100)
        #expect(next.object?.fields["today"] == .string("2026-10-03"))
        #expect(next.object?.fields["at"] == original.object?.fields["at"])
        #expect(next.object?.fields["offset"] == .integer(100))
        #expect(store.query().object?.fields["today"] == .string("2026-10-04"))
        store.displayedQuery = nil
        #expect(throws: FacetContractError.self) { try store.displayedPageQuery(offset: 100) }
        let portable = store.currentView(name: "Agenda", board: false)
        #expect(portable["query"]?.object?.fields["at"] == nil)
        #expect(portable["query"]?.object?.fields["today"] == nil)
    }
    @Test func untouchedReminderVendorFieldsAndExactEstimatesSurviveEditing() throws {
        let original: [String: FacetValue] = [
            "reminders": .array([
                .object([
                    "id": .string("reminder"), "type": .string("absolute"),
                    "absoluteTime": .string("2026-10-03T12:00:00Z"),
                    "vendor": .rawNumber("9007199254740993.000000000000000001"),
                ])
            ]),
            "tags": .array([.string("original")]),
        ]
        var edited = FacetTaskExtras(properties: original)
        edited.tags = "changed"
        edited.estimate = "1.000000000000000001"
        let patch = try edited.changes(from: original)
        #expect(patch["reminders"] == nil)
        #expect(patch["timeEstimate"] == .rawNumber("1.000000000000000001"))
        edited.estimate = "true"
        #expect(throws: FacetEditorError.self) { try edited.changes(from: original) }
    }

    @Test func portableViewKeepsMultipleChoicesAndLiveCivilDay() async throws {
        let bytes = Data(
            """
            {"id":"view","revision":"revision","view":{"name":"Work","query":{
            "statuses":["open","waiting"],"priorities":["low","high"],
            "projects":["[[Work]]"],"completed":true,"sortField":"dueDate","groupBy":"project"}}}
            """.utf8)
        let view = try JSONDecoder().decode(FacetSavedView.self, from: bytes)
        let store = FacetStore()
        await store.applyView(view)
        let query = store.query().object?.fields
        #expect(query?["statuses"] == .array([.string("open"), .string("waiting")]))
        #expect(query?["priorities"] == .array([.string("low"), .string("high")]))
        #expect(query?["completed"] == .bool(true))
        #expect(query?["groupBy"] == .string("project"))
        #expect(query?["today"] == .string(SystemClock().viewerCalendar().today))
        store.status = ""
        #expect(store.query().object?.fields["statuses"] == nil)
    }
}
