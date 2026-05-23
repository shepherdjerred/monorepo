import SwiftUI

// MARK: - ServiceGridItem

/// A single cell in the menu bar popover grid showing a service's status.
struct ServiceGridItem: View {
    let snapshot: ServiceSnapshot

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: self.snapshot.iconName)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: self.snapshot.displayName)
                    .font(.caption.bold())
                    .lineLimit(1)

                Text(verbatim: self.snapshot.summary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            StatusBadge(status: self.snapshot.status)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(self.snapshot.displayName), \(self.snapshot.status.label)")
        .accessibilityValue(self.snapshot.summary)
        .accessibilityHint(String(localized: "Double-tap to open dashboard"))
    }
}

#if DEBUG
    #Preview("Grid Item — OK") {
        ServiceGridItem(snapshot: ServiceSnapshot(
            id: "kubernetes",
            displayName: "Kubernetes",
            iconName: "server.rack",
            status: .ok,
            summary: "12 pods healthy",
            detail: .empty,
            error: nil,
            timestamp: .now,
            webURL: nil,
        ))
        .frame(width: 340)
    }

    #Preview("Grid Item — Error") {
        ServiceGridItem(snapshot: ServiceSnapshot(
            id: "buildkite",
            displayName: "Buildkite",
            iconName: "hammer.fill",
            status: .error,
            summary: "3 builds failing",
            detail: .empty,
            error: "Pipeline timeout",
            timestamp: .now,
            webURL: nil,
        ))
        .frame(width: 340)
    }

    #Preview("Grid Item — Warning") {
        ServiceGridItem(snapshot: ServiceSnapshot(
            id: "prometheus",
            displayName: "Prometheus",
            iconName: "flame",
            status: .warning,
            summary: "2 targets down",
            detail: .empty,
            error: nil,
            timestamp: .now,
            webURL: nil,
        ))
        .frame(width: 340)
    }
#endif
