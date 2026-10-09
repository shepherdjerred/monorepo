import CryptoKit
public import Foundation
import Synchronization
import TaskNotesUniFFI

public struct FacetRemoteVault: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let host: String
    public let region: String
    public let salt: String
    public let encryptionVersion: UInt8
    public let managed: Bool
    public let shared: Bool

    fileprivate init(_ vault: ObsidianRemoteVault) {
        id = vault.id
        name = vault.name
        host = vault.host
        region = vault.region
        salt = vault.salt
        encryptionVersion = vault.encryptionVersion
        managed = vault.managed
        shared = vault.shared
    }
}

public enum FacetAccountSignIn: Sendable {
    case needsCode, rejectedCode
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

private final class FacetAccountRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// Account HTTP and secure ownership are independent of presentation selection.
public actor FacetObsidianAccount {
    private let account = FfiObsidianAccount()
    private let secrets: any FacetSecureStore
    private let metadataURL: URL
    private let transport: URLSession
    private var identities: [String: FacetSyncIdentity]
    private var pendingKeyRemoval: Set<String> = []
    private var activeOwner: String?
    private nonisolated let accessEpoch = Mutex<UInt64>(0)
    private var generation: UInt64 { accessEpoch.withLock { $0 } }
    private var choices: [FacetRemoteVault] = []

    public init(directory: URL, secrets: any FacetSecureStore = FacetKeychainStore()) throws {
        self.secrets = secrets
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        metadataURL = directory.appendingPathComponent("sync-identities.json")
        do {
            let bytes = try Data(contentsOf: metadataURL)
            try Self.validateMetadataShape(bytes)
            let metadata = try JSONDecoder().decode(FacetAccountMetadata.self, from: bytes)
            guard metadata.schemaVersion == 1 else { throw FacetContractError.unsupportedResponse }
            identities = metadata.identities
            activeOwner = metadata.activeOwner
            pendingKeyRemoval = metadata.pendingKeyRemoval
            guard pendingKeyRemoval.isDisjoint(with: identities.keys),
                pendingKeyRemoval.allSatisfy({
                    !$0.isEmpty && $0.utf8.count <= 256
                        && !$0.unicodeScalars.contains(
                            where: CharacterSet.controlCharacters.contains)
                })
            else { throw FacetContractError.unsupportedResponse }
        } catch let failure as NSError
            where failure.domain == NSCocoaErrorDomain && failure.code == NSFileReadNoSuchFileError
        { identities = [:] }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        transport = URLSession(
            configuration: configuration, delegate: FacetAccountRedirectPolicy(), delegateQueue: nil
        )
    }

    public static func open(directory: URL) async throws -> FacetObsidianAccount {
        try await _Concurrency.Task.detached { try FacetObsidianAccount(directory: directory) }
            .value
    }

    /// Account intent immediately revokes existing access leases. Credentials
    /// remain untouched until the caller has stopped and drained sessions.
    public nonisolated func fenceSessionAccess() {
        _ = advanceGeneration()
    }

    private nonisolated func advanceGeneration() -> UInt64 {
        accessEpoch.withLock { epoch in
            epoch += 1
            return epoch
        }
    }

    private static func validateMetadataShape(_ bytes: Data) throws {
        guard let fields = try FacetJSON.parse(bytes).object?.fields,
            let version = fields["schemaVersion"], FacetJSONNumbers.isInteger(version),
            FacetJSONNumbers.compare(version, .integer(1)) == 0,
            Set(fields.keys).isSubset(of: [
                "schemaVersion", "activeOwner", "identities", "pendingKeyRemoval",
            ])
        else { throw FacetContractError.unsupportedResponse }
        if let pending = fields["pendingKeyRemoval"] {
            guard let values = pending.array?.elements,
                Set(values.compactMap(\.text)).count == values.count
            else {
                throw FacetContractError.unsupportedResponse
            }
        }
    }

    public func signIn(email: String, password: String, code: String) async throws
        -> FacetAccountSignIn
    {
        let attempt = advanceGeneration()
        choices = []
        let response = try await perform(
            account.signIn(email: email, password: password, mfa: code), generation: attempt)
        try _Concurrency.Task.checkCancellation()
        guard attempt == generation else { throw FacetSyncError.cancelled }
        switch response {
        case .mfaRequired: return .needsCode
        case .mfaRejected: return .rejectedCode
        case .signedIn(let token, _, let accountEmail):
            let owner = SHA256.hash(data: Data(accountEmail.lowercased().utf8)).map {
                let hex = String($0, radix: 16)
                return hex.count == 1 ? "0" + hex : hex
            }.joined()
            if let previous = activeOwner, previous != owner { try clear(owner: previous) }
            try secrets.write("account.\(owner).token", bytes: Data(token.utf8))
            activeOwner = owner
            try persist()
            let listed = try await perform(account.listVaults(token: token), generation: attempt)
            try _Concurrency.Task.checkCancellation()
            guard attempt == generation else { throw FacetSyncError.cancelled }
            guard case .vaults(let vaults) = listed else {
                throw FacetContractError.unsupportedResponse
            }
            choices = vaults.map(FacetRemoteVault.init)
            return .vaults(choices)
        case .signedOut, .userInfo, .vaults, .accessGranted:
            throw FacetContractError.unsupportedResponse
        }
    }

    public func connect(vaultID: String, password: String?, engine: FacetEngine) async throws
        -> FacetProfile
    {
        let authorization = try await authorizeVault(
            vaultID: vaultID, password: password)
        let owner = authorization.owner
        let prepared = authorization.prepared
        let attempt = authorization.attempt
        try _Concurrency.Task.checkCancellation()
        guard attempt == generation else { throw FacetSyncError.cancelled }
        let profileID = UUID().uuidString
        let identity = FacetSyncIdentity(owner: owner, vault: FacetRemoteVault(prepared.vault))
        try secrets.write("vault.\(profileID).key", bytes: prepared.keyBytes)
        identities[profileID] = identity
        let registered: FacetProfile
        do {
            try persist()
            registered = try await engine.registerReplica(
                id: profileID, name: identity.vault.name)
        } catch {
            identities.removeValue(forKey: profileID)
            try persist()
            try secrets.remove("vault.\(profileID).key")
            throw error
        }
        // A later account fence must preserve the registered replica identity;
        // reconnect can restore access without abandoning its uploads/conflicts.
        guard attempt == generation else { throw FacetSyncError.cancelled }
        return registered
    }

    internal func access(profileID: String) throws -> FacetSyncAccess {
        guard let identity = identities[profileID],
            identity.owner == activeOwner,
            let tokenBytes = try secrets.read("account.\(identity.owner).token"),
            let token = String(data: tokenBytes, encoding: .utf8),
            let key = try secrets.read("vault.\(profileID).key"), key.count == 32
        else { throw FacetSyncError.signedOut }
        return FacetSyncAccess(
            profileID: profileID, identity: identity, token: token, key: key, generation: generation
        )
    }

    internal func allows(_ access: FacetSyncAccess) -> Bool {
        access.generation == generation && access.identity.owner == activeOwner
            && identities[access.profileID]?.owner == access.identity.owner
            && identities[access.profileID]?.vault.id == access.identity.vault.id
    }

    /// Domain removal must succeed before calling this host cleanup. Each
    /// profile owns its own key; the account token and other profile keys remain.
    public func detachProfile(profileID: String) throws {
        guard !profileID.isEmpty, profileID.utf8.count <= 256,
            !profileID.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw FacetContractError.unsupportedResponse }
        let previous = identities.removeValue(forKey: profileID)
        let alreadyPending = pendingKeyRemoval.contains(profileID)
        pendingKeyRemoval.insert(profileID)
        do { try persist() } catch {
            if let previous { identities[profileID] = previous }
            if !alreadyPending { pendingKeyRemoval.remove(profileID) }
            throw error
        }
        try completeProfileKeyRemoval(profileID)
    }

