import Foundation

// MARK: - KubernetesProvider

/// Monitors Kubernetes pod and node health via kubectl.
struct KubernetesProvider: ServiceProvider {
    // MARK: Internal

    let id = "kubernetes"
    let displayName = "Kubernetes"
    let iconName = "square.3.layers.3d"
    let webURL: String? = nil

    func fetchStatus() async -> ServiceSnapshot {
        do {
            async let nodesResult = self.fetchNodes()
            async let podsResult = self.fetchUnhealthyPods()

            let nodes = try await nodesResult
            let pods = try await podsResult

            let nodesNotReady = nodes.filter { !$0.ready }
            let unhealthyPodCount = pods.count

            let status: ServiceStatus =
                if nodesNotReady.isEmpty, unhealthyPodCount == 0 {
                    .ok
                } else if !nodesNotReady.isEmpty {
                    .error
                } else {
                    .warning
                }

            let summary = "\(nodes.count) nodes, \(unhealthyPodCount) unhealthy pod\(unhealthyPodCount == 1 ? "" : "s")"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .kubernetes(pods: pods, nodes: nodes),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private func fetchNodes() async throws -> [KubernetesNode] {
        let output = try await shellCommand("kubectl", arguments: [
            "get", "nodes", "-o", "json", "--request-timeout=8s",
        ])
        let response = try JSONDecoder().decode(K8sNodeList.self, from: output)
        return response.items.map { item in
            let ready = item.status.conditions.contains { $0.type == "Ready" && $0.status == "True" }
            let roles = item.metadata.labels
                .filter { $0.key.hasPrefix("node-role.kubernetes.io/") }
                .map { String($0.key.dropFirst("node-role.kubernetes.io/".count)) }
            return KubernetesNode(
                name: item.metadata.name,
                ready: ready,
                roles: roles,
                version: item.status.nodeInfo.kubeletVersion,
            )
        }
    }

    private func fetchUnhealthyPods() async throws -> [KubernetesPod] {
        let output = try await shellCommand(
            "kubectl",
            arguments: [
                "get", "pods", "--all-namespaces", "-o", "json",
                "--field-selector", "status.phase!=Running,status.phase!=Succeeded",
                "--request-timeout=8s",
            ],
        )
        let response = try JSONDecoder().decode(K8sPodList.self, from: output)
        return response.items.map { item in
            let ready = item.status.containerStatuses?.allSatisfy(\.ready) ?? false
            let restarts = item.status.containerStatuses?.reduce(0) { $0 + $1.restartCount } ?? 0
            return KubernetesPod(
                name: item.metadata.name,
                namespace: item.metadata.namespace,
                phase: item.status.phase ?? "Unknown",
                ready: ready,
                restarts: restarts,
            )
        }
    }

    private func errorSnapshot(_ message: String) -> ServiceSnapshot {
        ServiceSnapshot(
            id: self.id,
            displayName: self.displayName,
            iconName: self.iconName,
            status: .unknown,
            summary: "Unreachable",
            detail: .empty,
            error: message,
            timestamp: .now,
        )
    }
}

// MARK: - K8sNodeList

private struct K8sNodeList: Codable {
    let items: [K8sNode]
}

// MARK: - K8sNode

private struct K8sNode: Codable {
    struct K8sNodeMetadata: Codable {
        let name: String
        let labels: [String: String]
    }

    struct K8sNodeStatus: Codable {
        struct NodeInfo: Codable {
            let kubeletVersion: String
        }

        let conditions: [K8sCondition]
        let nodeInfo: NodeInfo
    }

    let metadata: K8sNodeMetadata
    let status: K8sNodeStatus
}

// MARK: - K8sCondition

private struct K8sCondition: Codable {
    let type: String
    let status: String
}

// MARK: - K8sPodList

private struct K8sPodList: Codable {
    let items: [K8sPod]
}

// MARK: - K8sPod

private struct K8sPod: Codable {
    struct K8sPodMetadata: Codable {
        let name: String
        let namespace: String
    }

    struct K8sPodStatus: Codable {
        struct ContainerStatus: Codable {
            let ready: Bool
            let restartCount: Int
        }

        let phase: String?
        let containerStatuses: [ContainerStatus]?
    }

    let metadata: K8sPodMetadata
    let status: K8sPodStatus
}
