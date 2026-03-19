import SwiftUI

/// A button that triggers a manual refresh, with spinning animation while refreshing.
struct RefreshButton: View {
    let isRefreshing: Bool
    let action: () -> Void

    var body: some View {
        Button(action: self.action) {
            Image(systemName: "arrow.clockwise")
                .rotationEffect(.degrees(self.isRefreshing ? 360 : 0))
                .animation(
                    self.isRefreshing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default,
                    value: self.isRefreshing,
                )
        }
        .buttonStyle(.borderless)
        .disabled(self.isRefreshing)
        .help("Refresh all services")
    }
}
