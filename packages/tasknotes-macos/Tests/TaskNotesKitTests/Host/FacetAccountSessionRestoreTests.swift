import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit

struct FacetAccountSessionRestoreTests {
    @Test func noOwnerNeverReadsCredentialsOrContactsTheService() async throws {
        let fixture = try RestoreFixture(owner: false)
        defer { NativeTestFiles.remove(fixture.directory) }
        let account = try fixture.account { _ in
            Issue.record("No owner must mean no HTTP request.")
            return (200, Data())
        }
        guard case .noSession = try await account.restoreSession() else {
            Issue.record("An empty account must remain signed out.")
            return
        }
        #expect(fixture.secrets.reads.withLock { $0 } == 0)
    }

    @Test func missingTokenIsExpiredWithoutDeletingOwnership() async throws {
        let fixture = try RestoreFixture(token: nil)
        defer { NativeTestFiles.remove(fixture.directory) }
        let before = try Data(contentsOf: fixture.metadata)
        let account = try fixture.account { _ in
            Issue.record("Missing credentials cannot be sent.")
            return (200, Data())
        }
        guard case .expired = try await account.restoreSession() else {
            Issue.record("A missing retained token must require sign-in.")
            return
        }
        #expect(try Data(contentsOf: fixture.metadata) == before)
        #expect(fixture.secrets.writes.withLock { $0 } == 0)
    }

    @Test func cachedTokenUsesOriginalVaultListDecodeAndAccessFilter() async throws {
        let fixture = try RestoreFixture()
        defer { NativeTestFiles.remove(fixture.directory) }
        let before = try Data(contentsOf: fixture.metadata)
        let calls = Mutex(0)
        let account = try fixture.account { request in
            calls.withLock { $0 += 1 }
            #expect(request.httpMethod == "POST")
            #expect(request.url?.path == "/vault/list")
            let body = try #require(request.httpBody)
            let value = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
            #expect(Set(value.keys) == ["token", "supported_encryption_version"])
            #expect(value["token"] as? String == "public-synthetic-token")
            return (200, RestoreFixture.vaultList)
        }
        guard case .vaults(let choices) = try await account.restoreSession() else {
            Issue.record("Only an actual successful list response can restore choices.")
            return
        }
        #expect(choices.map(\.id) == ["allowed-vault"])
        #expect(calls.withLock { $0 } == 1)
        #expect(try Data(contentsOf: fixture.metadata) == before)
        #expect(fixture.secrets.writes.withLock { $0 } == 0)
        #expect(await account.lastExchangeDiagnostic?.requestKind == .listVaults)
    }

    @Test(arguments: [200, 401])
    func rejectedCachedSessionIsExpiredAndNeverRemovesKeys(status: UInt16) async throws {
        let fixture = try RestoreFixture()
        defer { NativeTestFiles.remove(fixture.directory) }
        let account = try fixture.account { _ in
            (status, Data("{\"error\":\"Invalid token\"}".utf8))
        }
        guard case .expired = try await account.restoreSession() else {
            Issue.record("A rejected cached session must require sign-in.")
            return
        }
        #expect(try fixture.secrets.read("account.owner.token") != nil)
        #expect(fixture.secrets.writes.withLock { $0 } == 0)
        try fixture.secrets.write("account.owner.token", bytes: Data([0xFF]))
        await #expect(throws: FacetContractError.self) { try await account.restoreSession() }
    }

    @Test func networkFailureCanRetryTheSameSessionWithoutReplacingCredentials() async throws {
        let fixture = try RestoreFixture()
        defer { NativeTestFiles.remove(fixture.directory) }
        let calls = Mutex(0)
        let account = try fixture.account { _ in
            let attempt = calls.withLock {
                $0 += 1
                return $0
            }
            if attempt == 1 { throw URLError(.notConnectedToInternet) }
            return (200, RestoreFixture.vaultList)
        }
        await #expect(throws: URLError.self) { try await account.restoreSession() }
        guard case .vaults = try await account.restoreSession() else {
            Issue.record("Retry must use the normal authenticated service.")
            return
        }
        #expect(calls.withLock { $0 } == 2)
        #expect(fixture.secrets.writes.withLock { $0 } == 0)
    }

