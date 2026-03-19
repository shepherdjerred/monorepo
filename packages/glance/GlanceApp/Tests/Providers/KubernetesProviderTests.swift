import Foundation
@testable import GlanceApp
import Testing

struct KubernetesProviderTests {
    @Test
    func `healthy cluster returns ok`() throws {
        let snapshot = try KubernetesProvider.parse(
            nodesData: KubernetesFixtures.healthyNodesJSON,
            podsData: KubernetesFixtures.emptyPodsJSON,
        )
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary.contains("3 nodes"))
        #expect(snapshot.summary.contains("0 unhealthy pods"))
    }

    @Test
    func `node not ready returns error`() throws {
        let snapshot = try KubernetesProvider.parse(
            nodesData: KubernetesFixtures.nodeNotReadyJSON,
            podsData: KubernetesFixtures.emptyPodsJSON,
        )
        #expect(snapshot.status == .error)
    }

    @Test
    func `unhealthy pods returns warning`() throws {
        let snapshot = try KubernetesProvider.parse(
            nodesData: KubernetesFixtures.healthyNodesJSON,
            podsData: KubernetesFixtures.unhealthyPodsJSON,
        )
        #expect(snapshot.status == .warning)
        #expect(snapshot.summary.contains("2 unhealthy pods"))
    }

    @Test
    func `empty cluster returns ok`() throws {
        let snapshot = try KubernetesProvider.parse(
            nodesData: KubernetesFixtures.emptyNodesJSON,
            podsData: KubernetesFixtures.emptyPodsJSON,
        )
        #expect(snapshot.status == .ok)
    }

    @Test
    func `pod with no container status`() throws {
        let snapshot = try KubernetesProvider.parse(
            nodesData: KubernetesFixtures.healthyNodesJSON,
            podsData: KubernetesFixtures.podWithNoContainerStatusJSON,
        )
        guard case let .kubernetes(detail) = snapshot.detail else {
            Issue.record("Expected k8s detail")
            return
        }
        let pod = try #require(detail.pods.first)
        #expect(!pod.ready)
        #expect(pod.restarts == 0)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try KubernetesProvider.parse(
                nodesData: Data("x".utf8),
                podsData: Data("x".utf8),
            )
        }
    }
}
