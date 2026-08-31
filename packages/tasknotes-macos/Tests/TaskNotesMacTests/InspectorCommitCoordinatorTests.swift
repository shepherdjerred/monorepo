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

    @Test("termination waits for an offer after its inspector disappears")
    func awaitsUnregisteredInFlightOffer() async {
        let coordinator = InspectorCommitCoordinator()
        let registration = UUID()
        var release: CheckedContinuation<Void, Never>?
        var events: [String] = []

        coordinator.register(registration) {}
        coordinator.perform {
            events.append("offered")
            await withCheckedContinuation { release = $0 }
            events.append("persisted")
        }
        coordinator.unregister(registration)

        await _Concurrency.Task.yield()
        #expect(events == ["offered"])
        #expect(!coordinator.isEmpty)

        let termination = _Concurrency.Task { @MainActor in
            await coordinator.commitAll()
            events.append("terminated")
        }
        await _Concurrency.Task.yield()
        #expect(events == ["offered"])

        release?.resume()
        await termination.value
        #expect(events == ["offered", "persisted", "terminated"])
        #expect(coordinator.isEmpty)
    }
}
