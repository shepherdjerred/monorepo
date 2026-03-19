import SwiftUI

/// Routes to the appropriate detail view based on the service type.
struct ServiceDetailView: View {
    // MARK: Internal

    let snapshot: ServiceSnapshot

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                self.detailHeader
                self.detailContent
            }
            .padding()
        }
    }

    // MARK: Private

    // MARK: - Header

    private var detailHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: self.snapshot.iconName)
                .font(.largeTitle)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(self.snapshot.displayName)
                        .font(.title.bold())
                    StatusBadge(status: self.snapshot.status)
                }

                Text(self.snapshot.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let error = snapshot.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(6)
                    .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: - Content Router

    @ViewBuilder
    private var detailContent: some View {
        switch self.snapshot.detail {
        case let .argoCD(applications):
            ArgoCDDetailView(applications: applications)
        case let .alertmanager(alerts):
            AlertmanagerDetailView(alerts: alerts)
        case let .prometheus(targets):
            PrometheusDetailView(targets: targets)
        case let .grafana(alertRules):
            GrafanaDetailView(alertRules: alertRules)
        case let .loki(entries):
            LokiDetailView(entries: entries)
        case let .bugsink(issues):
            BugsinkDetailView(issues: issues)
        case let .pagerDuty(incidents, onCall):
            PagerDutyDetailView(incidents: incidents, onCall: onCall)
        case let .github(pullRequests):
            GitHubDetailView(pullRequests: pullRequests)
        case let .buildkite(pipelines):
            BuildkiteDetailView(pipelines: pipelines)
        case let .kubernetes(pods, nodes):
            KubernetesDetailView(pods: pods, nodes: nodes)
        case let .talos(nodes):
            TalosDetailView(nodes: nodes)
        case let .velero(backups):
            VeleroDetailView(backups: backups)
        case let .certManager(certificates):
            CertManagerDetailView(certificates: certificates)
        case let .cloudflare(tunnels):
            CloudflareDetailView(tunnels: tunnels)
        case .empty:
            if self.snapshot.status == .ok {
                Label("Service is healthy", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                    .font(.headline)
            } else {
                ErrorStateView(serviceName: self.snapshot.displayName, errorMessage: self.snapshot.error)
            }
        }
    }
}