    public func retryDetachedProfileCleanup() -> [FacetFailureDiagnostic] {
        var failures: [FacetFailureDiagnostic] = []
        for id in pendingKeyRemoval.sorted() {
            do { try completeProfileKeyRemoval(id) } catch {
                failures.append(FacetFailureDiagnostic(error))
            }
        }
        return failures
    }

    private func completeProfileKeyRemoval(_ profileID: String) throws {
        guard identities[profileID] == nil else { throw FacetContractError.unsupportedResponse }
        try secrets.remove("vault.\(profileID).key")
        pendingKeyRemoval.remove(profileID)
        do { try persist() } catch {
            pendingKeyRemoval.insert(profileID)
            throw error
        }
    }

    /// The caller stops all profile sessions before credentials are removed.
    public func signOut() async throws {
        _ = advanceGeneration()
        choices = []
        guard let owner = activeOwner else { return }
        let token = try secrets.read("account.\(owner).token").flatMap {
            String(data: $0, encoding: .utf8)
        }
        try clear(owner: owner)
        activeOwner = nil
        try persist()
        if let token {
            _ = try await perform(account.signOut(token: token), generation: generation)
        }
    }

    private func clear(owner: String) throws {
        try secrets.remove("account.\(owner).token")
        for (id, identity) in identities where identity.owner == owner {
            try secrets.remove("vault.\(id).key")
        }
    }
    private func persist() throws {
        let bytes = try JSONEncoder().encode(
            FacetAccountMetadata(
                schemaVersion: 1, activeOwner: activeOwner, identities: identities,
                pendingKeyRemoval: pendingKeyRemoval))
        let files = try VaultDirectory(url: metadataURL.deletingLastPathComponent())
        try files.replaceMetadata(metadataURL.lastPathComponent, bytes: bytes)
    }

