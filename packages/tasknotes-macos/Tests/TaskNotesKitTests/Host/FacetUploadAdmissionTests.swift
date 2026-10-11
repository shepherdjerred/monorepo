import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

struct FacetUploadAdmissionTests {
    @Test func blockedAndLaterDurableEntriesRetainUnadmittedNonce() throws {
        var ledger = FacetUploadAdmissions()
        for id in ["undone", "pending"] {
            _ = try ledger.attempt(
                id: id, at: 10, random: { Data(repeating: 1, count: 12) },
                queue: { _ in throw ObsidianBoundaryError.Busy })
        }
        #expect(ledger.pendingCount == 2)
        ledger.retireIfEmpty(observedRevision: ledger.revision, pendingUploadCount: 2)
        #expect(ledger.pendingCount == 2)
        _ = try ledger.attempt(
            id: "pending", at: 20, random: { Data(repeating: 2, count: 12) },
            queue: {
                #expect($0.nowMs == 10)
                #expect($0.nonce == Data(repeating: 1, count: 12))
                return []
            })
        #expect(ledger.pendingCount == 1)
        ledger.retireIfEmpty(observedRevision: ledger.revision, pendingUploadCount: 0)
        #expect(ledger.pendingCount == 0)
    }

    @Test func newerAdmissionDuringDurableReadCannotLoseItsNonce() throws {
        var ledger = FacetUploadAdmissions()
        _ = try ledger.attempt(
            id: "old", at: 10, random: { Data(repeating: 1, count: 12) },
            queue: { _ in throw ObsidianBoundaryError.Busy })
        let revisionBeforeDurableRead = ledger.revision
        _ = try ledger.attempt(
            id: "new", at: 20, random: { Data(repeating: 2, count: 12) },
            queue: { _ in throw ObsidianBoundaryError.Busy })
        ledger.retireIfEmpty(observedRevision: revisionBeforeDurableRead, pendingUploadCount: 0)
        #expect(ledger.pendingCount == 2)
        _ = try ledger.attempt(
            id: "new", at: 30, random: { Data(repeating: 3, count: 12) },
            queue: {
                #expect($0.nowMs == 20)
                #expect($0.nonce == Data(repeating: 2, count: 12))
                return []
            })
        #expect(ledger.pendingCount == 1)
    }

    @Test func busyAndQueueFullRetainOriginalNonceAndAdmissionTimeUntilAcceptance() throws {
        var ledger = FacetUploadAdmissions()
        var randomCalls = 0
        var received: [FacetUploadAdmissions.Request] = []
        for clock in [UInt64(10), 20, 30, 40] {
            let outcome = try ledger.attempt(
                id: "immutable-operation", at: clock,
                random: {
                    randomCalls += 1
                    return Data(repeating: UInt8(randomCalls), count: 12)
                },
                queue: { request in
                    received.append(request)
                    if received.count <= 2 { throw ObsidianBoundaryError.Busy }
                    if received.count == 3 {
                        throw ObsidianBoundaryError.Boundary(
                            code: "queue_full", detail: "Queue is full.")
                    }
                    return []
                })
            switch outcome {
            case .waiting:
                #expect(clock < 40)
                #expect(ledger.pendingCount == 1)
            case .accepted:
                #expect(clock == 40)
                #expect(ledger.pendingCount == 0)
            }
        }
        #expect(randomCalls == 1)
        #expect(received.count == 4)
        #expect(received.allSatisfy { $0.nowMs == 10 && $0.nonce == received.first?.nonce })
        #expect(received.first?.nonce == Data(repeating: 1, count: 12))
    }
}
