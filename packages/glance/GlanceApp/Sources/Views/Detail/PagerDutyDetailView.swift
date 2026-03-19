import SwiftUI

/// Detail view showing PagerDuty incidents and on-call schedule.
struct PagerDutyDetailView: View {
    // MARK: Internal

    let incidents: [PagerDutyIncident]
    let onCall: [PagerDutyOnCall]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.incidentsSection
            self.onCallSection
        }
    }

    // MARK: Private

    // MARK: - Incidents

    @ViewBuilder
    private var incidentsSection: some View {
        Text("Active Incidents")
            .font(.headline)

        if self.incidents.isEmpty {
            Label("No active incidents", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
        } else {
            ForEach(self.incidents) { incident in
                HStack {
                    self.urgencyBadge(incident.urgency)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(incident.title)
                            .fontWeight(.medium)
                        Text(incident.status)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                Divider()
            }
        }
    }

    // MARK: - On-Call

    @ViewBuilder
    private var onCallSection: some View {
        Text("On-Call")
            .font(.headline)

        if self.onCall.isEmpty {
            Text("No on-call schedules found.")
                .foregroundStyle(.secondary)
        } else {
            ForEach(self.onCall) { entry in
                HStack {
                    Image(systemName: "person.fill")
                        .foregroundStyle(.secondary)
                    Text(entry.user.name)
                        .fontWeight(.medium)
                    Spacer()
                    Text(entry.escalationPolicy.summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func urgencyBadge(_ urgency: String) -> some View {
        let color: Color = urgency == "high" ? .red : .orange
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
    }
}
