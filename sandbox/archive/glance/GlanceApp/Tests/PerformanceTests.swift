import Foundation
@testable import GlanceApp
import Testing

struct PerformanceTests {
    @Test
    func `concurrent refresh with 18 providers completes within 5 seconds`() async {
        let providers: [any ServiceProvider] = (0 ..< 18).map { idx in
            MockServiceProvider(
                id: "provider-\(idx)",
                displayName: "Provider \(idx)",
                status: .ok,
                summary: "Healthy",
            )
        }

        let clock = ContinuousClock()
        let duration = await clock.measure {
            await withTaskGroup(of: ServiceSnapshot.self) { group in
                for provider in providers {
                    group.addTask {
                        await provider.fetchStatus()
                    }
                }
                for await _ in group {}
            }
        }

        #expect(duration < .seconds(5))
    }

    @Test
    func `snapshot store query with 1000 rows completes within 100ms`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let now = Date.now

        // Insert 1000 snapshots for a single provider spread over 24 hours.
        let batch: [ServiceSnapshot] = (0 ..< 1000).map { idx in
            ServiceSnapshot(
                id: "test-provider",
                displayName: "Test",
                iconName: "circle",
                status: idx.isMultiple(of: 3) ? .warning : .ok,
                summary: "Snapshot \(idx)",
                detail: .empty,
                error: nil,
                timestamp: now.addingTimeInterval(Double(-1000 + idx) * 86.4),
            )
        }

        try await store.save(batch)

        let clock = ContinuousClock()
        var results: [PersistedSnapshot] = []
        let duration = try await clock.measure {
            results = try await store.history(
                for: "test-provider",
                last: 86400 + 60,
            )
        }

        #expect(results.count == 1000)
        #expect(duration < .milliseconds(100))
    }
}
