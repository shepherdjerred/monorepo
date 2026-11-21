import Foundation
import Testing

@testable import TaskNotesKit

@MainActor
struct FacetOccurrenceReplayTests {
    @Test("A queued completion advances a refreshed occurrence exactly once")
    func refreshOccurrence() throws {
        let local = FacetLocalStore()
        let initial = local.addTask(
            FacetTaskDraft(
                title: "Practice", projectId: "studio",
                dueDate: "2026-01-09", recurrenceRule: "FREQ=DAILY"))
        let instant = try #require(ViewerCalendar.parseISO8601("2026-01-10T12:00:00Z"))
        local.completeTask(id: initial.id, at: instant)
        let advanced = try #require(local.tasks.first)
        #expect(advanced.due_date == "2026-01-11")
        let completion = try #require(local.outbox.last)
        local.replayQueuedOutbox([completion], retaining: [advanced])
        #expect(local.tasks == [advanced])
        local.tasks = [initial]
        local.replayQueuedOutbox([completion])
        #expect(local.tasks == [advanced])
        #expect(local.tasks.first?.completed == false)
    }
}
