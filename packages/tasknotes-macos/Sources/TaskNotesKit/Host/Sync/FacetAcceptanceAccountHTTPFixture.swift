#if DEBUG
    import Darwin
    public import Foundation
    import Synchronization

    /// Actual initialized fixture ownership, relayed into the private input handshake.
    public struct FacetAcceptanceAccountFixtureIdentity: Equatable, Sendable {
        public let runID: UUID
        public let sessionID: UUID
    }

    /// A closed synthetic HTTP boundary. No request can fall through to URLSession.
    internal final class FacetAcceptanceAccountHTTPFixture: Sendable {
        private enum Phase { case preflight, signIn, complete, rejected }
        internal let identity: FacetAcceptanceAccountFixtureIdentity
        internal let directory: URL
        private let phase = Mutex(Phase.preflight)
        private let requestPath: String
        private let preflightStatus: UInt16
        private let responseStatus: UInt16
        private let responseBody: Data

        internal init(
            configuration: FacetAcceptanceConfiguration, accountDirectory: URL,
            sessionID: UUID, schema: Data
        ) throws {
            let expected = configuration.stateDirectory.appendingPathComponent("accounts")
            guard accountDirectory == expected,
                accountDirectory.standardizedFileURL == accountDirectory,
                accountDirectory.resolvingSymlinksInPath() == accountDirectory
            else { throw FacetAcceptanceError.invalidDescriptor }
            let definition = try Self.definition(schema)
            guard let selectedPath = definition["requestPath"] as? String,
                let preflight = definition["preflightStatus"] as? UInt16,
                let response = definition["responseStatus"] as? UInt16,
                let body = definition["responseBody"] as? [String: String],
                Set(body.keys) == ["error"]
            else { throw FacetAcceptanceError.invalidDescriptor }
            identity = FacetAcceptanceAccountFixtureIdentity(
                runID: configuration.runID, sessionID: sessionID)
            directory = accountDirectory.appendingPathComponent(
                "verification-fixture-" + sessionID.uuidString.lowercased())
            requestPath = selectedPath
            preflightStatus = preflight
            responseStatus = response
            responseBody = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            try Self.createDirectory(directory)
            let receipt = try JSONSerialization.data(
                withJSONObject: [
                    "schemaVersion": 1, "mode": "fixture-verification",
                    "runID": identity.runID.uuidString.lowercased(),
                    "sessionID": identity.sessionID.uuidString.lowercased(),
                ], options: [.sortedKeys])
            let receiptURL = directory.appendingPathComponent("identity.json")
            try receipt.write(to: receiptURL, options: .withoutOverwriting)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600], ofItemAtPath: receiptURL.path)
        }

        internal static func launch(directory: URL) throws -> FacetAcceptanceAccountHTTPFixture? {
            #if os(macOS) || targetEnvironment(simulator)
                let environment = ProcessInfo.processInfo.environment
                guard let operation = environment["FACET_E2E_ACCOUNT_OPERATION"] else {
                    guard environment["FACET_E2E_ACCOUNT_MODE"] == nil else {
                        throw FacetAcceptanceError.invalidDescriptor
                    }
                    return nil
                }
                guard
                    ["probe", "auth-only", "connect-only", "fixture-verification"].contains(
                        operation),
                    environment["FACET_E2E_ACCOUNT_MODE"]
                        == (operation == "fixture-verification" ? operation : "account")
                else { throw FacetAcceptanceError.invalidDescriptor }
                guard operation == "fixture-verification" else { return nil }
                return try launchedFixture(directory: directory, environment: environment)
            #else
                return nil
            #endif
        }

        private static func definition(_ data: Data) throws -> [String: Any] {
            guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let definitions = root["$defs"] as? [String: Any],
                let fixture = definitions["verification-fixture"] as? [String: Any],
                let value = fixture["const"] as? [String: Any]
            else { throw FacetAcceptanceError.invalidDescriptor }
            try FacetSchema(data: data).validate(
                data: JSONSerialization.data(withJSONObject: value),
                definition: "verification-fixture")
            guard value["mode"] as? String == "fixture-verification" else {
                throw FacetAcceptanceError.invalidDescriptor
            }
            return value
        }

        private static func createDirectory(_ directory: URL) throws {
            let manager = FileManager.default
            try manager.createDirectory(
                at: directory.deletingLastPathComponent(), withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            guard !manager.fileExists(atPath: directory.path) else {
                throw FacetAcceptanceError.invalidDescriptor
            }
            try manager.createDirectory(
                at: directory, withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700])
            let attributes = try manager.attributesOfItem(atPath: directory.path)
            guard directory.resolvingSymlinksInPath().path == directory.path,
                attributes[.type] as? FileAttributeType == .typeDirectory,
                (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
                (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700
            else { throw FacetAcceptanceError.invalidDescriptor }
        }
    }

    extension FacetAcceptanceAccountHTTPFixture {
        internal func response(_ request: URLRequest) throws -> (UInt16, Data) {
            try phase.withLock { current in
                do {
                    try requireEndpoint(request)
                    switch current {
                    case .preflight:
                        guard request.httpMethod == "OPTIONS", request.httpBody == nil,
                            Self.headerNames(request) == ["origin"]
                        else { throw FacetAcceptanceError.invalidDescriptor }
                        current = .signIn
                        return (preflightStatus, Data())
                    case .signIn:
                        try requireSyntheticSignIn(request)
                        current = .complete
                        return (responseStatus, responseBody)
                    case .complete, .rejected:
                        throw FacetAcceptanceError.invalidDescriptor
                    }
                } catch {
                    current = .rejected
                    throw error
                }
            }
        }

        private func requireEndpoint(_ request: URLRequest) throws {
            guard let url = request.url, url.scheme == "https", url.host == "api.obsidian.md",
                url.path == requestPath, url.query == nil, url.fragment == nil,
                url.user == nil, url.password == nil, url.port == nil,
                let rawOrigin = request.value(forHTTPHeaderField: "Origin"),
                let origin = URL(string: rawOrigin), origin.scheme == "https",
                origin.host == "obsidian.md", origin.path.isEmpty, origin.port == nil,
                origin.user == nil, origin.password == nil, origin.query == nil,
                origin.fragment == nil
            else { throw FacetAcceptanceError.invalidDescriptor }
        }

        private static func headerNames(_ request: URLRequest) -> Set<String> {
            Set((request.allHTTPHeaderFields ?? [:]).keys.map { $0.lowercased() })
        }

        private func requireSyntheticSignIn(_ request: URLRequest) throws {
            guard request.httpMethod == "POST",
                Self.headerNames(request) == ["origin", "content-type"],
                request.value(forHTTPHeaderField: "Content-Type") == "application/json",
                let body = request.httpBody, body.count <= 2048,
                let fields = try JSONSerialization.jsonObject(with: body) as? [String: String],
                Set(fields.keys) == ["email", "password", "mfa"], fields["mfa"] == "",
                let email = fields["email"], let password = fields["password"],
                Self.synthetic(email, prefix: "facet-probe-", suffix: "@example.invalid"),
                Self.synthetic(password, prefix: "Facet-private-probe-", suffix: "-q7!")
            else { throw FacetAcceptanceError.invalidDescriptor }
        }

        private static func synthetic(_ value: String, prefix: String, suffix: String) -> Bool {
            guard value.hasPrefix(prefix), value.hasSuffix(suffix),
                value.count == prefix.count + 36 + suffix.count
            else { return false }
            return UUID(uuidString: String(value.dropFirst(prefix.count).dropLast(suffix.count)))
                != nil
        }
    }

    #if os(macOS) || targetEnvironment(simulator)
        extension FacetAcceptanceAccountHTTPFixture {
            private static func launchedFixture(
                directory: URL, environment: [String: String]
            ) throws -> FacetAcceptanceAccountHTTPFixture {
                #if os(macOS)
                    var virtualized: Int32 = 0
                    var size = MemoryLayout<Int32>.size
                    guard Bundle.main.bundleIdentifier == "red.sjer.tasknotes.mac.acceptance",
                        unsafe sysctlbyname("kern.hv_vmm_present", &virtualized, &size, nil, 0)
                            == 0,
                        size == MemoryLayout<Int32>.size, virtualized == 1
                    else { throw FacetAcceptanceError.wrongApplication }
                #else
                    guard
                        Bundle.main.bundleIdentifier
                            == "org.reactjs.native.example.TasksForObsidian",
                        let device = environment["SIMULATOR_UDID"], UUID(uuidString: device) != nil,
                        environment["FACET_E2E_SIMULATOR"] == device
                    else { throw FacetAcceptanceError.wrongApplication }
                #endif
                guard let configuration = try FacetAcceptanceConfiguration.launch(),
                    let run = environment["FACET_E2E_RUN_ID"],
                    UUID(uuidString: run) == configuration.runID,
                    let session = environment["FACET_E2E_ACCOUNT_SESSION"],
                    let sessionID = UUID(uuidString: session),
                    let resource = Bundle.main.url(
                        forResource: "account-input.schema", withExtension: "json")
                else { throw FacetAcceptanceError.invalidDescriptor }
                return try FacetAcceptanceAccountHTTPFixture(
                    configuration: configuration, accountDirectory: directory,
                    sessionID: sessionID, schema: Data(contentsOf: resource))
            }
        }
    #endif

    internal struct FacetAcceptanceAccountNoAuthStore: FacetSecureStore {
        func read(_ name: String) throws -> Data? { throw FacetAcceptanceError.invalidDescriptor }
        func write(_ name: String, bytes: Data) throws {
            throw FacetAcceptanceError.invalidDescriptor
        }
        func remove(_ name: String) throws { throw FacetAcceptanceError.invalidDescriptor }
    }
#endif
