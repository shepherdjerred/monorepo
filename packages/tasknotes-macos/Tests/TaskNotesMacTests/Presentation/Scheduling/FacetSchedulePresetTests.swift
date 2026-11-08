import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Core-owned schedule choices", .serialized) @MainActor
struct FacetSchedulePresetTests {
    private nonisolated static let calendarCases = [
        ("2026-10-30", ["2026-10-30", "2026-10-31", "2026-10-31", "2026-11-02"]),
        ("2026-10-31", ["2026-10-31", "2026-11-01", "2026-10-31", "2026-11-02"]),
        ("2026-11-01", ["2026-11-01", "2026-11-02", "2026-11-07", "2026-11-02"]),
        ("2026-11-02", ["2026-11-02", "2026-11-03", "2026-11-07", "2026-11-09"]),
    ]

    @Test(arguments: calendarCases)
    func dateChoicesUseOneViewerDayAcrossWeekAndDaylightSavingBoundaries(
        today: String, expected: [String]
    ) async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("schedule-choice-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        guard let zone = TimeZone(identifier: "America/New_York") else {
            throw FacetContractError.unsupportedResponse
        }
        let instant = today == "2026-10-31" ? "2026-11-01T03:59:59Z" : today + "T12:00:00Z"
        let calendar = ViewerCalendar(
            today: today, timeZone: zone,
            instant: try #require(ISO8601DateFormatter().date(from: instant)))
        var requests: [FacetValue] = []
        let choices = try await FacetSchedulePresets.load(calendar: calendar) { request in
            requests.append(request)
            return try await context.first.features(profileID: profile.id, request: request)
        }
        #expect(choices.map(\.day) == expected)
        #expect(requests.count == 4)
        #expect(requests.allSatisfy { $0.object?.fields["today"] == .string(calendar.today) })
        #expect(
            requests.allSatisfy {
                $0.object?.fields["at"] == .string(calendar.instant.ISO8601Format())
            })
        try await context.close()
    }

    @Test func malformedCoreProjectionFailsInsteadOfInventingDateChoices() async throws {
        let calendar = SystemClock().viewerCalendar()
        await #expect(throws: FacetContractError.self) {
            _ = try await FacetSchedulePresets.load(calendar: calendar) { _ in
                .object(["properties": .object([:])])
            }
        }
    }
}
