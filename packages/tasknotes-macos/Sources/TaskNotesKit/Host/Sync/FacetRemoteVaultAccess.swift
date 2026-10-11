public import Foundation

/// An acceptance client may never authorize a different remote vault, even if
/// the signed-in account owns it. Production clients retain unrestricted access.
public enum FacetRemoteVaultAccess: Sendable, Equatable {
    case unrestricted
    case only(String)
    case disabled

    internal func permits(_ id: String) -> Bool {
        switch self {
        case .unrestricted: true
        case .only(let permitted): permitted == id
        case .disabled: false
        }
    }

    /// Listing owned vault metadata is safe before a run is bound. A displayed
    /// choice does not grant access: authorizeVault still checks permits first.
    internal func displays(_ id: String) -> Bool {
        switch self {
        case .unrestricted, .disabled: true
        case .only(let permitted): permitted == id
        }
    }

    public func requireRemoteVault(_ id: String) throws {
        guard permits(id) else { throw FacetAcceptanceError.remoteVaultDenied }
    }
}

public enum FacetAcceptanceError: Error, LocalizedError {
    case invalidDescriptor, wrongApplication, remoteVaultDenied

    public var errorDescription: String? {
        switch self {
        case .invalidDescriptor:
            "The acceptance launch descriptor is invalid or outside this app's private acceptance directory."
        case .wrongApplication:
            "Native acceptance requires the dedicated acceptance app or a disposable iOS simulator."
        case .remoteVaultDenied:
            "This acceptance run may connect only to its designated remote vault."
        }
    }
}
