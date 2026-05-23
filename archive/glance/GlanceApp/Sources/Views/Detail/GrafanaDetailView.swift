import SwiftUI

/// Detail view showing Grafana alert rules and dashboards.
struct GrafanaDetailView: View {
    // MARK: Internal

    let detail: GrafanaDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.alertRulesSection
            if !self.detail.dashboards.isEmpty {
                self.dashboardsSection
            }
        }
    }

    // MARK: Private

    @State private var alertRuleSortOrder = [KeyPathComparator(\GrafanaAlertRule.title)]
    @State private var dashboardSortOrder = [KeyPathComparator(\GrafanaDashboard.title)]

    private var sortedAlertRules: [GrafanaAlertRule] {
        self.detail.alertRules.sorted(using: self.alertRuleSortOrder)
    }

    private var sortedDashboards: [GrafanaDashboard] {
        self.detail.dashboards.sorted(using: self.dashboardSortOrder)
    }

    // MARK: - Alert Rules

    @ViewBuilder
    private var alertRulesSection: some View {
        Text("Alert Rules")
            .font(.headline)

        if self.detail.alertRules.isEmpty {
            Text("No alert rules configured.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedAlertRules, sortOrder: self.$alertRuleSortOrder) {
                TableColumn("Title", value: \.title) { rule in
                    Text(rule.title)
                        .fontWeight(.medium)
                }
                TableColumn("Group") { rule in
                    Text(rule.ruleGroup ?? "-")
                        .foregroundStyle(.secondary)
                }
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 200)
        }
    }

    // MARK: - Dashboards

    @ViewBuilder
    private var dashboardsSection: some View {
        Text("Dashboards")
            .font(.headline)

        Table(self.sortedDashboards, sortOrder: self.$dashboardSortOrder) {
            TableColumn("Title", value: \.title) { dashboard in
                Text(dashboard.title)
                    .fontWeight(.medium)
            }
            TableColumn("URI") { dashboard in
                Text(dashboard.uri ?? dashboard.url ?? "-")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 200)
    }
}
