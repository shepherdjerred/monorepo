import SwiftUI
import TaskNotesKit

internal struct FacetSyncNotice: View {
    let state: FacetSyncStatus

    var body: some View {
        Label(state.message, systemImage: symbol)
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("facet.sync.status")
            .accessibilityValue(state.phase.rawValue)
    }

    private var symbol: String {
        switch state.phase {
        case .synced: "checkmark.icloud"
        case .offline: "wifi.slash"
        case .reconnectRequired, .failed: "exclamationmark.icloud"
        case .conflict: "exclamationmark.arrow.triangle.2.circlepath"
        case .stopped: "pause.circle"
        case .connecting, .syncing: "arrow.triangle.2.circlepath"
        }
    }
}
