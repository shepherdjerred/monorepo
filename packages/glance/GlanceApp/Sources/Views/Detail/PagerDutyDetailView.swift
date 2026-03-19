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
        .sheet(item: self.$selectedIncident) { incident in
            self.incidentDetailSheet(incident)
        }
    }

    // MARK: Private

    @State private var selectedIncident: PagerDutyIncident?

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
                Button {
                    self.selectedIncident = incident
                } label: {
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
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
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
                        .accessibilityHidden(true)
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

    // MARK: - Incident Detail Sheet

    private func incidentDetailSheet(_ incident: PagerDutyIncident) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Incident Details")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    self.selectedIncident = nil
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()

            Divider()

            Form {
                LabeledContent("Title", value: incident.title)
                LabeledContent("Status", value: incident.status)
                LabeledContent("Urgency", value: incident.urgency)
                LabeledContent("Created At", value: incident.createdAt)
            }
            .formStyle(.grouped)
        }
        .frame(width: 450, height: 260)
    }

    @ViewBuilder
    private func urgencyBadge(_ urgency: String) -> some View {
        let color: Color = urgency == "high" ? .red : .orange
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
    }
}
