import SwiftUI

/// Detail view showing Talos node health.
struct TalosDetailView: View {
    let nodes: [TalosNode]

    var body: some View {
        if self.nodes.isEmpty {
            Text("No Talos nodes found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.nodes) {
                TableColumn("Hostname") { node in
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
            .frame(minHeight: 200)
        }
    }
}
