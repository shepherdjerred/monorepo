import SwiftUI

/// Detail view showing ArgoCD application sync and health status.
struct ArgoCDDetailView: View {
    // MARK: Internal

    let detail: ArgoCDDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.applicationsSection
            if !self.detail.revisionHistory.isEmpty {
                self.revisionHistorySection
            }
        }
        .sheet(item: self.$selectedApp) { app in
            self.appDetailSheet(app)
        }
    }

    // MARK: Private

    @State private var appSortOrder = [KeyPathComparator(\ArgoCDApplication.metadata.name)]
    @State private var revisionSortOrder = [KeyPathComparator(\ArgoCDRevisionEntry.appName)]
    @State private var selectedApp: ArgoCDApplication?

    private var sortedApplications: [ArgoCDApplication] {
        self.detail.applications.sorted(using: self.appSortOrder)
    }

    @ViewBuilder
    private var applicationsSection: some View {
        Text("Applications")
            .font(.headline)

        if self.detail.applications.isEmpty {
            Text("No applications found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedApplications, sortOrder: self.$appSortOrder) {
                TableColumn("Name", value: \.metadata.name) { app in
                    Text(app.metadata.name)
                        .fontWeight(.medium)
                }
                TableColumn("Namespace", value: \.metadata.namespace) { app in
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
            .alternatingRowBackgrounds()
            .frame(minHeight: 300)
            .contextMenu(forSelectionType: ArgoCDApplication.ID.self) { _ in } primaryAction: { ids in
                if let appID = ids.first {
                    self.selectedApp = self.sortedApplications.first { $0.id == appID }
                }
            }
        }
    }

    @ViewBuilder
    private var revisionHistorySection: some View {
        Text("Recent Deployments")
            .font(.headline)

        let recentRevisions = Array(self.detail.revisionHistory.suffix(20))

        Table(self.sortedRevisions(recentRevisions), sortOrder: self.$revisionSortOrder) {
            TableColumn("App", value: \.appName) { entry in
                Text(entry.appName)
                    .fontWeight(.medium)
            }
            TableColumn("Revision", value: \.revision) { entry in
                Text(entry.revision.prefix(12))
                    .font(.caption.monospaced())
            }
            .width(120)
            TableColumn("Deployed At") { entry in
                Text(entry.deployedAt ?? "-")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .width(180)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 150)
    }

    // MARK: - App Detail Sheet

    private func appDetailSheet(_ app: ArgoCDApplication) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Application Details")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    self.selectedApp = nil
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()

            Divider()

            Form {
                LabeledContent("Name", value: app.metadata.name)
                LabeledContent("Namespace", value: app.metadata.namespace)
                LabeledContent("Sync Status", value: app.status.sync.status)
                LabeledContent("Health Status", value: app.status.health.status)
                if let opState = app.status.operationState,
                   let finishedAt = opState.finishedAt
                {
                    LabeledContent("Last Operation", value: finishedAt)
                }
                if let history = app.status.history, let latest = history.last {
                    if let revision = latest.revision {
                        LabeledContent("Latest Revision") {
                            Text(revision.prefix(12))
                                .font(.caption.monospaced())
                        }
                    }
                    if let deployedAt = latest.deployedAt {
                        LabeledContent("Last Deployed", value: deployedAt)
                    }
                }
            }
            .formStyle(.grouped)
        }
        .frame(width: 450, height: 320)
    }

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

    private func sortedRevisions(_ revisions: [ArgoCDRevisionEntry]) -> [ArgoCDRevisionEntry] {
        revisions.sorted(using: self.revisionSortOrder)
    }
}
