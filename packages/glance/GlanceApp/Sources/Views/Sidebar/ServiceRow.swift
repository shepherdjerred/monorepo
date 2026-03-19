import SwiftUI

/// A single row in the dashboard sidebar showing a service and its status.
struct ServiceRow: View {
    let snapshot: ServiceSnapshot

    var body: some View {
        Label {
            HStack {
                Text(self.snapshot.displayName)
                Spacer()
                StatusBadge(status: self.snapshot.status)
            }
        } icon: {
            Image(systemName: self.snapshot.iconName)
                .foregroundStyle(.secondary)
        }
    }
}
