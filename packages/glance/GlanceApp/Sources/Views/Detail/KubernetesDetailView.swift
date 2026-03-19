import SwiftUI

/// Detail view showing Kubernetes pod and node status.
struct KubernetesDetailView: View {
    // MARK: Internal

    let pods: [KubernetesPod]
    let nodes: [KubernetesNode]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.nodesSection
            self.podsSection
        }
    }

    // MARK: Private

    // MARK: - Nodes

    @ViewBuilder
    private var nodesSection: some View {
        Text("Nodes")
            .font(.headline)

        if self.nodes.isEmpty {
            Text("No nodes found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.nodes) {
                TableColumn("Name") { node in
                    Text(node.name)
                        .fontWeight(.medium)
                }
                TableColumn("Roles") { node in
                    Text(node.roles.joined(separator: ", "))
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Version") { node in
                    Text(node.version)
                        .font(.caption.monospaced())
                }
                .width(100)
                TableColumn("Ready") { node in
                    self.readyBadge(node.ready)
                }
                .width(60)
            }
            .frame(height: 150)
        }
    }

    // MARK: - Pods

    @ViewBuilder
    private var podsSection: some View {
        Text("Unhealthy Pods")
            .font(.headline)

        let unhealthyPods = self.pods.filter { !$0.ready || $0.phase != "Running" }

        if unhealthyPods.isEmpty {
            Label("All pods healthy", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
        } else {
            Table(unhealthyPods) {
                TableColumn("Pod") { pod in
                    Text(pod.name)
                        .fontWeight(.medium)
                        .lineLimit(1)
                }
                TableColumn("Namespace") { pod in
                    Text(pod.namespace)
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Phase") { pod in
                    Text(pod.phase)
                        .foregroundStyle(.secondary)
                }
                .width(80)
                TableColumn("Restarts") { pod in
                    Text("\(pod.restarts)")
                        .monospacedDigit()
                        .foregroundStyle(pod.restarts > 0 ? .red : .secondary)
                }
                .width(70)
            }
            .frame(minHeight: 200)
        }
    }

    private func readyBadge(_ ready: Bool) -> some View {
        Circle()
            .fill(ready ? .green : .red)
            .frame(width: 8, height: 8)
    }
}
