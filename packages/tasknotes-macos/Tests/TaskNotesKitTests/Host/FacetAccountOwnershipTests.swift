import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit

struct FacetAccountOwnershipTests {
    @Test func detachingOneProfilePreservesSiblingKeyAccountTokenAndRestartOwnership() async throws
    {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let vault: [String: FacetValue] = [
            "id": .string("public-vault"), "name": .string("Test vault"),
            "host": .string("sync-test.obsidian.md"), "region": .string("test"),
            "salt": .string("public-salt"), "encryptionVersion": .integer(3),
            "managed": .bool(true), "shared": .bool(false),
        ]
        let identity = FacetValue.object(["owner": .string("old-owner"), "vault": .object(vault)])
        let metadata = FacetValue.object([
            "schemaVersion": .integer(1), "activeOwner": .string("old-owner"),
            "identities": .object(["old-profile": identity, "new-profile": identity]),
        ])
        try Data(FacetJSON.encode(metadata).utf8).write(
            to: root.appendingPathComponent("sync-identities.json"))
        let secrets = SyntheticAccountSecrets()
        let account = try FacetObsidianAccount(directory: root, secrets: secrets)
        let removed = try await account.access(profileID: "old-profile")
        let sibling = try await account.access(profileID: "new-profile")
        secrets.failRemoval(of: "vault.old-profile.key")
        await #expect(throws: FacetSyncError.self) {
            try await account.detachProfile(profileID: "old-profile")
        }
        #expect(await !account.allows(removed))
        #expect(await account.allows(sibling))
        #expect(try secrets.read("vault.old-profile.key")?.count == 32)
        #expect(try secrets.read("vault.new-profile.key")?.count == 32)
        #expect(try secrets.read("account.old-owner.token") != nil)
        let reopened = try FacetObsidianAccount(directory: root, secrets: secrets)
        #expect(await reopened.connections().map(\.profileID) == ["new-profile"])
        #expect(try await reopened.access(profileID: "new-profile").profileID == "new-profile")
        #expect(await reopened.retryDetachedProfileCleanup().count == 1)
        secrets.failRemoval(of: nil)
        #expect(await reopened.retryDetachedProfileCleanup().isEmpty)
        #expect(try secrets.read("vault.old-profile.key") == nil)
        try await reopened.detachProfile(profileID: "old-profile")
    }

    @Test func oldProfileCredentialsCannotResumeUnderAnotherActiveAccount() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let vault = FacetValue.object([
            "id": .string("public-vault"), "name": .string("Test vault"),
            "host": .string("sync-test.obsidian.md"), "region": .string("test"),
            "salt": .string("public-salt"), "encryptionVersion": .integer(3),
            "managed": .bool(true), "shared": .bool(false),
        ])
        let metadata = FacetValue.object([
            "schemaVersion": .integer(1), "activeOwner": .string("new-owner"),
            "identities": .object([
                "old-profile": .object(["owner": .string("old-owner"), "vault": vault]),
                "new-profile": .object(["owner": .string("new-owner"), "vault": vault]),
            ]),
        ])
        try Data(FacetJSON.encode(metadata).utf8).write(
            to: root.appendingPathComponent("sync-identities.json"))
        let secrets = SyntheticAccountSecrets()
        let account = try FacetObsidianAccount(directory: root, secrets: secrets)
        await #expect(throws: FacetSyncError.self) {
            try await account.access(profileID: "old-profile")
        }
        let authorized = try await account.access(profileID: "new-profile")
        #expect(authorized.identity.owner == "new-owner")
        #expect(await account.allows(authorized))
        let wrongOwner = FacetSyncAccess(
            profileID: "old-profile",
            identity: FacetSyncIdentity(owner: "old-owner", vault: authorized.identity.vault),
            token: "synthetic-old-token", key: Data(repeating: 7, count: 32), generation: 0)
        #expect(await !account.allows(wrongOwner))
        #expect(await account.connections().map(\.profileID) == ["new-profile", "old-profile"])
        try await checkReminderCapabilities(account, secrets: secrets)
        try secrets.write("vault.new-profile.key", bytes: Data(repeating: 8, count: 32))
        let beforeIntent = try await account.access(profileID: "new-profile")
        account.fenceSessionAccess()
        #expect(await !account.allows(beforeIntent))
        #expect(try secrets.read("account.new-owner.token") == Data("synthetic-new-token".utf8))
        #expect(try secrets.read("vault.new-profile.key")?.count == 32)
    }

    private func checkReminderCapabilities(
        _ account: FacetObsidianAccount,
        secrets: SyntheticAccountSecrets
    ) async throws {
        #expect(try await account.eligibleReminderProfileIDs() == ["new-profile"])
        try secrets.remove("vault.new-profile.key")
        #expect(try await account.eligibleReminderProfileIDs().isEmpty)
        #expect(await account.authorizedProfileIDs() == ["new-profile"])
        try secrets.write("vault.new-profile.key", bytes: Data(repeating: 8, count: 32))
        try secrets.remove("account.new-owner.token")
        #expect(try await account.eligibleReminderProfileIDs().isEmpty)
        try secrets.write("account.new-owner.token", bytes: Data("synthetic-new-token".utf8))
        try secrets.write("vault.new-profile.key", bytes: Data(repeating: 8, count: 31))
        await #expect(throws: FacetContractError.self) {
            try await account.eligibleReminderProfileIDs()
        }
    }
}

private final class SyntheticAccountSecrets: FacetSecureStore {
    private let failingRemoval = Mutex<String?>(nil)
    private let values = Mutex([
        "account.old-owner.token": Data("synthetic-old-token".utf8),
        "account.new-owner.token": Data("synthetic-new-token".utf8),
        "vault.old-profile.key": Data(repeating: 7, count: 32),
        "vault.new-profile.key": Data(repeating: 8, count: 32),
    ])
    func read(_ name: String) throws -> Data? { values.withLock { $0[name] } }
    func write(_ name: String, bytes: Data) throws { values.withLock { $0[name] = bytes } }
    func failRemoval(of name: String?) { failingRemoval.withLock { $0 = name } }
    func remove(_ name: String) throws {
        guard failingRemoval.withLock({ $0 != name }) else { throw FacetSyncError.secureStorage }
        _ = values.withLock { $0.removeValue(forKey: name) }
    }
}
