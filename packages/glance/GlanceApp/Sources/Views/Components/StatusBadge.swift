import SwiftUI

/// A small colored circle indicating service health status.
struct StatusBadge: View {
    let status: ServiceStatus

    var body: some View {
        Image(systemName: self.status.iconName)
            .font(.caption2)
            .foregroundStyle(self.status.color)
    }
}
