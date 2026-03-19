import SwiftUI

/// Detail view showing Talos node health.
struct TalosDetailView: View {
    // MARK: Internal

    let nodes: [TalosNode]

    var body: some View {
        if self.nodes.isEmpty {
            Text("No Talos nodes found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedNodes, sortOrder: self.$nodeSortOrder) {
                TableColumn("Hostname", value: \.hostname) { node in
                    Text(node.hostname)
                        .fontWeight(.medium)
                }
                TableColumn("OS Version") { node in
                    Text(node.osVersion ?? "-")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Ready") { node in
                    Circle()
                        .fill(node.ready ? .green : .red)
                        .frame(width: 8, height: 8)
                }
                .width(60)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 200)
        }
    }

    // MARK: Private

    @State private var nodeSortOrder = [KeyPathComparator(\TalosNode.hostname)]

    private var sortedNodes: [TalosNode] {
        self.nodes.sorted(using: self.nodeSortOrder)
    }
}
