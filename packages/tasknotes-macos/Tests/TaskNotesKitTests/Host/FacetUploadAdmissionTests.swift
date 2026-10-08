import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

struct FacetUploadAdmissionTests {
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
            case .waiting: #expect(clock < 40)
            case .accepted: #expect(clock == 40)
            }
        }
        #expect(randomCalls == 1)
        #expect(received.count == 4)
        #expect(received.allSatisfy { $0.nowMs == 10 && $0.nonce == received.first?.nonce })
        #expect(received.first?.nonce == Data(repeating: 1, count: 12))
    }
}
