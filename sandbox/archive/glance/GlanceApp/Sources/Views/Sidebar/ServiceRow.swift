import SwiftUI

/// A single row in the dashboard sidebar showing a service and its status.
struct ServiceRow: View {
    // MARK: Internal

    let snapshot: ServiceSnapshot

    var body: some View {
        Label {
            HStack {
                Text(verbatim: self.snapshot.displayName)
                Spacer()
                StatusBadge(status: self.snapshot.status)
            }
        } icon: {
            Image(systemName: self.snapshot.iconName)
                .foregroundStyle(.secondary)
        }
        .badge(self.badgeCount)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(self.accessibilityDescription)
    }

    // MARK: Private

    private var badgeCount: Int {
        switch self.snapshot.status {
        case .error,
             .warning:
            1
        case .ok,
             .unknown:
            0
        }
    }

    private var accessibilityDescription: String {
        "\(self.snapshot.displayName), \(self.snapshot.status.label), \(self.snapshot.summary)"
    }
}
