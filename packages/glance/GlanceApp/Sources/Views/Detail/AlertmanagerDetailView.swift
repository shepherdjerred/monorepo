import Charts
import SwiftUI

/// Detail view showing active Alertmanager alerts and silences.
struct AlertmanagerDetailView: View {
    // MARK: Internal

    let detail: AlertmanagerDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.alertsSection
            if !self.detail.silences.isEmpty {
                self.silencesSection
            }
        }
    }

    // MARK: Private

    @State private var silenceSortOrder = [KeyPathComparator(\AlertmanagerSilence.createdBy)]

    private var sortedSilences: [AlertmanagerSilence] {
        self.detail.silences.sorted(using: self.silenceSortOrder)
    }

    @ViewBuilder
    private var alertsSection: some View {
        Text("Active Alerts")
            .font(.headline)

        if self.detail.alerts.isEmpty {
            Label("No active alerts", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.headline)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(self.detail.alerts) { alert in
                    self.alertRow(alert)
                    Divider()
                }
            }
        }
    }

    @ViewBuilder
    private var silencesSection: some View {
        Text("Active Silences")
            .font(.headline)

        Table(self.sortedSilences, sortOrder: self.$silenceSortOrder) {
            TableColumn("Created By", value: \.createdBy) { silence in
                Text(silence.createdBy)
                    .fontWeight(.medium)
            }
            TableColumn("Comment", value: \.comment) { silence in
                Text(silence.comment)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            TableColumn("Ends At", value: \.endsAt) { silence in
                Text(silence.endsAt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .width(180)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 150)
    }

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
