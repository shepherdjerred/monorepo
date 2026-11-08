import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Mobile collections, filters and calendar presentation") @MainActor
struct FacetMobileQueryTests {
    @Test(arguments: ["today", "upcoming", "inbox"])
    func mobileCollectionUsesItsExplicitCoreContractWithoutChangingDesktop(scope: String) throws {
        let mobile = FacetWindowState(mobileScope: scope, clock: clock())
        let desktop = FacetWindowState(clock: clock())
        desktop.scope = scope
        let query = try #require(mobile.query().object?.fields)
        let desktopQuery = try #require(desktop.query().object?.fields)
        #expect(desktopQuery["scope"] == .string(scope))
        if scope == "today" {
            #expect(query["scope"] == .string("todayAgenda"))
            #expect(query["groupBy"] == .string("agendaSection"))
        } else if scope == "upcoming" {
            #expect(query["scope"] == .string("upcomingAgenda"))
            #expect(query["groupBy"] == .string("effectiveDate"))
            #expect(query["upcomingDays"] == nil)
        } else {
            #expect(query["scope"] == .string("all"))
            #expect(query["hasNoProject"] == .bool(true))
            #expect(query["hasNoDueDate"] == nil)
            #expect(query["contexts"] == nil)
            #expect(query["today"] == nil)
        }
    }

    @Test func globalSearchAndTabsDoNotShareCollectionOrFilterState() throws {
        let inbox = FacetWindowState(mobileScope: "inbox", clock: clock())
        inbox.savedQuery["tags"] = .array([.string("focus")])
        let upcoming = FacetWindowState(mobileScope: "upcoming", clock: clock())
        upcoming.savedQuery["effectiveDay"] = .string("2026-11-10")
        let search = FacetWindowState(mobileScope: "all", clock: clock(), globalSearch: true)
        search.search = "Launch"
        let query = try #require(search.query().object?.fields)
        #expect(query["scope"] == .string("all"))
        #expect(query["text"] == .string("Launch"))
        #expect(query["completed"] == nil)
        #expect(query["hasNoProject"] == nil)
        #expect(query["effectiveDay"] == nil)
        #expect(query["tags"] == nil)
        #expect(query["today"] == nil)
        #expect(try inbox.query().object?.fields["tags"] == .array([.string("focus")]))
        #expect(try upcoming.query().object?.fields["effectiveDay"] == .string("2026-11-10"))
    }

    @Test func applyingFiltersRetainsMultipleSelectionsAndChosenDayButDropsOldPageContext() throws {
        let window = FacetWindowState(mobileScope: "upcoming", clock: clock())
        window.status = "open"
        window.priority = "high"
        window.replaceQueryOptions([
            "statuses": .array([.string("open"), .string("review")]),
            "priorities": .array([.string("normal"), .string("high")]),
            "projects": .array([.string("Launch")]), "effectiveDay": .string("2026-11-10"),
            "sortField": .string("scheduledDate"), "sortDirection": .string("desc"),
            "offset": .integer(900), "today": .string("1990-01-01"), "text": .string("Old text"),
        ])
        let query = try #require(window.query().object?.fields)
        #expect(query["statuses"] == .array([.string("open"), .string("review")]))
        #expect(query["priorities"] == .array([.string("normal"), .string("high")]))
        #expect(query["effectiveDay"] == .string("2026-11-10"))
        #expect(query["sortField"] == .string("scheduledDate"))
        #expect(query["sortDirection"] == .string("desc"))
        #expect(query["offset"] == .unsigned(0))
        #expect(query["today"] == .string("2026-11-01"))
        #expect(query["text"] == nil)
        #expect(query["completed"] == .bool(false))
    }

    @Test func clearFiltersKeepsTheChosenUpcomingDayAndSort() throws {
        let window = FacetWindowState(mobileScope: "upcoming", clock: clock())
        let fields: [String: FacetValue] = [
            "tags": .array([.string("focus")]), "completed": .bool(true),
            "effectiveDay": .string("2026-11-10"), "sortField": .string("title"),
        ]
        window.replaceQueryOptions(FacetMobileQueryPolicy.clearedFilters(fields))
        let query = try #require(window.query().object?.fields)
        #expect(query["tags"] == nil)
        #expect(query["completed"] == .bool(false))
        #expect(query["effectiveDay"] == .string("2026-11-10"))
        #expect(query["sortField"] == .string("title"))
    }

    @Test func applyingAnUnchangedInboxQueryDoesNotInventActiveFilters() throws {
        let window = FacetWindowState(mobileScope: "inbox", clock: clock())
        let original = try #require(window.query().object?.fields)
        window.replaceQueryOptions(original)
        #expect(FacetMobileQueryPolicy.filterCount(window.savedQuery, scope: window.scope) == 0)
        window.savedQuery["completed"] = .null
        #expect(FacetMobileQueryPolicy.filterCount(window.savedQuery, scope: window.scope) == 1)
        window.savedQuery["tags"] = .array([.string("focus")])
        #expect(FacetMobileQueryPolicy.filterCount(window.savedQuery, scope: window.scope) == 2)
    }

    @Test func weekStripUsesCalendarDaysAcrossDaylightSavingAndYearBoundaries() throws {
        let zone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        #expect(
            FacetMobileDateText.week(today: "2026-10-31", timeZone: zone) == [
                "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04",
                "2026-11-05", "2026-11-06", "2026-11-07",
            ])
        #expect(FacetMobileDateText.week(today: "2026-12-30", timeZone: zone).first == "2026-12-31")
        #expect(FacetMobileDateText.week(today: "2026-12-30", timeZone: zone).last == "2027-01-06")
        #expect(FacetMobileDateText.date("2026-02-30", timeZone: zone) == nil)
        #expect(
            FacetMobileDateText.heading("2026-11-02", today: "2026-11-01", timeZone: zone)
                == "Tomorrow")
    }

    @Test func agendaGroupsUseTheAuthoritativeOccurrenceSection() throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let original = try #require(store.snapshot?.tasks.first)
        var fields = try #require(FacetJSON.parse(JSONEncoder().encode(original)).object?.fields)
        fields.removeValue(forKey: "agendaSection")
        fields.removeValue(forKey: "agendaDateKind")
        let legacy = try FacetFeatureProjection.decode(FacetTask.self, from: .object(fields))
        #expect(legacy.agendaSection == nil && legacy.agendaDateKind == nil)
        fields["occurrenceDate"] = .string("2026-10-31")
        fields["agendaSection"] = .string("overdue")
        fields["agendaDateKind"] = .string("planned")
        let overdue = try FacetFeatureProjection.decode(FacetTask.self, from: .object(fields))
        fields["occurrenceDate"] = .string("2026-11-01")
        fields["agendaSection"] = .string("scheduled-today")
        let today = try FacetFeatureProjection.decode(FacetTask.self, from: .object(fields))
        let group = FacetTaskGroup(key: "scheduled-today", taskIds: [original.id])
        #expect(
            FacetTaskGroupPresentation.tasks([overdue, today], in: group, groupBy: "agendaSection")
                .map(\.rowID) == [today.rowID])
    }

    private func clock() -> SystemClock {
        guard let zone = TimeZone(identifier: "America/Los_Angeles"),
            let instant = ISO8601DateFormatter().date(from: "2026-11-01T19:00:00Z")
        else { preconditionFailure("Invalid test clock fixture") }
        return SystemClock(timeZone: zone, instant: { instant })
    }
}
