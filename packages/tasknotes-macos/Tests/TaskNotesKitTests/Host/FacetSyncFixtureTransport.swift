import Foundation
import Synchronization
import TaskNotesTestSupport
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

internal struct FacetFixtureHTTP: Sendable {
    let ready: FacetSyncFixtureProcess.Ready
    let session = URLSession(
        configuration: .ephemeral, delegate: FacetAccountRedirectPolicy(), delegateQueue: nil)

    func send(_ original: URLRequest) async throws -> (UInt16, Data) {
        guard let url = original.url, url.scheme == "https", url.host == "api.obsidian.md",
            url.port == nil, url.user == nil, url.password == nil, url.query == nil,
            url.fragment == nil,
            ["/user/signin", "/user/signout", "/user/info", "/vault/list", "/vault/access"]
                .contains(url.path),
            let method = original.httpMethod, ["OPTIONS", "POST"].contains(method)
        else { throw FacetSyncError.transport }
        var request = original
        request.url = ready.httpOrigin.appendingPathComponent(String(url.path.dropFirst()))
        request.timeoutInterval = 5
        return try await response(request)
    }

    func control(_ action: String) async throws {
        var request = URLRequest(url: ready.httpOrigin.appendingPathComponent("__fixture/control"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "runID": ready.runID, "action": action,
        ])
        let (status, bytes) = try await response(request)
        #expect(status == 200)
        #expect(try JSONDecoder().decode(FixtureControl.self, from: bytes).ok)
    }

    func state() async throws -> FacetValue {
        var url = URLComponents(
            url: ready.httpOrigin.appendingPathComponent("__fixture/state"),
            resolvingAgainstBaseURL: false)
        url?.queryItems = [URLQueryItem(name: "runID", value: ready.runID)]
        let target = try #require(url?.url)
        let (status, bytes) = try await response(URLRequest(url: target))
        #expect(status == 200)
        return try FacetJSON.parse(bytes)
    }

    private func response(_ request: URLRequest) async throws -> (UInt16, Data) {
        var bounded = request
        bounded.timeoutInterval = 5
        let (bytes, response) = try await session.data(for: bounded)
        guard let http = response as? HTTPURLResponse,
            let status = UInt16(exactly: http.statusCode),
            bytes.count <= 1_048_576
        else { throw FacetContractError.unsupportedResponse }
        return (status, bytes)
    }

    private struct FixtureControl: Decodable { let ok: Bool }
}

internal final class FacetFixtureReplica {
    let directory: URL
    let profileID: String
    private let secrets: FixtureSecrets
    private(set) var engine: FacetEngine
    private(set) var account: FacetObsidianAccount
    private(set) var session: FacetObsidianSession?

    private init(
        directory: URL, secrets: FixtureSecrets, engine: FacetEngine, account: FacetObsidianAccount,
        profileID: String
    ) {
        self.directory = directory
        self.secrets = secrets
        self.engine = engine
        self.account = account
        self.profileID = profileID
    }

    static func create(
        directory: URL, http: FacetFixtureHTTP, approveStandard: Bool = true
    ) async throws -> FacetFixtureReplica {
        let keys = FixtureSecrets()
        let runtime = try await FacetEngine.open(
            directory: directory.appendingPathComponent("engine"), secrets: keys)
        do {
            let ownerAccount = try Self.account(directory, secrets: keys, http: http)
            guard case nil = ownerAccount.acceptanceFixtureIdentity else {
                throw FacetContractError.unsupportedResponse
            }
            guard
                case .needsCode = try await ownerAccount.signIn(
                    email: "synthetic@example.test", password: "public-synthetic-password", code: ""
                )
            else { throw FacetContractError.unsupportedResponse }
            guard
                case .rejectedCode = try await ownerAccount.signIn(
                    email: "synthetic@example.test", password: "public-synthetic-password",
                    code: "000000")
            else { throw FacetContractError.unsupportedResponse }
            let signedIn = try await ownerAccount.signIn(
                email: "synthetic@example.test", password: "public-synthetic-password",
                code: "123456")
            guard case .vaults(let choices) = signedIn, choices.map(\.id) == [http.ready.vaultID]
            else {
                throw FacetContractError.unsupportedResponse
            }
            let profile = try await ownerAccount.connect(
                vaultID: http.ready.vaultID, password: "Å synthetic fixture １２３", engine: runtime)
            if approveStandard { try await runtime.approveStandard(profile: profile) }
            _ = try await runtime.refresh(profileID: profile.id)
            return FacetFixtureReplica(
                directory: directory, secrets: keys, engine: runtime, account: ownerAccount,
                profileID: profile.id)
        } catch {
            try await runtime.close()
            throw error
        }
    }

