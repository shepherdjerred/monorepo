import Charts
import SwiftUI

// MARK: - KubernetesDetailView

/// Detail view showing Kubernetes pod, node, event, and resource status.
struct KubernetesDetailView: View {
    // MARK: Internal

    let detail: KubernetesDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.podStatusChart
            if !self.detail.nodeMetrics.isEmpty {
                self.resourceUsageSection
            }
            self.nodesSection
            self.podsSection
            if !self.detail.daemonSets.isEmpty {
                self.daemonSetsSection
            }
            if !self.detail.statefulSets.isEmpty {
                self.statefulSetsSection
            }
            if !self.detail.pvcs.isEmpty {
                self.pvcsSection
            }
            if !self.detail.events.isEmpty {
                self.eventsSection
            }
        }
        .sheet(item: self.$selectedPod) { pod in
            KubernetesPodDetailSheet(pod: pod, selectedPod: self.$selectedPod)
        }
    }

    // MARK: Private

    @State private var nodeSortOrder = [KeyPathComparator(\KubernetesNode.name)]
    @State private var podSortOrder = [KeyPathComparator(\KubernetesPod.name)]
    @State private var daemonSetSortOrder = [KeyPathComparator(\KubernetesDaemonSet.name)]
    @State private var statefulSetSortOrder = [KeyPathComparator(\KubernetesStatefulSet.name)]
    @State private var pvcSortOrder = [KeyPathComparator(\KubernetesPVC.name)]
    @State private var eventSortOrder = [KeyPathComparator(\KubernetesEvent.reason)]
    @State private var selectedPod: KubernetesPod?

    private var sortedNodes: [KubernetesNode] {
        self.detail.nodes.sorted(using: self.nodeSortOrder)
    }

    private var sortedUnhealthyPods: [KubernetesPod] {
        self.detail.pods
            .filter { !$0.ready || $0.phase != "Running" }
            .sorted(using: self.podSortOrder)
    }

    private var sortedDaemonSets: [KubernetesDaemonSet] {
        self.detail.daemonSets.sorted(using: self.daemonSetSortOrder)
    }

    private var sortedStatefulSets: [KubernetesStatefulSet] {
        self.detail.statefulSets.sorted(using: self.statefulSetSortOrder)
    }

    // MARK: - Resource Usage

    @ViewBuilder
    private var resourceUsageSection: some View {
        Text("Resource Usage")
            .font(.headline)

        ForEach(self.detail.nodeMetrics) { metric in
            VStack(alignment: .leading, spacing: 4) {
                Text(metric.name)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Gauge(value: Double(metric.cpuMillicores), in: 0 ... 4000) {
                    Text("CPU")
                } currentValueLabel: {
                    Text("\(metric.cpuMillicores)m")
                }
                .tint(.blue)

                Gauge(
                    value: Double(metric.memoryMB),
                    in: 0 ... 65536,
                ) {
                    Text("Memory")
                } currentValueLabel: {
                    Text(formatMemory(metric.memoryMB))
                }
                .tint(.purple)
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - Pod Status Chart

    @ViewBuilder
    private var podStatusChart: some View {
        if !self.detail.pods.isEmpty {
            let podsByPhase = Dictionary(grouping: self.detail.pods) { $0.phase }
                .map { (phase: $0.key, count: $0.value.count) }
                .sorted { $0.count > $1.count }

            Text("Pod Status Distribution")
                .font(.headline)

            Chart(podsByPhase, id: \.phase) { group in
                BarMark(
                    x: .value("Count", group.count),
                    y: .value("Phase", group.phase),
                )
                .foregroundStyle(kubernetesPhaseColor(group.phase))
            }
            .frame(height: min(CGFloat(podsByPhase.count) * 32 + 40, 150))
        }
    }

    // MARK: - Nodes

    @ViewBuilder
    private var nodesSection: some View {
        Text("Nodes")
            .font(.headline)

        if self.detail.nodes.isEmpty {
            Text("No nodes found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedNodes, sortOrder: self.$nodeSortOrder) {
                TableColumn("Name", value: \.name) { node in
                    Text(node.name)
                        .fontWeight(.medium)
                }
                TableColumn("Version", value: \.version) { node in
                    Text(node.version)
                        .font(.caption.monospaced())
                }
                .width(100)
                TableColumn("Roles") { node in
                    Text(node.roles.joined(separator: ", "))
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Ready") { node in
                    kubernetesReadyBadge(node.ready)
                }
                .width(60)
            }
            .alternatingRowBackgrounds()
            .frame(height: 150)
        }
    }

    // MARK: - Pods

    @ViewBuilder
    private var podsSection: some View {
        Text("Unhealthy Pods")
            .font(.headline)

        let unhealthyPods = self.detail.pods.filter { !$0.ready || $0.phase != "Running" }

        if unhealthyPods.isEmpty {
            Label("All pods healthy", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
        } else {
            Table(self.sortedUnhealthyPods, sortOrder: self.$podSortOrder) {
                TableColumn("Pod", value: \.name) { pod in
                    Text(pod.name)
                        .fontWeight(.medium)
                        .lineLimit(1)
                }
                TableColumn("Namespace", value: \.namespace) { pod in
                    Text(pod.namespace)
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Phase", value: \.phase) { pod in
                    Text(pod.phase)
                        .foregroundStyle(.secondary)
                }
                .width(80)
                TableColumn("Restarts", value: \.restarts) { pod in
                    Text("\(pod.restarts)")
                        .monospacedDigit()
                        .foregroundStyle(pod.restarts > 0 ? .red : .secondary)
                }
                .width(70)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 200)
            .contextMenu(forSelectionType: KubernetesPod.ID.self) { _ in } primaryAction: { ids in
                if let podID = ids.first {
                    self.selectedPod = self.sortedUnhealthyPods.first { $0.id == podID }
                }
            }
        }
    }

    // MARK: - DaemonSets

    @ViewBuilder
    private var daemonSetsSection: some View {
        Text("DaemonSets")
            .font(.headline)

        Table(self.sortedDaemonSets, sortOrder: self.$daemonSetSortOrder) {
            TableColumn("Name", value: \.name) { ds in
                Text(ds.name)
                    .fontWeight(.medium)
            }
            TableColumn("Namespace", value: \.namespace) { ds in
                Text(ds.namespace)
                    .foregroundStyle(.secondary)
            }
            .width(120)
            TableColumn("Desired", value: \.desiredScheduled) { ds in
                Text("\(ds.desiredScheduled)")
                    .monospacedDigit()
            }
            .width(70)
            TableColumn("Ready", value: \.ready) { ds in
                Text("\(ds.ready)")
                    .monospacedDigit()
                    .foregroundColor(ds.ready == ds.desiredScheduled ? nil : Color.red)
            }
            .width(70)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 150)
    }

    // MARK: - StatefulSets

    @ViewBuilder
    private var statefulSetsSection: some View {
        Text("StatefulSets")
            .font(.headline)

        Table(self.sortedStatefulSets, sortOrder: self.$statefulSetSortOrder) {
            TableColumn("Name", value: \.name) { ss in
                Text(ss.name)
                    .fontWeight(.medium)
            }
            TableColumn("Namespace", value: \.namespace) { ss in
                Text(ss.namespace)
                    .foregroundStyle(.secondary)
            }
            .width(120)
            TableColumn("Replicas", value: \.replicas) { ss in
                Text("\(ss.replicas)")
                    .monospacedDigit()
            }
            .width(70)
            TableColumn("Ready", value: \.readyReplicas) { ss in
                Text("\(ss.readyReplicas)")
                    .monospacedDigit()
                    .foregroundColor(ss.readyReplicas == ss.replicas ? nil : Color.red)
            }
            .width(70)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 150)
    }

    // MARK: - PVCs

    private var pvcsSection: some View {
        KubernetesPVCsSection(pvcs: self.detail.pvcs, sortOrder: self.$pvcSortOrder)
    }

    // MARK: - Events

    private var eventsSection: some View {
        KubernetesEventsSection(events: self.detail.events, sortOrder: self.$eventSortOrder)
    }
}
