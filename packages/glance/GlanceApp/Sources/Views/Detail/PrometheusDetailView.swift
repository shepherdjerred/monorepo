import Charts
import SwiftUI

/// Detail view showing Prometheus scrape target health and alert rules.
struct PrometheusDetailView: View {
    // MARK: Internal

    let detail: PrometheusDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.targetsSection
            if !self.detail.alertRules.isEmpty {
                self.alertRulesSection
            }
        }
    }

    // MARK: Private

    @State private var targetSortOrder = [KeyPathComparator(\PrometheusTarget.job)]
    @State private var alertRuleSortOrder = [KeyPathComparator(\PrometheusAlertRule.name)]

    private var sortedTargets: [PrometheusTarget] {
        self.detail.targets.sorted(using: self.targetSortOrder)
    }

    private var sortedAlertRules: [PrometheusAlertRule] {
        self.detail.alertRules.sorted(using: self.alertRuleSortOrder)
    }

    @ViewBuilder
    private var targetsSection: some View {
        Text("Targets")
            .font(.headline)

        if self.detail.targets.isEmpty {
            Text("No targets found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedTargets, sortOrder: self.$targetSortOrder) {
                TableColumn("Job", value: \.job) { target in
                    Text(target.job)
                        .fontWeight(.medium)
                }
                TableColumn("Instance", value: \.instance) { target in
                    Text(target.instance)
                        .foregroundStyle(.secondary)
                }
                TableColumn("Scrape Duration") { target in
                    if let duration = target.lastScrapeDuration {
                        Text(String(format: "%.3fs", duration))
                            .font(.caption.monospaced())
                            .foregroundStyle(duration > 5 ? .red : duration > 1 ? .orange : .secondary)
                    } else {
                        Text("-")
                            .foregroundStyle(.secondary)
                    }
                }
                .width(100)
                TableColumn("Health", value: \.health) { target in
                    self.healthBadge(target.health)
                }
                .width(80)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 300)
        }
    }

    @ViewBuilder
    private var alertRulesSection: some View {
        Text("Alert Rules")
            .font(.headline)

        Table(self.sortedAlertRules, sortOrder: self.$alertRuleSortOrder) {
            TableColumn("Name", value: \.name) { rule in
                Text(rule.name)
                    .fontWeight(.medium)
            }
            TableColumn("Group", value: \.group) { rule in
                Text(rule.group)
                    .foregroundStyle(.secondary)
            }
            .width(150)
            TableColumn("Severity") { rule in
                if let severity = rule.severity {
                    self.severityBadge(severity)
                } else {
                    Text("-")
                        .foregroundStyle(.secondary)
                }
            }
            .width(80)
            TableColumn("State", value: \.state) { rule in
                self.stateBadge(rule.state)
            }
            .width(80)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 200)
    }

    @ViewBuilder
    private func healthBadge(_ health: String) -> some View {
        let color: Color = health == "up" ? .green : .red
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(health)
                .font(.caption)
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
        Text(severity)
            .font(.caption)
            .foregroundStyle(color)
    }

    @ViewBuilder
    private func stateBadge(_ state: String) -> some View {
        let color: Color =
            switch state {
            case "firing":
                .red
            case "pending":
                .orange
            case "inactive":
                .green
            default:
                .secondary
            }
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(state)
                .font(.caption)
        }
    }
}
