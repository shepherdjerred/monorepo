import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit

@Suite("Acceptance isolation")
struct FacetAcceptanceConfigurationTests {
    #if DEBUG
        @Test func descriptorCannotRedirectPrivateStateOrSecrets() throws {
            let support = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            let first = UUID()
            let second = UUID()
            let config = try configuration(runID: first, support: support)
            let other = try configuration(runID: second, support: support)
            #expect(config.stateDirectory != other.stateDirectory)
            #expect(config.accountKeychainService != other.accountKeychainService)
            #expect(config.stagingKeychainService != other.stagingKeychainService)
            #expect(config.defaultsSuiteName != other.defaultsSuiteName)
            #expect(config.accountKeychainService != "red.sjer.facet.obsidian")
            #expect(config.stagingKeychainService != "red.sjer.facet.vault-stages")
            try config.requireRemoteVault("test-vault")
            #expect(throws: FacetAcceptanceError.self) {
                try config.requireRemoteVault("other-vault")
            }
            let local = try configuration(runID: first, support: support, vaultID: nil)
            #expect(local.remoteVaultAccess.displays("test-vault"))
            #expect(!local.remoteVaultAccess.permits("test-vault"))
            #expect(throws: FacetAcceptanceError.self) {
                try local.requireRemoteVault("test-vault")
            }
        }

        private enum InvalidDescriptor: CaseIterable {
            case outside, otherRun, traversal, extraField, emptyVault, version
        }

        @Test(arguments: InvalidDescriptor.allCases)
        private func malformedDescriptorIsRejected(kind: InvalidDescriptor) throws {
            let support = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            let runID = UUID()
            var fields = descriptor(runID: runID, support: support)
            switch kind {
            case .outside: fields["stateDirectory"] = .string(support.path)
            case .otherRun: fields["runID"] = .string(UUID().uuidString)
            case .traversal:
                fields["stateDirectory"] = .string(
                    support.appendingPathComponent("FacetAcceptance/../Facet").path)
            case .extraField: fields["token"] = .string("synthetic-value")
            case .emptyVault: fields["allowedRemoteVaultID"] = .string("")
            case .version: fields["schemaVersion"] = .integer(2)
            }
            #expect(throws: (any Error).self) {
                try FacetAcceptanceConfiguration.decode(
                    Data(FacetJSON.encode(.object(fields)).utf8), applicationSupport: support)
            }
        }

        @Test func privateAcceptanceRootCannotBeSymlinkedElsewhere() throws {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            defer { NativeTestFiles.remove(root) }
            let support = root.appendingPathComponent("support")
            let outside = root.appendingPathComponent("outside")
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(
                at: support.appendingPathComponent("FacetAcceptance"), withDestinationURL: outside)
            #expect(throws: FacetAcceptanceError.self) {
                try configuration(runID: UUID(), support: support)
            }
        }

        @Test func productionMacIdentityCannotUseAcceptanceLaunch() {
            #expect(throws: FacetAcceptanceError.self) {
                try FacetAcceptanceConfiguration.launch(
                    arguments: ["Facet", "--facet-acceptance-descriptor", "/unused.json"],
                    bundleID: "red.sjer.tasknotes.mac", environment: [:])
            }
            #expect(throws: FacetAcceptanceError.self) {
                try FacetAcceptanceConfiguration.launch(
                    arguments: ["Facet"], bundleID: "red.sjer.tasknotes.mac.acceptance",
                    environment: [:])
            }
        }

        @Test func simulatorVirtualPathIsExactAndCannotRedirectAfterReinstall() throws {
            let support = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            let runID = UUID()
            var fields = descriptor(runID: runID, support: support)
            let virtual =
                "/Library/Application Support/FacetAcceptance/" + runID.uuidString.lowercased()
            fields["stateDirectory"] = .string(virtual)
            let bytes = Data(try FacetJSON.encode(.object(fields)).utf8)
            let resolved = try FacetAcceptanceConfiguration.decode(
                bytes, applicationSupport: support, containerRelative: true)
            #expect(
                resolved.stateDirectory.path
                    == support.resolvingSymlinksInPath()
                    .appendingPathComponent("FacetAcceptance/" + runID.uuidString.lowercased()).path
            )
            #expect(throws: FacetAcceptanceError.self) {
                try FacetAcceptanceConfiguration.decode(bytes, applicationSupport: support)
            }
            for invalid in [virtual + "/../escape", virtual + "-other", support.path] {
                fields["stateDirectory"] = .string(invalid)
                #expect(throws: FacetAcceptanceError.self) {
                    try FacetAcceptanceConfiguration.decode(
                        Data(FacetJSON.encode(.object(fields)).utf8), applicationSupport: support,
                        containerRelative: true)
                }
            }
            #if os(macOS)
                #expect(throws: FacetAcceptanceError.self) {
                    try FacetAcceptanceConfiguration.launch(
                        arguments: [
                            "Facet", "--facet-acceptance-descriptor", "@documents/acceptance.json",
                        ],
                        bundleID: "red.sjer.tasknotes.mac.acceptance", environment: [:])
                }
            #endif
        }

        private func configuration(runID: UUID, support: URL, vaultID: String? = "test-vault")
            throws
            -> FacetAcceptanceConfiguration
        {
            var fields = descriptor(runID: runID, support: support)
            fields["allowedRemoteVaultID"] = vaultID.map(FacetValue.string)
            return try FacetAcceptanceConfiguration.decode(
                Data(FacetJSON.encode(.object(fields)).utf8), applicationSupport: support)
        }

        private func descriptor(runID: UUID, support: URL) -> [String: FacetValue] {
            [
                "schemaVersion": .integer(1), "runID": .string(runID.uuidString),
                "stateDirectory": .string(
                    support.appendingPathComponent("FacetAcceptance")
                        .appendingPathComponent(runID.uuidString.lowercased()).path),
                "allowedRemoteVaultID": .string("test-vault"),
            ]
        }
    #endif

    @Test func disallowedRetainedVaultFailsBeforeAnyCredentialAccess() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let vault = FacetValue.object([
            "id": .string("unrelated-vault"), "name": .string("Synthetic vault"),
            "host": .string("sync-test.obsidian.md"), "region": .string("test"),
            "salt": .string("synthetic-salt"), "encryptionVersion": .integer(3),
            "managed": .bool(false), "shared": .bool(false),
        ])
        let metadata = FacetValue.object([
            "schemaVersion": .integer(1), "activeOwner": .string("synthetic-owner"),
            "identities": .object([
                "profile": .object(["owner": .string("synthetic-owner"), "vault": vault])
            ]),
        ])
        try Data(FacetJSON.encode(metadata).utf8).write(
            to: root.appendingPathComponent("sync-identities.json"))
        let secrets = ProbedAcceptanceSecrets()
        #expect(throws: FacetAcceptanceError.self) {
            try FacetObsidianAccount(
                directory: root, secrets: secrets, remoteVaultAccess: .only("test-vault"))
        }
        #expect(secrets.accessCount == 0)
    }

    @Test func remoteAuthorizationFailsBeforeCredentialReadOrAccountRequest() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let secrets = ProbedAcceptanceSecrets()
        let engine = try await FacetEngine.open(
            directory: root.appendingPathComponent("engine"), secrets: secrets)
        let account = try FacetObsidianAccount(
            directory: root.appendingPathComponent("account"), secrets: secrets,
            remoteVaultAccess: .disabled)
        let before = secrets.accessCount
        await #expect(throws: FacetAcceptanceError.self) {
            try await account.connect(vaultID: "test-vault", password: nil, engine: engine)
        }
        await #expect(throws: FacetAcceptanceError.self) {
            try await account.reauthorize(
                profileID: "profile", vaultID: "test-vault", password: nil, engine: engine)
        }
        #expect(secrets.accessCount == before)
        #expect(await account.lastExchangeDiagnostic == nil)
        try await engine.close()
    }
}

private final class ProbedAcceptanceSecrets: FacetSecureStore {
    private let count = Mutex(0)
    var accessCount: Int { count.withLock { $0 } }
    func read(_ name: String) throws -> Data? {
        count.withLock { $0 += 1 }
        return nil
    }
    func write(_ name: String, bytes: Data) throws { count.withLock { $0 += 1 } }
    func remove(_ name: String) throws { count.withLock { $0 += 1 } }
}
