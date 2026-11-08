import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Queries bind the current viewer timezone without storing it") @MainActor
struct FacetQueryTimezoneTests {
    @Test(arguments: ["America/Los_Angeles", "Asia/Tokyo"])
    func agendaScopesShareOneViewerDayInstantAndZone(zone: String) throws {
        let clock = try clock(zone)
        let expectedDay = zone == "America/Los_Angeles" ? "2026-03-07" : "2026-03-08"
        for scope in ["today", "upcoming"] {
            let window = FacetWindowState(mobileScope: scope, clock: clock)
            let query = try window.query()
            let fields = try #require(query.object?.fields)
            #expect(fields["timezone"] == .string(zone))
            #expect(fields["today"] == .string(expectedDay))
            #expect(fields["at"] == .string("2026-03-08T07:30:00Z"))
            #expect(fields["scope"] == .string(scope == "today" ? "todayAgenda" : "upcomingAgenda"))
            try FacetSchema.bundled().validate(query, definition: "query")
        }
    }

    @Test(arguments: ["todayAgenda", "upcomingAgenda", "today", "upcoming"])
    func reopeningSavedViewsRebindsContextAndPreservesLiteralFilters(scope: String) throws {
        let literals: [String: FacetValue] = [
            "dueAfter": .string("2026-03-07"),
            "dueBefore": .string("2026-03-08T02:30:00-05:00"),
            "effectiveDay": .string("2026-03-08"),
        ]
        var stored = literals
        stored.merge([
            "scope": .string(scope), "timezone": .string("Asia/Tokyo"),
            "today": .string("1990-01-01"), "at": .string("1990-01-01T00:00:00Z"),
        ]) { _, new in new }
        let view = try savedView(stored)
        let window = FacetWindowState(
            mobileScope: "all", clock: try clock("America/Los_Angeles"), savedView: view)
        let query = try #require(window.query().object?.fields)
        #expect(window.savedQuery["timezone"] == nil)
        #expect(query["scope"] == .string(scope))
        #expect(query["timezone"] == .string("America/Los_Angeles"))
        #expect(query["today"] == .string("2026-03-07"))
        for (key, value) in literals { #expect(query[key] == value) }
        window.replaceQueryOptions(query)
        #expect(window.savedQuery["timezone"] == nil)
        #expect(try window.query().object?.fields["timezone"] == query["timezone"])
        let reopened = FacetWindowState(
            mobileScope: "all", clock: try clock("Asia/Tokyo"), savedView: view)
        #expect(try reopened.query().object?.fields["timezone"] == .string("Asia/Tokyo"))
        #expect(try reopened.query().object?.fields["today"] == .string("2026-03-08"))
        for (key, value) in literals { #expect(try reopened.query().object?.fields[key] == value) }
    }

    @Test func storeAndSavedViewEditorNeverPersistViewerContext() async throws {
        let query: [String: FacetValue] = [
            "scope": .string("upcoming"), "timezone": .string("Asia/Tokyo"),
            "dueAfter": .string("2026-03-07"), "includeArchived": .bool(true),
            "today": .string("1990-01-01"), "at": .string("1990-01-01T00:00:00Z"),
        ]
        let view = try savedView(query)
        let store = FacetStore(clock: try clock("America/Los_Angeles"))
        await store.applyView(view)
        #expect(store.savedQuery["timezone"] == nil)
        let executed = try #require(store.query().object?.fields)
        #expect(executed["scope"] == .string("upcoming"))
        #expect(executed["timezone"] == .string("America/Los_Angeles"))
        #expect(executed["dueAfter"] == query["dueAfter"])
        let serialized = try #require(store.currentView(name: "Current", board: false)["query"])
        let editor = try FacetSavedViewEditorModel(id: view.id, fields: view.view, isNew: false)
        #expect(!editor.hasChanges)
        editor.name = "Edited"
        let edited = try #require(editor.value["query"])
        for value in [serialized, edited] {
            let fields = try #require(value.object?.fields)
            for key in ["timezone", "today", "at", "offset", "limit"] {
                #expect(fields[key] == nil)
            }
            #expect(fields["scope"] == .string("upcoming"))
            #expect(fields["dueAfter"] == query["dueAfter"])
        }
    }

    @Test(arguments: ["todayAgenda", "upcomingAgenda"])
    func bundledSchemaRequiresNonemptyAgendaTimezone(scope: String) throws {
        let schema = try FacetSchema.bundled()
        var fields: [String: FacetValue] = ["scope": .string(scope)]
        for invalid in [FacetValue.null, .string(""), .string(" \t")] {
            fields["timezone"] = invalid
            #expect(throws: FacetContractError.self) {
                try schema.validate(.object(fields), definition: "query")
            }
        }
        fields.removeValue(forKey: "timezone")
        #expect(throws: FacetContractError.self) {
            try schema.validate(.object(fields), definition: "query")
        }
        for zone in ["UTC", "GMT", "America/Los_Angeles"] {
            fields["timezone"] = .string(zone)
            try schema.validate(.object(fields), definition: "query")
        }
    }

    @Test func duplicateDropsExecutionContextAndPreservesTheSelectionAndMetadata() throws {
        let query: [String: FacetValue] = [
            "scope": .string("todayAgenda"), "timezone": .string("Asia/Tokyo"),
            "today": .string("1990-01-01"), "at": .string("1990-01-01T00:00:00Z"),
            "offset": .integer(100), "limit": .integer(100),
            "effectiveDay": .string("2026-03-08"), "tags": .array([.string("review")]),
            "completed": .null, "vendorQuery": .object(["keep": .bool(false)]),
        ]
        let view = try savedView(query)
        let duplicate = try FacetSavedViewQuery.duplicate(view)
        let selected = try #require(duplicate["query"]?.object?.fields)
        #expect(duplicate["name"] == .string("Viewer query copy"))
        #expect(duplicate["vendorMetadata"] == view.view["vendorMetadata"])
        for key in ["timezone", "today", "at", "offset", "limit"] { #expect(selected[key] == nil) }
        for key in ["scope", "effectiveDay", "tags", "completed", "vendorQuery"] {
            #expect(selected[key] == query[key])
        }
        let schema = try FacetSchema.bundled()
        #expect(throws: FacetContractError.self) {
            try schema.validate(.object(selected), definition: "querySelection")
        }
        var supported = selected
        supported.removeValue(forKey: "vendorQuery")
        try schema.validate(.object(supported), definition: "querySelection")
        #expect(view.view["query"]?.object?.fields == query)
    }

    private func clock(_ identifier: String) throws -> SystemClock {
        let zone = try #require(TimeZone(identifier: identifier))
        let instant = try #require(ISO8601DateFormatter().date(from: "2026-03-08T07:30:00Z"))
        return SystemClock(timeZone: zone, instant: { instant })
    }

    private func savedView(_ query: [String: FacetValue]) throws -> FacetSavedView {
        try FacetFeatureProjection.decode(
            FacetSavedView.self,
            from: .object([
                "id": .string("viewer-query"),
                "revision": .string(String(repeating: "a", count: 64)),
                "view": .object([
                    "name": .string("Viewer query"), "query": .object(query),
                    "vendorMetadata": .array([.string("keep"), .bool(false)]),
                ]),
            ]))
    }
}
