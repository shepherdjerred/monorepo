import Foundation
import TaskNotesKit

internal struct FacetAccountPresentation {
    enum Stage { case credentials, verification, vaults }
    enum Operation {
        case signingIn, connecting, restoring
        var message: String {
            switch self {
            case .signingIn: "Signing in to Obsidian…"
            case .connecting: "Connecting your Sync vault…"
            case .restoring: "Restoring your Obsidian session…"
            }
        }
    }
    var stage = Stage.credentials
    var operation: Operation?
    var error: String?
    var notice: String?
    var requestID: UUID?
    var cancelled = false
    var restoreFailed = false
    var restoreAttempted = false
    var isBusy: Bool { operation != nil }

    static func failureMessage(_ failure: any Error) -> String {
        if let url = failure as? URLError {
            return url.code == .timedOut
                ? "The account request timed out. Check your connection and try again."
                : "Could not reach Obsidian. Check your connection and try again."
        }
        let classification = FacetFailureDiagnostic(failure).classification
        if classification == "account_rejected" {
            return
                "Obsidian rejected the account request. Check your email, password and verification code."
        }
        if classification == "account" { return "Unlock this device and try signing in again." }
        if classification == "network" {
            return "Could not reach Obsidian. Check your connection and try again."
        }
        if classification == "cancelled" {
            return "The account request was cancelled. Try again when ready."
        }
        if classification == "internal_contract" {
            return
                "Facet could not read the Obsidian account response. Reopen or update Facet before retrying."
        }
        return
            "The Obsidian account request could not finish. Check your credentials and try again. "
            + "If this continues, reopen Facet."
    }
}
