import Foundation
@testable import GlanceApp
import Testing

struct SnapshotStoreTests {
    // MARK: Internal

    @Test
    func `write and read roundtrip`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let snapshot = self.makeSnapshot(
            status: .warning,
            summary: "High CPU",
            error: "CPU at 95%",
        )

        try await store.save([snapshot])
        let results = try await store.history(
            for: "test-provider",
            last: 3600,
        )

        #expect(results.count == 1)
        let persisted = results[0]
        #expect(persisted.providerId == "test-provider")
        #expect(persisted.serviceStatus == .warning)
        #expect(persisted.summary == "High CPU")
        #expect(persisted.error == "CPU at 95%")
        #expect(persisted.id != nil)
    }

    @Test
    func `history returns correct date range`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let now = Date.now
        let oldSnapshot = self.makeSnapshot(
            timestamp: now.addingTimeInterval(-7200),
        )
        let recentSnapshot = self.makeSnapshot(
            summary: "Recent",
            timestamp: now.addingTimeInterval(-1800),
        )

        try await store.save([oldSnapshot, recentSnapshot])

        // Query last hour — should only get the recent one
        let results = try await store.history(
            for: "test-provider",
            last: 3600,
        )
        #expect(results.count == 1)
        #expect(results[0].summary == "Recent")

        // Query last 3 hours — should get both
        let allResults = try await store.history(
            for: "test-provider",
            last: 10800,
        )
        #expect(allResults.count == 2)
    }

    @Test
    func `history is ordered by timestamp ascending`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let now = Date.now

        try await store.save([
            self.makeSnapshot(summary: "Second", timestamp: now.addingTimeInterval(-100)),
            self.makeSnapshot(summary: "First", timestamp: now.addingTimeInterval(-200)),
            self.makeSnapshot(summary: "Third", timestamp: now.addingTimeInterval(-50)),
        ])

        let results = try await store.history(for: "test-provider", last: 3600)
        #expect(results.map(\.summary) == ["First", "Second", "Third"])
    }

    @Test
    func `latestPerProvider returns one per provider`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let now = Date.now

        try await store.save([
            self.makeSnapshot(
                id: "kubernetes",
                summary: "Old K8s",
                timestamp: now.addingTimeInterval(-600),
            ),
            self.makeSnapshot(
                id: "kubernetes",
                summary: "New K8s",
                timestamp: now.addingTimeInterval(-60),
            ),
            self.makeSnapshot(
                id: "argocd",
                summary: "Argo OK",
                timestamp: now.addingTimeInterval(-120),
            ),
        ])

        let latest = try await store.latestPerProvider()
        #expect(latest.count == 2)

        let k8s = latest.first { $0.providerId == "kubernetes" }
        #expect(k8s?.summary == "New K8s")

        let argo = latest.first { $0.providerId == "argocd" }
        #expect(argo?.summary == "Argo OK")
    }

    @Test
    func `prune removes old data`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let now = Date.now

        try await store.save([
            self.makeSnapshot(
                summary: "Ancient",
                timestamp: now.addingTimeInterval(-86400 * 10),
            ),
            self.makeSnapshot(
                summary: "Recent",
                timestamp: now.addingTimeInterval(-3600),
            ),
        ])

        // Prune anything older than 7 days
        try await store.prune(olderThan: 86400 * 7)

        let results = try await store.history(
            for: "test-provider",
            last: 86400 * 30,
        )
        #expect(results.count == 1)
        #expect(results[0].summary == "Recent")
    }

    @Test
    func `history filters by provider id`() async throws {
        let store = try SnapshotStore(inMemory: true)

        try await store.save([
            self.makeSnapshot(id: "kubernetes", summary: "K8s"),
            self.makeSnapshot(id: "argocd", summary: "Argo"),
        ])

        let k8sResults = try await store.history(
            for: "kubernetes",
            last: 3600,
        )
        #expect(k8sResults.count == 1)
        #expect(k8sResults[0].summary == "K8s")

        let argoResults = try await store.history(
            for: "argocd",
            last: 3600,
        )
        #expect(argoResults.count == 1)
        #expect(argoResults[0].summary == "Argo")
    }

    @Test
    func `databaseSize returns zero for in-memory`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let size = await store.databaseSize()
        #expect(size == 0)
    }

    @Test
    func `concurrent access does not crash`() async throws {
        let store = try SnapshotStore(inMemory: true)

        // Perform concurrent writes and reads
        try await withThrowingTaskGroup(of: Void.self) { group in
            for idx in 0 ..< 20 {
                group.addTask {
                    let snapshot = ServiceSnapshot(
                        id: "provider-\(idx % 5)",
                        displayName: "Provider \(idx)",
                        iconName: "circle",
                        status: .ok,
                        summary: "Snapshot \(idx)",
                        detail: .empty,
                        error: nil,
                        timestamp: .now,
                    )
                    try await store.save([snapshot])
                }
                group.addTask {
                    _ = try await store.history(
                        for: "provider-\(idx % 5)",
                        last: 3600,
                    )
                }
            }
            try await group.waitForAll()
        }

        // Verify all writes succeeded
        let latest = try await store.latestPerProvider()
        #expect(latest.count == 5)
    }

    @Test
    func `all status values roundtrip correctly`() async throws {
        let store = try SnapshotStore(inMemory: true)
        let statuses: [ServiceStatus] = [.ok, .warning, .error, .unknown]

        for (idx, status) in statuses.enumerated() {
            try await store.save([
                self.makeSnapshot(
                    id: "provider-\(idx)",
                    status: status,
                    timestamp: .now,
                ),
            ])
        }

        for (idx, expectedStatus) in statuses.enumerated() {
            let results = try await store.history(
                for: "provider-\(idx)",
                last: 3600,
            )
            #expect(results.count == 1)
            #expect(results[0].serviceStatus == expectedStatus)
        }
    }

    // MARK: Private

    /// Helper to create a test snapshot with the given parameters.
    private func makeSnapshot(
        id: String = "test-provider",
        status: ServiceStatus = .ok,
        summary: String = "All good",
        error: String? = nil,
        timestamp: Date = .now,
    ) -> ServiceSnapshot {
        ServiceSnapshot(
            id: id,
            displayName: "Test",
            iconName: "circle",
            status: status,
            summary: summary,
            detail: .empty,
            error: error,
            timestamp: timestamp,
        )
    }
}
