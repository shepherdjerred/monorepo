import SwiftUI

/// Detail view showing Cloudflare tunnel status.
struct CloudflareDetailView: View {
    // MARK: Internal

    let tunnels: [CloudflareTunnel]

    var body: some View {
        if self.tunnels.isEmpty {
            Text("No tunnels found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedTunnels, sortOrder: self.$tunnelSortOrder) {
                TableColumn("Name", value: \.name) { tunnel in
                    Text(tunnel.name)
                        .fontWeight(.medium)
                }
                TableColumn("Status", value: \.status) { tunnel in
                    self.statusBadge(tunnel.status)
                }
                .width(100)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 200)
        }
    }

    // MARK: Private

    @State private var tunnelSortOrder = [KeyPathComparator(\CloudflareTunnel.name)]

    private var sortedTunnels: [CloudflareTunnel] {
        self.tunnels.sorted(using: self.tunnelSortOrder)
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        let color: Color =
            switch status {
            case "healthy":
                .green
            case "degraded":
                .orange
            case "down":
                .red
            default:
                .secondary
            }
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(status)
                .font(.caption)
        }
    }
}
