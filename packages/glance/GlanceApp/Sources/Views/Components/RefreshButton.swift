import SwiftUI

/// A button that triggers a manual refresh, with spinning animation while refreshing.
struct RefreshButton: View {
    // MARK: Internal

    let isRefreshing: Bool
    let action: () -> Void

    var body: some View {
        Button(action: self.action) {
            Image(systemName: "arrow.clockwise")
                .rotationEffect(.degrees(self.isRefreshing ? 360 : 0))
                .animation(
                    self.spinnerAnimation,
                    value: self.isRefreshing,
                )
        }
        .buttonStyle(.borderless)
        .disabled(self.isRefreshing)
        .help("Refresh all services")
        .accessibilityLabel(self.isRefreshing ? String(localized: "Refreshing") : String(localized: "Refresh"))
        .accessibilityHint(self.isRefreshing ? "" : String(localized: "Refreshes all service statuses"))
    }

    // MARK: Private

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var spinnerAnimation: Animation? {
        if self.reduceMotion {
            return .default
        }
        return self.isRefreshing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default
    }
}
