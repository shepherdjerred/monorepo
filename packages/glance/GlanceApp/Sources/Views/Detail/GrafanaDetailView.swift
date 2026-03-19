import SwiftUI

/// Detail view showing Grafana alert rules.
struct GrafanaDetailView: View {
    let alertRules: [GrafanaAlertRule]

    var body: some View {
        if self.alertRules.isEmpty {
            Text("No alert rules configured.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.alertRules) {
                TableColumn("Title") { rule in
                    Text(rule.title)
                        .fontWeight(.medium)
                }
                TableColumn("Group") { rule in
                    Text(rule.ruleGroup ?? "-")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(minHeight: 300)
        }
    }
}
