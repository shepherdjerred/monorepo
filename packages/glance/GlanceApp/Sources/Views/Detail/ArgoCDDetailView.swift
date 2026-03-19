import SwiftUI

/// Detail view showing ArgoCD application sync and health status.
struct ArgoCDDetailView: View {
    // MARK: Internal

    let applications: [ArgoCDApplication]

    var body: some View {
        if self.applications.isEmpty {
            Text("No applications found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.applications) {
                TableColumn("Name") { app in
                    Text(app.metadata.name)
                        .fontWeight(.medium)
                }
                TableColumn("Namespace") { app in
                    Text(app.metadata.namespace)
                        .foregroundStyle(.secondary)
                }
                TableColumn("Sync") { app in
                    self.syncBadge(app.status.sync.status)
                }
                .width(100)
                TableColumn("Health") { app in
                    self.healthBadge(app.status.health.status)
                }
                .width(100)
            }
            .frame(minHeight: 300)
        }
    }

    // MARK: Private

    @ViewBuilder
    private func syncBadge(_ status: String) -> some View {
        let color: Color = status == "Synced" ? .green : .orange
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(status)
                .font(.caption)
        }
    }

    @ViewBuilder
    private func healthBadge(_ status: String) -> some View {
        let color: Color =
            switch status {
            case "Healthy":
                .green
            case "Degraded":
                .red
            case "Progressing":
                .blue
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
