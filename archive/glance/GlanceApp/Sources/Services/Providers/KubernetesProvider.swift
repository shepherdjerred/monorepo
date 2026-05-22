import Foundation
import OSLog

// MARK: - KubernetesProvider

/// Monitors Kubernetes pod and node health via kubectl.
struct KubernetesProvider: ServiceProvider {
    // MARK: Internal

    let id = "kubernetes"
    let displayName = "Kubernetes"
    let iconName = "square.3.layers.3d"
    let webURL: String? = nil

    /// Parse Kubernetes node and pod JSON data into a ServiceSnapshot.
    static func parse(nodesData: Data, podsData: Data) throws -> ServiceSnapshot {
        let nodes = try parseNodes(from: nodesData)
        let pods = try parsePods(from: podsData)

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
            id: "kubernetes",
            displayName: "Kubernetes",
            iconName: "square.3.layers.3d",
            status: status,
            summary: summary,
            detail: .kubernetes(detail: KubernetesDetail(pods: pods, nodes: nodes)),
            error: nil,
            timestamp: .now,
        )
    }

    /// Parse node metrics JSON into KubernetesNodeMetric values.
    static func parseNodeMetrics(from data: Data) throws -> [KubernetesNodeMetric] {
        let response = try JSONDecoder().decode(K8sMetricsNodeList.self, from: data)
        return response.items.map { item in
            KubernetesNodeMetric(
                name: item.metadata.name,
                cpuMillicores: self.parseCPU(item.usage.cpu),
                memoryMB: self.parseMemory(item.usage.memory),
            )
        }
    }

    /// Parse a Kubernetes CPU resource string into millicores.
    /// Examples: "250m" -> 250, "1" -> 1000, "1500000n" -> 1
    static func parseCPU(_ value: String) -> Int {
        if value.hasSuffix("n") {
            let nano = Int(value.dropLast()) ?? 0
            return nano / 1_000_000
        } else if value.hasSuffix("u") {
            let micro = Int(value.dropLast()) ?? 0
            return micro / 1000
        } else if value.hasSuffix("m") {
            return Int(value.dropLast()) ?? 0
        } else {
            // Whole cores
            return (Int(value) ?? 0) * 1000
        }
    }

    /// Parse a Kubernetes memory resource string into megabytes.
    /// Examples: "1024Ki" -> 1, "2Gi" -> 2048, "1048576" -> 1
    static func parseMemory(_ value: String) -> Int {
        if value.hasSuffix("Ki") {
            let ki = Int(value.dropLast(2)) ?? 0
            return ki / 1024
        } else if value.hasSuffix("Mi") {
            return Int(value.dropLast(2)) ?? 0
        } else if value.hasSuffix("Gi") {
            let gi = Int(value.dropLast(2)) ?? 0
            return gi * 1024
        } else if value.hasSuffix("Ti") {
            let ti = Int(value.dropLast(2)) ?? 0
            return ti * 1024 * 1024
        } else {
            // Plain bytes
            let bytes = Int(value) ?? 0
            return bytes / (1024 * 1024)
        }
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            async let nodesData = shellCommand("kubectl", arguments: [
                "get", "nodes", "-o", "json", "--request-timeout=8s",
            ])
            async let podsData = shellCommand(
                "kubectl",
                arguments: [
                    "get", "pods", "--all-namespaces", "-o", "json",
                    "--field-selector", "status.phase!=Running,status.phase!=Succeeded",
                    "--request-timeout=8s",
                ],
            )

            return try await Self.parse(nodesData: nodesData, podsData: podsData)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            log.debug("Fetching deep Kubernetes data")

            async let nodesData = shellCommand("kubectl", arguments: [
                "get", "nodes", "-o", "json", "--request-timeout=8s",
            ])
            async let podsData = shellCommand(
                "kubectl",
                arguments: [
                    "get", "pods", "--all-namespaces", "-o", "json",
                    "--field-selector", "status.phase!=Running,status.phase!=Succeeded",
                    "--request-timeout=8s",
                ],
            )
            async let eventsData = shellCommand("kubectl", arguments: [
                "get", "events", "--sort-by=.lastTimestamp", "-o", "json", "--request-timeout=8s",
            ])
            async let daemonSetsData = shellCommand("kubectl", arguments: [
                "get", "daemonsets", "-A", "-o", "json", "--request-timeout=8s",
            ])
            async let statefulSetsData = shellCommand("kubectl", arguments: [
                "get", "statefulsets", "-A", "-o", "json", "--request-timeout=8s",
            ])
            async let pvcsData = shellCommand("kubectl", arguments: [
                "get", "pvc", "-A", "-o", "json", "--request-timeout=8s",
            ])

            let nodes = try await Self.parseNodes(from: nodesData)
            let pods = try await Self.parsePods(from: podsData)
            let events = try await Self.parseEvents(from: eventsData)
            let daemonSets = try await Self.parseDaemonSets(from: daemonSetsData)
            let statefulSets = try await Self.parseStatefulSets(from: statefulSetsData)
            let pvcs = try await Self.parsePVCs(from: pvcsData)

            // Fetch node metrics (optional — metrics-server may not be installed)
            let nodeMetrics = await Self.fetchNodeMetrics(log: log)

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .kubernetes(detail: KubernetesDetail(
                pods: pods,
                nodes: nodes,
                events: Array(events.suffix(50)),
                daemonSets: daemonSets,
                statefulSets: statefulSets,
                pvcs: pvcs,
                nodeMetrics: nodeMetrics,
            ))
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Deep fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return .empty
        }
    }

    // MARK: Private

    private static func parseNodes(from data: Data) throws -> [KubernetesNode] {
        let response = try JSONDecoder().decode(K8sNodeList.self, from: data)
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

    private static func parsePods(from data: Data) throws -> [KubernetesPod] {
        let response = try JSONDecoder().decode(K8sPodList.self, from: data)
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

    private static func parseEvents(from data: Data) throws -> [KubernetesEvent] {
        let response = try JSONDecoder().decode(K8sEventList.self, from: data)
        return response.items.map { item in
            KubernetesEvent(
                reason: item.reason ?? "Unknown",
                message: item.message ?? "",
                involvedObject: "\(item.involvedObject.kind)/\(item.involvedObject.name)",
                namespace: item.involvedObject.namespace ?? "default",
                type: item.type ?? "Normal",
                count: item.count ?? 1,
                lastTimestamp: item.lastTimestamp,
            )
        }
    }

    private static func parseDaemonSets(from data: Data) throws -> [KubernetesDaemonSet] {
        let response = try JSONDecoder().decode(K8sDaemonSetList.self, from: data)
        return response.items.map { item in
            KubernetesDaemonSet(
                name: item.metadata.name,
                namespace: item.metadata.namespace,
                desiredScheduled: item.status.desiredNumberScheduled,
                ready: item.status.numberReady,
            )
        }
    }

    private static func parseStatefulSets(from data: Data) throws -> [KubernetesStatefulSet] {
        let response = try JSONDecoder().decode(K8sStatefulSetList.self, from: data)
        return response.items.map { item in
            KubernetesStatefulSet(
                name: item.metadata.name,
                namespace: item.metadata.namespace,
                replicas: item.status.replicas ?? 0,
                readyReplicas: item.status.readyReplicas ?? 0,
            )
        }
    }

    private static func parsePVCs(from data: Data) throws -> [KubernetesPVC] {
        let response = try JSONDecoder().decode(K8sPVCList.self, from: data)
        return response.items.map { item in
            KubernetesPVC(
                name: item.metadata.name,
                namespace: item.metadata.namespace,
                phase: item.status?.phase ?? "Unknown",
                capacity: item.status?.capacity?["storage"],
                storageClass: item.spec.storageClassName,
            )
        }
    }

    /// Fetch node metrics from the metrics-server API.
    /// Returns an empty array if metrics-server is not available.
    private static func fetchNodeMetrics(log: Logger) async -> [KubernetesNodeMetric] {
        do {
            let data = try await shellCommand("kubectl", arguments: [
                "get", "--raw", "/apis/metrics.k8s.io/v1beta1/nodes",
                "--request-timeout=8s",
            ])
            return try self.parseNodeMetrics(from: data)
        } catch {
            log.info(
                "Node metrics unavailable (metrics-server may not be installed): \(error, privacy: .public)",
            )
            return []
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
