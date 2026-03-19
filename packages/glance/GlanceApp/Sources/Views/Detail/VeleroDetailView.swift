import SwiftUI

/// Detail view showing Velero backup, schedule, and BSL status.
struct VeleroDetailView: View {
    // MARK: Internal

    let detail: VeleroDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.backupsSection
            if !self.detail.backupStorageLocations.isEmpty {
                self.bslSection
            }
            if !self.detail.schedules.isEmpty {
                self.schedulesSection
            }
        }
    }

    // MARK: Private

    @State private var backupSortOrder = [KeyPathComparator(\VeleroBackup.name)]
    @State private var bslSortOrder = [KeyPathComparator(\VeleroBackupStorageLocation.name)]
    @State private var scheduleSortOrder = [KeyPathComparator(\VeleroSchedule.name)]

    private var sortedBackups: [VeleroBackup] {
        self.detail.backups.sorted(using: self.backupSortOrder)
    }

    private var sortedBSLs: [VeleroBackupStorageLocation] {
        self.detail.backupStorageLocations.sorted(using: self.bslSortOrder)
    }

    private var sortedSchedules: [VeleroSchedule] {
        self.detail.schedules.sorted(using: self.scheduleSortOrder)
    }

    // MARK: - Backups

    @ViewBuilder
    private var backupsSection: some View {
        Text("Backups")
            .font(.headline)

        if self.detail.backups.isEmpty {
            Text("No backups found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedBackups, sortOrder: self.$backupSortOrder) {
                TableColumn("Name", value: \.name) { backup in
                    Text(backup.name)
                        .fontWeight(.medium)
                        .lineLimit(1)
                }
                TableColumn("Phase", value: \.phase) { backup in
                    self.phaseBadge(backup.phase)
                }
                .width(100)
                TableColumn("Completed") { backup in
                    Text(backup.completionTimestamp ?? "-")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .width(160)
                TableColumn("Errors", value: \.errors) { backup in
                    Text("\(backup.errors)")
                        .monospacedDigit()
                        .foregroundStyle(backup.errors > 0 ? .red : .secondary)
                }
                .width(60)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 200)
        }
    }

    // MARK: - Backup Storage Locations

    @ViewBuilder
    private var bslSection: some View {
        Text("Backup Storage Locations")
            .font(.headline)

        Table(self.sortedBSLs, sortOrder: self.$bslSortOrder) {
            TableColumn("Name", value: \.name) { bsl in
                Text(bsl.name)
                    .fontWeight(.medium)
            }
            TableColumn("Phase", value: \.phase) { bsl in
                self.bslPhaseBadge(bsl.phase)
            }
            .width(100)
            TableColumn("Last Validated") { bsl in
                Text(bsl.lastValidationTime ?? "-")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .width(180)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 100)
    }

    // MARK: - Schedules

    @ViewBuilder
    private var schedulesSection: some View {
        Text("Schedules")
            .font(.headline)

        Table(self.sortedSchedules, sortOrder: self.$scheduleSortOrder) {
            TableColumn("Name", value: \.name) { schedule in
                Text(schedule.name)
                    .fontWeight(.medium)
            }
            TableColumn("Schedule", value: \.schedule) { schedule in
                Text(schedule.schedule)
                    .font(.caption.monospaced())
            }
            .width(120)
            TableColumn("Last Backup") { schedule in
                if let lastBackup = schedule.lastBackup, let backupDate = Self.parseDate(lastBackup) {
                    TimelineView(.periodic(from: .now, by: 60)) { _ in
                        let elapsed = Date.now.timeIntervalSince(backupDate)
                        Text(Self.formatElapsed(elapsed))
                            .font(.caption)
                            .foregroundStyle(elapsed > 86400 ? .orange : .secondary)
                    }
                } else {
                    Text(schedule.lastBackup ?? "-")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .width(180)
            TableColumn("Paused") { schedule in
                if schedule.paused {
                    Text("Yes")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    Text("No")
                        .font(.caption)
                        .foregroundStyle(.green)
                }
            }
            .width(60)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 100)
    }

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

    @ViewBuilder
    private func bslPhaseBadge(_ phase: String) -> some View {
        let color: Color =
            switch phase {
            case "Available":
                .green
            case "Unavailable":
                .red
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

    /// Parse an ISO 8601 date string from Kubernetes (e.g. "2025-06-15T12:00:00Z").
    private static func parseDate(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)
    }

    /// Format elapsed seconds as a human-readable relative time string.
    private static func formatElapsed(_ seconds: TimeInterval) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours >= 24 {
            let days = hours / 24
            return "\(days)d ago"
        } else if hours > 0 {
            return "\(hours)h \(minutes)m ago"
        } else {
            return "\(max(minutes, 1))m ago"
        }
    }
}