    @Test(arguments: ["fence", "cancel"])
    func inFlightRestoreRejectsLateVaultListAfterFenceOrCancellation(fault: String) async throws {
        let fixture = try RestoreFixture()
        defer { NativeTestFiles.remove(fixture.directory) }
        let pause = RestorePause()
        let account = try fixture.account { _ in
            await pause.stop()
            return (200, RestoreFixture.vaultList)
        }
        let pending = _Concurrency.Task { try await account.restoreSession() }
        await pause.entered()
        if fault == "fence" { account.fenceSessionAccess() } else { pending.cancel() }
        await pause.resume()
        if fault == "fence" {
            await #expect(throws: FacetSyncError.self) { try await pending.value }
        } else {
            await #expect(throws: CancellationError.self) { try await pending.value }
        }
        #expect(fixture.secrets.writes.withLock { $0 } == 0)
    }

    @Test func malformedTokenAndMalformedResponseFailWithoutPretendingToSignOut() async throws {
        let fixture = try RestoreFixture(token: Data([0xFF]))
        defer { NativeTestFiles.remove(fixture.directory) }
        let account = try fixture.account { _ in
            Issue.record("Invalid stored bytes must fail before HTTP.")
            return (200, Data())
        }
        await #expect(throws: FacetContractError.self) { try await account.restoreSession() }
        try fixture.secrets.write("account.owner.token", bytes: Data("public-token".utf8))
        let malformed = try fixture.account { _ in (200, Data("{}".utf8)) }
        await #expect(throws: (any Error).self) { try await malformed.restoreSession() }
    }
}

private struct RestoreFixture {
    let directory: URL
    let secrets: RestoreSecrets
    var metadata: URL { directory.appendingPathComponent("sync-identities.json") }
    init(owner: Bool = true, token: Data? = Data("public-synthetic-token".utf8)) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        secrets = RestoreSecrets(token: token)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if owner {
            try Data("{\"schemaVersion\":1,\"activeOwner\":\"owner\",\"identities\":{}}".utf8)
                .write(to: metadata)
        }
    }
    func account(
        send: @escaping @Sendable (URLRequest) async throws -> (UInt16, Data)
    ) throws -> FacetObsidianAccount {
        try FacetObsidianAccount(
            directory: directory, secrets: secrets, remoteVaultAccess: .only("allowed-vault"),
            send: send)
    }
    static let vaultList = Data(
        """
        {"vaults":[
          {"id":"allowed-vault","name":"Allowed","host":"sync-test.obsidian.md",
           "region":"test","salt":"synthetic","encryption_version":3},
          {"id":"other-vault","name":"Other","host":"sync-test.obsidian.md",
           "region":"test","salt":"synthetic","encryption_version":3}
        ],"shared":[]}
        """.utf8)
}

private final class RestoreSecrets: FacetSecureStore {
    let reads = Mutex(0)
    let writes = Mutex(0)
    private let token: Mutex<Data?>
    init(token: Data?) { self.token = Mutex(token) }
    func read(_ name: String) throws -> Data? {
        reads.withLock { $0 += 1 }
        #expect(name == "account.owner.token")
        return token.withLock { $0 }
    }
    func write(_ name: String, bytes: Data) throws {
        writes.withLock { $0 += 1 }
        token.withLock { $0 = bytes }
    }
    func remove(_ name: String) throws {
        Issue.record("Restoration must not remove retained credentials.")
    }
}

private actor RestorePause {
    private var waiter: CheckedContinuation<Void, Never>?
    private var observer: CheckedContinuation<Void, Never>?
    private var arrived = false
    func stop() async {
        await withCheckedContinuation {
            waiter = $0
            arrived = true
            observer?.resume()
            observer = nil
        }
    }
    func entered() async {
        if !arrived { await withCheckedContinuation { observer = $0 } }
    }
    func resume() {
        waiter?.resume()
        waiter = nil
    }
}