    func start(http: FacetFixtureHTTP) async throws {
        guard session == nil else { throw FacetContractError.unsupportedResponse }
        session = try await FacetObsidianSession.open(
            engine: engine, account: account, profileID: profileID,
            socketEndpoint: .loopbackFixture(http.ready.webSocketURL), changed: {}, status: { _ in }
        )
    }

    func stopTransport() async {
        await session?.stop()
        session = nil
    }

    func reopenOffline(http: FacetFixtureHTTP) async throws {
        await stopTransport()
        try await engine.close()
        engine = try await FacetEngine.open(
            directory: directory.appendingPathComponent("engine"), secrets: secrets)
        account = try Self.account(directory, secrets: secrets, http: http)
        #expect(try await engine.profiles().map(\.id) == [profileID])
        #expect(await account.connections().map(\.profileID) == [profileID])
    }

    func close() async throws {
        await stopTransport()
        try await engine.close()
    }

    func snapshot() async throws -> FacetSnapshot {
        try await engine.snapshot(profileID: profileID, query: .object(["scope": .string("all")]))
    }

    func markdown(_ task: FacetTask) throws -> Data {
        try Data(
            contentsOf: directory.appendingPathComponent("engine/replicas/\(profileID)")
                .appendingPathComponent(task.path))
    }

    private static func account(_ directory: URL, secrets: FixtureSecrets, http: FacetFixtureHTTP)
        throws -> FacetObsidianAccount
    {
        try FacetObsidianAccount(
            directory: directory.appendingPathComponent("account"), secrets: secrets,
            remoteVaultAccess: .only(http.ready.vaultID), send: { try await http.send($0) })
    }
}

private final class FixtureSecrets: FacetSecureStore {
    private let values = Mutex<[String: Data]>([:])
    func read(_ name: String) -> Data? { values.withLock { $0[name] } }
    func write(_ name: String, bytes: Data) { values.withLock { $0[name] = bytes } }
    func remove(_ name: String) { _ = values.withLock { $0.removeValue(forKey: name) } }
}

internal struct FacetFixtureRetryControl {
    let root: URL
    let engine: FacetEngine
    let session: FacetObsidianSession
    let profileID: String

    static func open() async throws -> FacetFixtureRetryControl {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        let keys = FixtureSecrets()
        let runtime = try await FacetEngine.open(
            directory: directory.appendingPathComponent("engine"), secrets: keys)
        let profile = try await runtime.registerReplica(
            id: UUID().uuidString, name: "Synthetic retry ownership")
        try await runtime.approveStandard(profile: profile)
        _ = try await runtime.refresh(profileID: profile.id)
        let owner = try FacetObsidianAccount(
            directory: directory.appendingPathComponent("account"), secrets: keys)
        let vaultJSON = """
            {"id":"synthetic","name":"Synthetic","host":"sync-fixture.obsidian.md",
             "region":"test","salt":"synthetic","encryptionVersion":3,"managed":true,"shared":false}
            """
        let vault = try JSONDecoder().decode(FacetRemoteVault.self, from: Data(vaultJSON.utf8))
        let worker = try FacetObsidianSession(
            engine: runtime, account: owner, profileID: profile.id,
            access: FacetSyncAccess(
                profileID: profile.id,
                identity: FacetSyncIdentity(owner: "synthetic", vault: vault),
                token: "public-synthetic-token", key: Data(repeating: 7, count: 32), generation: 0),
            checkpoint: "", changed: {}, status: { _ in })
        return FacetFixtureRetryControl(
            root: directory, engine: runtime, session: worker, profileID: profile.id)
    }

    func verify() async throws {
        try await engine.execute(
            profileID: profileID,
            command: .object([
                "kind": .string("create"),
                "properties": .object(["title": .string("Retained upload")]),
            ]))
        let original = try await engine.uploads(profileID: profileID)
        let id = try #require(original.first?.object?.fields["mutationId"]?.text)
        #expect(try await session.syntheticFailureRetains(id, retryable: true))
        #expect(try await engine.uploads(profileID: profileID) == original)
        #expect(try await !session.syntheticFailureRetains(id, retryable: false))
        #expect(try await engine.uploads(profileID: profileID) == original)
    }

    func close() async throws {
        await session.stop()
        try await engine.close()
        NativeTestFiles.remove(root)
    }
}

extension FacetObsidianSession {
    fileprivate func syntheticFailureRetains(_ id: String, retryable: Bool) async throws -> Bool {
        queued.insert(id)
        _ = try await executeEffect(
            .failed(
                code: "timeout", message: "Synthetic timeout", retryable: retryable, operationId: id
            ), nowMs: 0)
        return queued.contains(id)
    }
}
