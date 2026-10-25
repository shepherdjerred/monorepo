import Testing

@testable import TaskNotesFacetUI

@MainActor
struct FacetOccurrenceMaintenanceQueueTests {
    @Test func externalRequestDuringDrainGetsAnotherPassWithoutLosingOffscreenProfile() {
        var queue = FacetOccurrenceMaintenanceQueue()
        queue.request("visible")
        queue.request("visible")
        #expect(queue.next() == "visible")
        queue.request("offscreen")
        queue.request("visible")
        queue.request("visible")
        #expect(queue.next() == nil)
        queue.finish()
        #expect(queue.next() == "offscreen")
        queue.finish()
        #expect(queue.next() == "visible")
        queue.finish()
        #expect(queue.isSettled)
    }

    @Test func ownSnapshotRefreshWithoutRequestSettlesAndLaterDeletionRemainsEligible() {
        var queue = FacetOccurrenceMaintenanceQueue()
        queue.request("vault")
        #expect(queue.next() == "vault")
        queue.finish()
        #expect(queue.isSettled)
        #expect(queue.next() == nil)
        // A remote deletion later that same day is a new input, not suppressed
        // by the previous parent's success or an unconditional profile version.
        queue.request("vault")
        #expect(queue.next() == "vault")
        queue.finish()
        #expect(queue.isSettled)
    }
}
