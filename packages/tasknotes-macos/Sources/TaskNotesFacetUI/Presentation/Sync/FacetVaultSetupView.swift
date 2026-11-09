import SwiftUI
import TaskNotesKit

/// Missing configuration describes vault setup, never an empty task list.
internal struct FacetVaultSetupView: View {
    let state: FacetSyncStatus?
    let needsStandardConsent: Bool

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "icloud.and.arrow.down")
        } description: {
            Text(detail)
        }
        .accessibilityIdentifier("facet.vault.setup")
    }

    private var title: String {
        if needsStandardConsent { return "Choose your TaskNotes settings" }
        if let state, [.offline, .reconnectRequired, .failed, .stopped].contains(state.phase) {
            return "Vault setup is paused"
        }
        return "Setting up your vault"
    }

    private var detail: String {
        if needsStandardConsent {
            return
                "No TaskNotes settings were found. Choose Use standard configuration above to continue."
        }
        if let state, [.offline, .reconnectRequired, .failed, .stopped].contains(state.phase) {
            return state.message
        }
        return
            "Your tasks will appear when your TaskNotes settings arrive. A separate configuration file is optional."
    }
}
