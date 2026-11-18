import Foundation
import TaskNotesFacetUI
import TaskNotesKit
import Testing

@Suite("Facet iOS Store & Widget Projection")
@MainActor
struct FacetMobileTests {
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
}
