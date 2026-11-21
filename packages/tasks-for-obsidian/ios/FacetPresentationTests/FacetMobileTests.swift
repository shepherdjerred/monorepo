import Foundation
import SwiftUI
import TaskNotesKit
import Testing

@testable import TaskNotesFacetUI

@Suite("Facet iOS Store & Widget Projection")
@MainActor
struct FacetMobileTests {
    @Test("The brand color resolves both appearances on a rendering thread")
    func brandResolvesOffMainActor() async {
        let brand = FacetNativeStyle.brand
        let (light, dark) = await _Concurrency.Task.detached {
            var environment = EnvironmentValues()
            environment.colorScheme = .light
            let light = brand.resolve(in: environment)
            environment.colorScheme = .dark
            return (light, brand.resolve(in: environment))
        }.value
        #expect(abs(light.red - 0.77) < 0.01)
        #expect(abs(dark.red - 1) < 0.01)
        #expect(dark.green > light.green)
    }

    @Test("Quick capture and widget envelope projection work on iOS")
    func quickCaptureAndWidgetProjection() throws {
        let database = try FacetSQLiteDatabase(inMemoryNamed: ":memory:")
        let fixedNow = ViewerCalendar.parseISO8601("2026-06-15T10:00:00Z") ?? Date()
        let calendar = ViewerCalendar(
            today: "2026-06-15",
            timeZone: .gmt,
            instant: fixedNow
        )
        let store = FacetStore(
            localStore: FacetLocalStore(database: database),
            tokenStore: InMemoryTokenStore(),
            calendar: calendar,
            isIsolatedLaunch: true
        )

        let project = store.createProject(name: "Mobile", color: "indigo", isFavorite: true)
        let created = store.createQuickTask(rawInput: "Ship iOS cutover today #Mobile p1")
        #expect(created?.title == "Ship iOS cutover")
        #expect(created?.project_id == project.id)
        #expect(created?.priority == .p1)
        #expect(store.todayCount == 1)

        let envelopeBytes = try #require(store.widgetEnvelope())
        let decoded = try JSONDecoder().decode(FacetWidgetEnvelope.self, from: envelopeBytes)
        #expect(decoded.schemaVersion == 2)
        #expect(decoded.projections["2026-06-15"]?.todayTasks.first?.priority == "P1")
    }

    @Test("Moving a timed task across daylight saving keeps its wall-clock time")
    func rescheduleAcrossDaylightSaving() throws {
        let store = FacetStore(
            localStore: FacetLocalStore(), tokenStore: InMemoryTokenStore(), isIsolatedLaunch: true)
        let task = store.localStore.addTask(
            FacetTaskDraft(
                title: "Studio appointment", projectId: "", dueDate: "2026-10-31",
                dueDatetime: "2026-10-31T16:30:00Z", dueTimezone: "America/Los_Angeles"))
        store.reschedule(task, to: "2026-11-02")
        let moved = try #require(store.task(for: task.id))
        #expect(moved.due_date == "2026-11-02")
        #expect(moved.due_datetime == "2026-11-02T17:30:00Z")
        store.reschedule(moved, to: nil)
        let unscheduled = try #require(store.task(for: task.id))
        #expect(
            unscheduled.due_date == nil && unscheduled.due_datetime == nil
                && unscheduled.due_timezone == nil)
    }

    @Test("Choosing a viewer date keeps a task in that day's list across the date line")
    func rescheduleFromDifferentTimeZone() throws {
        let store = FacetStore(
            localStore: FacetLocalStore(), tokenStore: InMemoryTokenStore(),
            calendar: ViewerCalendar(timeZone: .gmt), isIsolatedLaunch: true)
        let task = store.localStore.addTask(
            FacetTaskDraft(
                title: "Tokyo call", projectId: "", dueDate: "2026-11-01",
                dueDatetime: "2026-10-31T16:00:00Z", dueTimezone: "Asia/Tokyo"))
        store.reschedule(task, to: "2026-11-03")
        let moved = try #require(store.task(for: task.id))
        #expect(moved.due_date == "2026-11-04")
        #expect(moved.due_datetime == "2026-11-03T16:00:00Z")
        #expect(
            store.calendar.effectiveCivilDay(
                dueDate: moved.due_date, dueDatetime: moved.due_datetime) == "2026-11-03")
    }

    @Test("Upcoming pages include the selected empty day and Quick Add honors its civil date")
    func upcomingDateSelection() throws {
        let store = FacetStore(
            localStore: FacetLocalStore(), tokenStore: InMemoryTokenStore(), isIsolatedLaunch: true)
        store.destination = .section(.upcoming)
        store.upcomingSelectedDayOffset = -8
        #expect(store.upcomingWeekSlots.map(\.offset) == Array(-14 ... -8))
        store.upcomingSelectedDayOffset = 18
        let day = try #require(store.upcomingSelectedDate)
        #expect(store.upcomingWeekSlots.map(\.offset) == Array(14...20))
        #expect(store.upcomingGroups.first?.civilDate == day)
        let implicit = store.createQuickTask(rawInput: "Plan picnic")
        let explicit = store.createQuickTask(rawInput: "Invite friends tomorrow")
        #expect(implicit?.due_date == day)
        #expect(explicit?.due_date == store.calendar.addingDays(1))
    }
}
