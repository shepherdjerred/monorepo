import Foundation
@testable import GlanceApp
import Testing

struct ViewLogicTests {
    // MARK: Internal

    // MARK: - ServiceCategory.category(for:) Tests

    @Test(arguments: [
        ("kubernetes", ServiceCategory.infrastructure),
        ("talos", ServiceCategory.infrastructure),
        ("certmanager", ServiceCategory.infrastructure),
        ("velero", ServiceCategory.infrastructure),
        ("cloudflare", ServiceCategory.infrastructure),
        ("argocd", ServiceCategory.cicd),
        ("buildkite", ServiceCategory.cicd),
        ("github", ServiceCategory.cicd),
        ("prometheus", ServiceCategory.observability),
        ("alertmanager", ServiceCategory.observability),
        ("grafana", ServiceCategory.observability),
        ("loki", ServiceCategory.observability),
        ("bugsink", ServiceCategory.observability),
        ("pagerduty", ServiceCategory.observability),
        ("anthropic-api", ServiceCategory.usage),
        ("openai-api", ServiceCategory.usage),
        ("claude-code", ServiceCategory.usage),
        ("codex", ServiceCategory.usage),
    ])
    func `category for provider returns correct category`(
        providerId: String,
        expected: ServiceCategory,
    ) {
        let result = ServiceCategory.category(for: providerId)
        #expect(result == expected)
    }

    @Test
    func `category for unknown provider returns nil`() {
        #expect(ServiceCategory.category(for: "nonexistent") == nil)
    }

    // MARK: - ServiceSearchScope Filtering Tests

    @Test
    func `errorsOnly scope filters to errors and warnings`() {
        let snapshots = self.sampleSnapshots()
        let filtered = snapshots.filter { $0.status == .error || $0.status == .warning }

        #expect(filtered.count == 2)
        #expect(filtered.allSatisfy { $0.status == .error || $0.status == .warning })
    }

    @Test
    func `infrastructure scope filters to infrastructure providers`() {
        let snapshots = self.sampleSnapshots()
        let ids = ServiceCategory.infrastructure.providerIds
        let filtered = snapshots.filter { ids.contains($0.id) }

        #expect(filtered.count == 1)
        #expect(filtered[0].id == "kubernetes")
    }

    @Test
    func `cicd scope filters to CI/CD providers`() {
        let snapshots = self.sampleSnapshots()
        let ids = ServiceCategory.cicd.providerIds
        let filtered = snapshots.filter { ids.contains($0.id) }

        #expect(filtered.count == 1)
        #expect(filtered[0].id == "github")
    }

    @Test
    func `text search filters by display name case-insensitively`() {
        let snapshots = self.sampleSnapshots()
        let searchText = "kube"
        let filtered = snapshots.filter { snapshot in
            snapshot.displayName.localizedCaseInsensitiveContains(searchText)
                || snapshot.summary.localizedCaseInsensitiveContains(searchText)
        }

        #expect(filtered.count == 1)
        #expect(filtered[0].id == "kubernetes")
    }

    @Test
    func `text search filters by summary`() {
        let snapshots = self.sampleSnapshots()
        let searchText = "firing"
        let filtered = snapshots.filter { snapshot in
            snapshot.displayName.localizedCaseInsensitiveContains(searchText)
                || snapshot.summary.localizedCaseInsensitiveContains(searchText)
        }

        #expect(filtered.count == 1)
        #expect(filtered[0].id == "alertmanager")
    }

    // MARK: - Status Summary Computation Tests

    @Test
    func `status summary counts correctly with mixed statuses`() {
        let snapshots = self.sampleSnapshots()
        let counts = Dictionary(grouping: snapshots, by: \.status).mapValues(\.count)

        #expect(counts[.ok] == 2)
        #expect(counts[.warning] == 1)
        #expect(counts[.error] == 1)
    }

    @Test
    func `status summary with all OK services`() {
        let snapshots = (0 ..< 5).map { idx in
            self.makeSnapshot(id: "svc-\(idx)", displayName: "Service \(idx)", status: .ok)
        }
        let counts = Dictionary(grouping: snapshots, by: \.status).mapValues(\.count)

        #expect(counts[.ok] == 5)
        #expect(counts[.warning, default: 0] == 0)
        #expect(counts[.error, default: 0] == 0)
    }

    @Test
    func `status summary with empty snapshots`() {
        let snapshots: [ServiceSnapshot] = []
        let counts = Dictionary(grouping: snapshots, by: \.status).mapValues(\.count)

        #expect(counts.isEmpty)
    }

    @Test
    func `overall health is worst status`() {
        let snapshots = self.sampleSnapshots()
        let overall = snapshots.map(\.status).max() ?? .unknown

        #expect(overall == .error)
    }

    @Test
    func `overall health of empty snapshots is unknown`() {
        let snapshots: [ServiceSnapshot] = []
        let overall = snapshots.map(\.status).max() ?? .unknown

        #expect(overall == .unknown)
    }

    // MARK: - ServiceCategory Exhaustiveness

    @Test
    func `all categories have non-empty provider IDs`() {
        for category in ServiceCategory.allCases {
            #expect(!category.providerIds.isEmpty)
        }
    }

    @Test
    func `no provider ID belongs to multiple categories`() {
        var seen: [String: ServiceCategory] = [:]
        for category in ServiceCategory.allCases {
            for providerId in category.providerIds {
                if let existing = seen[providerId] {
                    Issue.record("\(providerId) found in both \(existing) and \(category)")
                }
                seen[providerId] = category
            }
        }
    }

    // MARK: Private

    // MARK: - Helpers

    private func sampleSnapshots() -> [ServiceSnapshot] {
        [
            self.makeSnapshot(id: "kubernetes", displayName: "Kubernetes", status: .ok, summary: "5 nodes ready"),
            self.makeSnapshot(id: "github", displayName: "GitHub", status: .ok, summary: "3 open PRs"),
            self.makeSnapshot(
                id: "alertmanager",
                displayName: "Alertmanager",
                status: .warning,
                summary: "1 alert firing",
            ),
            self.makeSnapshot(
                id: "anthropic-api",
                displayName: "Anthropic",
                status: .error,
                summary: "API unreachable",
            ),
        ]
    }

    private func makeSnapshot(
        id: String = "test",
        displayName: String = "Test",
        status: ServiceStatus = .ok,
        summary: String = "OK",
    ) -> ServiceSnapshot {
        ServiceSnapshot(
            id: id,
            displayName: displayName,
            iconName: "circle",
            status: status,
            summary: summary,
            detail: .empty,
            error: nil,
            timestamp: .now,
        )
    }
}
