import SwiftUI

// MARK: - KubernetesPodDetailSheet

struct KubernetesPodDetailSheet: View {
    let pod: KubernetesPod

    @Binding var selectedPod: KubernetesPod?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Pod Details")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    self.selectedPod = nil
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()

            Divider()

            Form {
                LabeledContent("Name", value: self.pod.name)
                LabeledContent("Namespace", value: self.pod.namespace)
                LabeledContent("Phase", value: self.pod.phase)
                LabeledContent("Ready", value: self.pod.ready ? "Yes" : "No")
                LabeledContent("Restart Count", value: "\(self.pod.restarts)")
            }
            .formStyle(.grouped)
        }
        .frame(width: 400, height: 280)
    }
}

// MARK: - KubernetesPVCsSection

struct KubernetesPVCsSection: View {
    let pvcs: [KubernetesPVC]

    @Binding var sortOrder: [KeyPathComparator<KubernetesPVC>]

    var body: some View {
        Text("Persistent Volume Claims")
            .font(.headline)

        Table(self.pvcs.sorted(using: self.sortOrder), sortOrder: self.$sortOrder) {
            TableColumn("Name", value: \.name) { pvc in
                Text(pvc.name)
                    .fontWeight(.medium)
            }
            TableColumn("Namespace", value: \.namespace) { pvc in
                Text(pvc.namespace)
                    .foregroundStyle(.secondary)
            }
            .width(120)
            TableColumn("Phase", value: \.phase) { pvc in
                kubernetesPVCPhaseBadge(pvc.phase)
            }
            .width(80)
            TableColumn("Capacity") { pvc in
                Text(pvc.capacity ?? "-")
                    .font(.caption.monospaced())
            }
            .width(80)
            TableColumn("Storage Class") { pvc in
                Text(pvc.storageClass ?? "-")
                    .foregroundStyle(.secondary)
            }
            .width(120)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 150)
    }
}

// MARK: - KubernetesEventsSection

struct KubernetesEventsSection: View {
    let events: [KubernetesEvent]

    @Binding var sortOrder: [KeyPathComparator<KubernetesEvent>]

    var body: some View {
        Text("Recent Events")
            .font(.headline)

        let warningEvents = self.events.filter { $0.type == "Warning" }
        let displayEvents = warningEvents.isEmpty ? Array(self.events.suffix(20)) : warningEvents

        Table(displayEvents.sorted(using: self.sortOrder), sortOrder: self.$sortOrder) {
            TableColumn("Type", value: \.type) { event in
                Text(event.type)
                    .font(.caption)
                    .foregroundStyle(event.type == "Warning" ? .red : .secondary)
            }
            .width(60)
            TableColumn("Reason", value: \.reason) { event in
                Text(event.reason)
                    .fontWeight(.medium)
            }
            .width(120)
            TableColumn("Object", value: \.involvedObject) { event in
                Text(event.involvedObject)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .width(200)
            TableColumn("Message") { event in
                Text(event.message)
                    .font(.caption)
                    .lineLimit(2)
            }
            TableColumn("Count", value: \.count) { event in
                Text("\(event.count)")
                    .monospacedDigit()
            }
            .width(50)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 200)
    }
}

// MARK: - Memory Formatting

/// Format megabytes into a human-readable string.
func formatMemory(_ megabytes: Int) -> String {
    if megabytes >= 1024 {
        let gi = megabytes / 1024
        let frac = (megabytes % 1024) * 10 / 1024
        return "\(gi).\(frac)Gi"
    }
    return "\(megabytes)Mi"
}

// MARK: - Kubernetes Helpers

func kubernetesPhaseColor(_ phase: String) -> Color {
    switch phase {
    case "Running":
        .green
    case "Succeeded":
        .blue
    case "Pending":
        .orange
    case "Failed":
        .red
    default:
        .secondary
    }
}

func kubernetesReadyBadge(_ ready: Bool) -> some View {
    Circle()
        .fill(ready ? .green : .red)
        .frame(width: 8, height: 8)
}

@ViewBuilder
func kubernetesPVCPhaseBadge(_ phase: String) -> some View {
    let color: Color =
        switch phase {
        case "Bound":
            .green
        case "Pending":
            .orange
        case "Lost":
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
