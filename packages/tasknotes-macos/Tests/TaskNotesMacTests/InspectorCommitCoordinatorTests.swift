internal import Testing

internal import struct Foundation.UUID

@testable internal import TaskNotesMac

@Suite("The inspector commit coordinator")
@MainActor
struct InspectorCommitCoordinatorTests {
    @Test("termination waits for every registered buffer")
    func awaitsRegisteredCommits() async {
        let coordinator = InspectorCommitCoordinator()
        let registration = UUID()
        var events: [String] = []

        coordinator.register(registration) {
            events.append("captured")
            await _Concurrency.Task.yield()
            events.append("persisted")
        }

        #expect(!coordinator.isEmpty)
        await coordinator.commitAll()
        #expect(events == ["captured", "persisted"])

        coordinator.unregister(registration)
        #expect(coordinator.isEmpty)
    }
}
