import SwiftUI

/// Detail view showing active Alertmanager alerts.
struct AlertmanagerDetailView: View {
    // MARK: Internal

    let alerts: [AlertmanagerAlert]

    var body: some View {
        if self.alerts.isEmpty {
            Label("No active alerts", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.headline)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(self.alerts) { alert in
                    self.alertRow(alert)
                    Divider()
                }
            }
        }
    }

    // MARK: Private

    private func alertRow(_ alert: AlertmanagerAlert) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                self.severityBadge(alert.labels["severity"] ?? "unknown")
                Text(alert.labels["alertname"] ?? "Unknown Alert")
                    .font(.headline)
                Spacer()
                Text(alert.status.state)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let summary = alert.annotations["summary"] {
                Text(summary)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }

            if let description = alert.annotations["description"] {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    @ViewBuilder
    private func severityBadge(_ severity: String) -> some View {
        let color: Color =
            switch severity {
            case "critical":
                .red
            case "warning":
                .orange
            default:
                .secondary
            }
        Text(severity.uppercased())
            .font(.caption2.bold())
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color, in: RoundedRectangle(cornerRadius: 4))
    }
}