    private func perform(_ request: ObsidianHttpRequest, generation attempt: UInt64) async throws
        -> ObsidianAccountResponse
    {
        do {
            let (status, bytes) = try await FacetAccountHTTP.perform(
                request, ownsAttempt: { self.accessEpoch.withLock { $0 == attempt } },
                send: { try await self.response($0) })
            try _Concurrency.Task.checkCancellation()
            guard attempt == generation else { throw FacetSyncError.cancelled }
            guard let body = String(data: bytes, encoding: .utf8) else {
                throw FacetSyncError.transport
            }
            return try account.response(requestId: request.requestId, status: status, body: body)
        } catch {
            // Request disposal is idempotent, including after a decode consumed it.
            try account.cancelRequest(requestId: request.requestId)
            throw error
        }
    }

    private func response(_ request: URLRequest) async throws -> (UInt16, Data) {
        let (stream, nativeResponse) = try await transport.bytes(for: request)
        guard let response = nativeResponse as? HTTPURLResponse,
            let status = UInt16(exactly: response.statusCode)
        else { throw FacetSyncError.transport }
        let limit = 4 * 1024 * 1024
        guard response.expectedContentLength <= Int64(limit) else {
            throw FacetSyncError.responseTooLarge
        }
        var bytes = Data()
        for try await byte in stream {
            guard bytes.count < limit else { throw FacetSyncError.responseTooLarge }
            bytes.append(byte)
        }
        return (status, bytes)
    }
}

public struct FacetVaultConnection: Sendable {
    public let profileID: String
    public let vaultID: String
}

extension FacetObsidianAccount {
    /// Access is reauthorized before any new account can resume this replica.
    public func connections() -> [FacetVaultConnection] {
        identities.map { FacetVaultConnection(profileID: $0.key, vaultID: $0.value.vault.id) }
            .sorted { $0.profileID < $1.profileID }
    }

    public func authorizedProfileIDs() -> Set<String> {
        guard let owner = activeOwner else { return [] }
        return Set(identities.filter { $0.value.owner == owner }.map(\.key))
    }

    /// Device delivery is eligible only with this account's retained token and
    /// exact vault key. Nonsecret ownership metadata alone is insufficient.
    public func eligibleReminderProfileIDs() throws -> Set<String> {
        guard let owner = activeOwner,
            var token = try secrets.read("account.\(owner).token")
        else { return [] }
        defer { token.resetBytes(in: 0..<token.count) }
        guard let text = String(data: token, encoding: .utf8), !text.isEmpty else {
            throw FacetContractError.unsupportedResponse
        }
        var eligible: Set<String> = []
        for (profileID, identity) in identities where identity.owner == owner {
            guard var key = try secrets.read("vault.\(profileID).key") else { continue }
            defer { key.resetBytes(in: 0..<key.count) }
            guard key.count == 32 else { throw FacetContractError.unsupportedResponse }
            eligible.insert(profileID)
        }
        return eligible
    }

    public func reauthorize(
        profileID: String, vaultID: String, password: String?, engine: FacetEngine
    ) async throws -> FacetProfile {
        guard let previous = identities[profileID], previous.vault.id == vaultID,
            let profile = try await engine.profiles().first(where: {
                $0.id == profileID && $0.kind == "obsidian_sync"
            })
        else { throw FacetSyncError.signedOut }
        let authorization = try await authorizeVault(vaultID: vaultID, password: password)
        try _Concurrency.Task.checkCancellation()
        guard authorization.attempt == generation else { throw FacetSyncError.cancelled }
        let owner = authorization.owner
        let prepared = authorization.prepared
        let previousKey = try secrets.read("vault.\(profileID).key")
        _ = advanceGeneration()
        try secrets.write("vault.\(profileID).key", bytes: prepared.keyBytes)
        identities[profileID] = FacetSyncIdentity(
            owner: owner, vault: FacetRemoteVault(prepared.vault))
        do { try persist() } catch {
            identities[profileID] = previous
            if let previousKey {
                try secrets.write("vault.\(profileID).key", bytes: previousKey)
            } else {
                try secrets.remove("vault.\(profileID).key")
            }
            throw error
        }
        return profile
    }

    private struct AuthorizedVault {
        let owner: String
        let prepared: ObsidianPreparedVault
        let attempt: UInt64
    }

    private func authorizeVault(vaultID: String, password: String?) async throws
        -> AuthorizedVault
    {
        guard let owner = activeOwner, choices.contains(where: { $0.id == vaultID }),
            let bytes = try secrets.read("account.\(owner).token"),
            let token = String(data: bytes, encoding: .utf8)
        else { throw FacetSyncError.signedOut }
        let attempt = generation
        let prepared = try account.prepareVault(vaultId: vaultID, password: password)
        guard
            case .accessGranted = try await perform(
                account.vaultAccess(token: token, vaultId: vaultID, keyBytes: prepared.keyBytes),
                generation: attempt)
        else { throw FacetContractError.unsupportedResponse }
        return AuthorizedVault(owner: owner, prepared: prepared, attempt: attempt)
    }
}
