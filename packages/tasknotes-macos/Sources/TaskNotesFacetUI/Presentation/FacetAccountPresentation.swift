import Foundation

internal struct FacetAccountPresentation {
    enum Stage { case credentials, verification, vaults }
    enum Operation {
        case signingIn, connecting
        var message: String {
            switch self {
            case .signingIn: "Signing in to Obsidian…"
            case .connecting: "Connecting your Sync vault…"
            }
        }
    }
    var stage = Stage.credentials
    var operation: Operation?
    var error: String?
    var notice: String?
    var requestID: UUID?
    var cancelled = false
    var isBusy: Bool { operation != nil }
}
