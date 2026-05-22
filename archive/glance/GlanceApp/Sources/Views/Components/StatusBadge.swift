import SwiftUI

// MARK: - StatusBadge

/// A small colored circle indicating service health status.
struct StatusBadge: View {
    let status: ServiceStatus

    var body: some View {
        Image(systemName: self.status.iconName)
            .font(.caption2)
            .foregroundStyle(self.status.color)
            .accessibilityLabel(Text("Status: \(self.status.label)"))
    }
}

#if DEBUG
    #Preview("Status Badges") {
        HStack(spacing: 16) {
            StatusBadge(status: .ok)
            StatusBadge(status: .warning)
            StatusBadge(status: .error)
            StatusBadge(status: .unknown)
        }
        .padding()
    }
#endif
