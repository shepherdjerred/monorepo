import SwiftUI

/// Detail view showing Velero backup status.
struct VeleroDetailView: View {
    // MARK: Internal

    let backups: [VeleroBackup]

    var body: some View {
        if self.backups.isEmpty {
            Text("No backups found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.backups) {
                TableColumn("Name") { backup in
                    Text(backup.name)
                        .fontWeight(.medium)
                        .lineLimit(1)
                }
                TableColumn("Phase") { backup in
                    self.phaseBadge(backup.phase)
                }
                .width(100)
                TableColumn("Completed") { backup in
                    Text(backup.completionTimestamp ?? "-")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .width(160)
                TableColumn("Errors") { backup in
                    Text("\(backup.errors)")
                        .monospacedDigit()
                        .foregroundStyle(backup.errors > 0 ? .red : .secondary)
                }
                .width(60)
            }
            .frame(minHeight: 300)
        }
    }

    // MARK: Private

    @ViewBuilder
    private func phaseBadge(_ phase: String) -> some View {
        let color: Color =
            switch phase {
            case "Completed":
                .green
            case "PartiallyFailed":
                .orange
            case "Failed":
                .red
            case "InProgress":
                .blue
            default:
                .secondary
            }
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(phase)
                .font(.caption)
        }
    }
}
