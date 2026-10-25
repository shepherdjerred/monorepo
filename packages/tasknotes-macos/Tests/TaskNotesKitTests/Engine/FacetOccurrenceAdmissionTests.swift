import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit

struct FacetOccurrenceAdmissionTests {
    @Test func revokedPassCannotEnterExecuteAfterWaitingForEngineActor() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let engine = try await FacetEngine.open(
            directory: root.appendingPathComponent("engine"), secrets: OccurrenceAdmissionSecrets())
        let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
        _ = try await engine.refresh(profileID: profile.id)
        let barrier = OccurrenceAdmissionBarrier()
        let blocking = _Concurrency.Task { await engine.holdOccurrenceAdmissionTest(barrier) }
        await barrier.waitUntilEntered()
        let permit = FacetOccurrenceAdmission()
        let id = UUID().uuidString
        let attempted = _Concurrency.Task {
            try await engine.execute(
                profileID: profile.id,
                command: .object([
                    "kind": .string("create"),
                    "properties": .object(["title": .string("Must not be created")]),
                ]), mutationID: id, occurrenceAdmission: permit)
        }
        permit.cancel()
        barrier.release()
        await blocking.value
        await #expect(throws: CancellationError.self) { try await attempted.value }
        #expect(try await engine.pendingMutations().isEmpty)
        #expect(try await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.isEmpty)
        try await engine.close()
    }

    @Test func revokedRecoveryObservesExecutingReceiptButNeverAdmitsOrRetiresTail() async throws {
        let permit = FacetOccurrenceAdmission()
        let barrier = OccurrenceAdmissionBarrier()
        let events = OccurrenceAdmissionEvents()
        let saved = [pending("first"), pending("tail")]
        let recovery = _Concurrency.Task.detached {
            try FacetOccurrenceRecovery.resume(
                admission: permit, pending: { _ in saved },
                retry: { id in
                    events.append("retry:" + id)
                    barrier.hold()
                },
                retire: { item in events.append("retire:" + item.id) },
                observe: { id in events.append("observe:" + id) })
        }
        await barrier.waitUntilEntered()
        permit.cancel()
        barrier.release()
        await #expect(throws: CancellationError.self) { try await recovery.value }
        #expect(events.recorded == ["retry:first", "observe:first"])
    }

    private func pending(_ id: String) -> FacetPendingMutation {
        FacetPendingMutation(
            profileID: "synthetic", id: id,
            mutation: .object([
                "command": .object([
                    "kind": .string("materialize_occurrence_window"),
                    "origin": .string("automatic_maintenance"),
                ])
            ]))
    }
}

private final class OccurrenceAdmissionEvents: Sendable {
    private let values = Mutex<[String]>([])
    var recorded: [String] { values.withLock { $0 } }
    func append(_ event: String) { values.withLock { $0.append(event) } }
}

/// A synchronous actor call stays occupied until the test explicitly releases it.
private final class OccurrenceAdmissionBarrier: Sendable {
    private struct State {
        var entered = false
        var waiter: CheckedContinuation<Void, Never>?
    }
    private let state = Mutex(State())
    private let resume = DispatchSemaphore(value: 0)

    func hold() {
        let waiter = state.withLock {
            $0.entered = true
            let continuation = $0.waiter
            $0.waiter = nil
            return continuation
        }
        waiter?.resume()
        resume.wait()
    }

    func waitUntilEntered() async {
        await withCheckedContinuation { continuation in
            let entered = state.withLock {
                if $0.entered { return true }
                $0.waiter = continuation
                return false
            }
            if entered { continuation.resume() }
        }
    }

    func release() { resume.signal() }
}

extension FacetEngine {
    fileprivate func holdOccurrenceAdmissionTest(_ barrier: OccurrenceAdmissionBarrier) {
        barrier.hold()
    }
}

private final class OccurrenceAdmissionSecrets: FacetSecureStore {
    private let values = Mutex<[String: Data]>([:])
    func read(_ name: String) -> Data? { values.withLock { $0[name] } }
    func write(_ name: String, bytes: Data) { values.withLock { $0[name] = bytes } }
    func remove(_ name: String) { _ = values.withLock { $0.removeValue(forKey: name) } }
}
