import Foundation
import TaskNotesUniFFI

public enum FacetAccountSignIn: Sendable {
    case needsCode, rejectedCode
    case vaults([FacetRemoteVault])
}

public enum FacetAccountSessionRestore: Sendable {
    case noSession, expired
    case vaults([FacetRemoteVault])
}

internal struct FacetSyncIdentity: Codable, Sendable {
    let owner: String
    let vault: FacetRemoteVault
}
internal struct FacetSyncAccess: Sendable {
    let profileID: String
    let identity: FacetSyncIdentity
    let token: String
    let key: Data
    let generation: UInt64
}

internal enum FacetCachedAccountSession {
    static func clear(
        _ owner: String, secrets: any FacetSecureStore, identities: [String: FacetSyncIdentity]
    ) throws {
        try secrets.remove("account.\(owner).token")
        for (id, identity) in identities where identity.owner == owner {
            try secrets.remove("vault.\(id).key")
        }
    }

    static func restore(
        owner: String?, secrets: any FacetSecureStore,
        list: (String) async throws -> ObsidianAccountResponse
    ) async throws -> FacetAccountSessionRestore {
        try _Concurrency.Task.checkCancellation()
        guard let owner else { return .noSession }
        guard var bytes = try secrets.read("account.\(owner).token") else { return .expired }
        defer { bytes.resetBytes(in: 0..<bytes.count) }
        guard let token = String(data: bytes, encoding: .utf8), !token.isEmpty else {
            throw FacetContractError.unsupportedResponse
        }
        do {
            let response = try await list(token)
            guard case .vaults(let vaults) = response else {
                throw FacetContractError.unsupportedResponse
            }
            return .vaults(vaults.map(FacetRemoteVault.init))
        } catch {
            if FacetFailureDiagnostic(error).classification == "account_rejected" {
                return .expired
            }
            throw error
        }
    }
}

public struct FacetVaultConnection: Sendable {
    public let profileID: String
    public let vaultID: String
}
