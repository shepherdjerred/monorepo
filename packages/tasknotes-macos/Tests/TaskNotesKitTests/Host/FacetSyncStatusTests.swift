import Foundation
import Testing

@testable import TaskNotesKit

@Suite("Durable Sync convergence")
struct FacetSyncStatusTests {
    private func durable(
        initial: Bool = true, remote: UInt64 = 0, upload: UInt64 = 0,
        conflicts: UInt64 = 0, mutations: UInt64 = 0
    ) -> FacetDurableSyncStatus {
        FacetDurableSyncStatus(
            schemaVersion: 1, profileId: "test", profileKind: "obsidian_sync", version: 1,
            initialSyncComplete: initial, pendingRemoteCount: remote, pendingUploadCount: upload,
            conflictCount: conflicts, pendingMutationCount: mutations)
    }

    @Test func transportReadinessNeverOverridesDurableWork() {
        let pending = [
            durable(initial: false), durable(remote: 1), durable(upload: 1), durable(mutations: 1),
        ]
        for projection in pending {
            #expect(FacetSyncStatus(transport: .connected, durable: projection).phase == .syncing)
        }
        #expect(
            FacetSyncStatus(transport: .connected, durable: durable(conflicts: 1)).phase
                == .conflict)
        #expect(FacetSyncStatus(transport: .connected).phase == .syncing)
        #expect(FacetSyncStatus(transport: .connected, durable: durable()).phase == .synced)
    }

    @Test func everyRetainedHostQueueBlocksIdle() {
        let counters: [WritableKeyPath<FacetSyncHostWork, Int>] = [
            \.metadata, \.uploads, \.downloads, \.metadataCompletions, \.uploadAdmissions,
            \.queuedEvents,
        ]
        for counter in counters {
            var work = FacetSyncHostWork()
            work[keyPath: counter] = 1
            #expect(!work.isEmpty)
            #expect(
                FacetSyncStatus(transport: .connected, durable: durable(), work: work).phase
                    == .syncing)
        }
        for flag: WritableKeyPath<FacetSyncHostWork, Bool> in [\.processing, \.dirty] {
            var work = FacetSyncHostWork()
            work[keyPath: flag] = true
            #expect(
                FacetSyncStatus(transport: .connected, durable: durable(), work: work).phase
                    == .syncing)
        }
    }

    @Test func disconnectedUnauthorizedFailedAndStoppedNeverReportSynced() {
        for phase: FacetSyncTransportPhase in [
            .connecting, .offline, .reconnectRequired, .failed, .stopped,
        ] {
            #expect(FacetSyncStatus(transport: phase, durable: durable()).phase != .synced)
        }
    }

    @Test @MainActor func activityDuringDurableReadInvalidatesTheObservation() async throws {
        var revision: UInt64 = 0
        let state = try await FacetSyncStatusObservation.read(
            observe: {
                FacetSyncHostObservation(
                    activityRevision: revision, queueRevision: 0, authorized: true,
                    transport: .connected, work: FacetSyncHostWork())
            },
            durable: {
                // Work can begin and finish while an engine read is suspended.
                // Empty queues after it finishes must not bless the old read.
                revision += 1
                return durable()
            })
        #expect(state.durable == nil)
        #expect(state.phase == .syncing)
    }

    @Test @MainActor func localMutationBetweenReadsCannotProduceFalseConvergence() async throws {
        var reads = 0
        let state = try await FacetSyncStatusObservation.read(
            observe: {
                FacetSyncHostObservation(
                    activityRevision: 0, queueRevision: 0, authorized: true,
                    transport: .connected, work: FacetSyncHostWork())
            },
            durable: {
                reads += 1
                return durable(upload: reads == 1 ? 0 : 1)
            })
        #expect(state.phase == .syncing)
        #expect(state.durable == nil)
    }

    @Test @MainActor func queueAndAccountChangesFenceOldDurableState() async throws {
        for loseAuthorization in [false, true] {
            var afterRead = false
            let state = try await FacetSyncStatusObservation.read(
                observe: {
                    FacetSyncHostObservation(
                        activityRevision: 0, queueRevision: afterRead ? 1 : 0,
                        authorized: !(afterRead && loseAuthorization),
                        transport: .connected, work: FacetSyncHostWork())
                },
                durable: {
                    afterRead = true
                    return durable()
                })
            #expect(state.durable == nil)
            #expect(state.phase == (loseAuthorization ? .reconnectRequired : .syncing))
        }
    }

    @Test func eventQueueObservesBufferedAndWaitingWorkAndClosesItsProducers() async {
        let queue = FacetSyncEventQueue<Int>(capacity: 1)
        #expect(await queue.send(1))
        let waiting = _Concurrency.Task { await queue.send(2) }
        while await queue.pendingCount() < 2 { await _Concurrency.Task.yield() }
        let before = await queue.observation()
        #expect(before.count == 2)
        #expect(await queue.next() == 1)
        #expect(await waiting.value)
        #expect(await queue.pendingCount() == 1)
        await queue.close()
        #expect(await queue.pendingCount() == 0)
        #expect(await queue.observation().revision > before.revision)
        #expect(await queue.next() == nil)
    }
}
