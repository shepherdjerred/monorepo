import SwiftUI

/// Detail view showing Prometheus scrape target health.
struct PrometheusDetailView: View {
    // MARK: Internal

    let targets: [PrometheusTarget]

    var body: some View {
        if self.targets.isEmpty {
            Text("No targets found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.targets) {
                TableColumn("Job") { target in
                    Text(target.job)
                        .fontWeight(.medium)
                }
                TableColumn("Instance") { target in
                    Text(target.instance)
                        .foregroundStyle(.secondary)
                }
                TableColumn("Health") { target in
                    self.healthBadge(target.health)
                }
                .width(80)
            }
            .frame(minHeight: 300)
        }
    }

    // MARK: Private

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
}
