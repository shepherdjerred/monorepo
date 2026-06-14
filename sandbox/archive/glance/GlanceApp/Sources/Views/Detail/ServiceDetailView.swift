import SwiftUI

// MARK: - ServiceDetailView

/// Routes to the appropriate detail view based on the service type.
/// Provides three tabs: Overview, Details, and History.
struct ServiceDetailView: View {
    // MARK: Internal

    let snapshot: ServiceSnapshot
    var snapshotStore: SnapshotStore?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            self.detailHeader
                .padding()

            TabView {
                self.overviewTab
                    .tabItem { Label("Overview", systemImage: "gauge.medium") }

                self.detailsTab
                    .tabItem { Label("Details", systemImage: "list.bullet") }

                self.historyTab
                    .tabItem { Label("History", systemImage: "chart.xyaxis.line") }
            }
        }
    }

    // MARK: Private

    @Environment(\.openURL) private var openURL

    // MARK: - Header

    private var detailHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: self.snapshot.iconName)
                .font(.largeTitle)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(verbatim: self.snapshot.displayName)
                        .font(.title.bold())
                    StatusBadge(status: self.snapshot.status)
                }

                Text(verbatim: self.snapshot.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let urlString = snapshot.webURL,
               let url = URL(string: urlString)
            {
                Button(String(localized: "Open in Browser")) {
                    self.openURL(url)
                }
                .buttonStyle(.bordered)
            }

            if let error = snapshot.error {
                Text(verbatim: error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(6)
                    .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.bottom, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(self.snapshot.displayName), \(self.snapshot.status.label)")
        .accessibilityValue(self.snapshot.summary)
    }

    // MARK: - Overview Tab

    private var overviewTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                self.overviewKeyMetrics
                self.overviewMiniChart
            }
            .padding()
        }
    }

    private var overviewKeyMetrics: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Key Metrics")
                .font(.headline)

            HStack(spacing: 24) {
                OverviewMetricCard(
                    title: "Status",
                    value: self.snapshot.status.label,
                    color: self.snapshot.status.color,
                )

                OverviewMetricCard(
                    title: "Summary",
                    value: self.snapshot.summary,
                    color: .primary,
                )
            }

            if let error = self.snapshot.error {
                OverviewMetricCard(
                    title: "Error",
                    value: error,
                    color: .red,
                )
            }
        }
    }

    private var overviewMiniChart: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent History")
                .font(.headline)

            StatusHistoryChart(
                providerId: self.snapshot.id,
                snapshotStore: self.snapshotStore,
            )
        }
    }

    // MARK: - Details Tab

    private var detailsTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                self.detailContent
            }
            .padding()
        }
    }

    // MARK: - History Tab

    private var historyTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                StatusHistoryChart(
                    providerId: self.snapshot.id,
                    snapshotStore: self.snapshotStore,
                )
            }
            .padding()
        }
    }

    // MARK: - Content Router

    @ViewBuilder
    private var detailContent: some View {
        switch self.snapshot.detail {
        case let .alertmanager(detail):
            AlertmanagerDetailView(detail: detail)
        case let .anthropicAPI(usage):
            AnthropicDetailView(usage: usage)
        case let .argoCD(detail):
            ArgoCDDetailView(detail: detail)
        case let .buildkite(detail):
            BuildkiteDetailView(detail: detail)
        case let .bugsink(issues):
            BugsinkDetailView(issues: issues)
        case let .certManager(detail):
            CertManagerDetailView(detail: detail)
        case let .claudeCode(usage):
            ClaudeCodeDetailView(usage: usage)
        case let .cloudflare(tunnels):
            CloudflareDetailView(tunnels: tunnels)
        case let .codex(usage):
            CodexDetailView(usage: usage)
        case .empty:
            if self.snapshot.status == .ok {
                Label(String(localized: "Service is healthy"), systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                    .font(.headline)
            } else {
                ErrorStateView(serviceName: self.snapshot.displayName, errorMessage: self.snapshot.error)
            }
        case let .github(pullRequests):
            GitHubDetailView(pullRequests: pullRequests)
        case let .grafana(detail):
            GrafanaDetailView(detail: detail)
        case let .kubernetes(detail):
            KubernetesDetailView(detail: detail)
        case let .loki(entries):
            LokiDetailView(entries: entries)
        case let .openAIAPI(usage):
            OpenAIDetailView(usage: usage)
        case let .pagerDuty(incidents, onCall):
            PagerDutyDetailView(incidents: incidents, onCall: onCall)
        case let .prometheus(detail):
            PrometheusDetailView(detail: detail)
        case let .talos(nodes):
            TalosDetailView(nodes: nodes)
        case let .velero(detail):
            VeleroDetailView(detail: detail)
        }
    }
}

// MARK: - OverviewMetricCard

/// A card displaying a single key metric with a title and value.
struct OverviewMetricCard: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: self.title)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(verbatim: self.value)
                .font(.title2.bold())
                .foregroundStyle(self.color)
                .lineLimit(2)
        }
        .padding(12)
        .frame(minWidth: 120, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
    }
}
