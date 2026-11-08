import Darwin
import Foundation
import Security

private func canonicalFixturePath(_ path: String) throws -> String {
    guard let resolved = realpath(path, nil) else { throw LocalCredentialFailure.boundary }
    defer { free(resolved) }
    return String(cString: resolved)
}

struct CredentialFixture {
    let directory: URL
    let keychain: SecKeychain
    let originalSearchList: CFArray

    init() throws {
        try LocalCredentialFailure.check(SecKeychainSetUserInteractionAllowed(false))
        var searchList: CFArray?
        try LocalCredentialFailure.check(SecKeychainCopySearchList(&searchList))
        guard let searchList else { throw LocalCredentialFailure.keychain }
        originalSearchList = searchList
        directory = URL(
            fileURLWithPath: try canonicalFixturePath(FileManager.default.temporaryDirectory.path)
        )
        .appendingPathComponent(
            "FacetLocalCredentialsControls-" + UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        let syntheticPassword = UUID().uuidString
        let keychainPath = directory.appendingPathComponent("fixture.keychain").path
        var created: SecKeychain?
        let status = syntheticPassword.withCString { bytes in
            SecKeychainCreate(
                keychainPath,
                UInt32(syntheticPassword.utf8.count), bytes, false, nil, &created)
        }
        guard status == errSecSuccess, let created else {
            try FileManager.default.removeItem(at: directory)
            throw LocalCredentialFailure.keychain
        }
        keychain = created
    }

    func cleanup() throws {
        guard directory.lastPathComponent.hasPrefix("FacetLocalCredentialsControls-"),
            try canonicalFixturePath(directory.path) == directory.path,
            (try FileManager.default.attributesOfItem(atPath: directory.path)[.ownerAccountID]
                as? NSNumber)?.uint32Value == getuid()
        else { throw LocalCredentialFailure.boundary }
        var pathLength: UInt32 = 4096
        var pathBytes = [CChar](repeating: 0, count: Int(pathLength))
        try LocalCredentialFailure.check(SecKeychainGetPath(keychain, &pathLength, &pathBytes))
        guard String(cString: pathBytes).hasPrefix(directory.path + "/fixture.keychain") else {
            throw LocalCredentialFailure.boundary
        }
        try LocalCredentialFailure.check(SecKeychainDelete(keychain))
        try FileManager.default.removeItem(at: directory)
        var currentSearchList: CFArray?
        try LocalCredentialFailure.check(SecKeychainCopySearchList(&currentSearchList))
        guard let currentSearchList, CFEqual(originalSearchList, currentSearchList),
            !FileManager.default.fileExists(atPath: directory.path)
        else { throw LocalCredentialFailure.keychain }
    }

    func item(_ record: String) throws -> SecKeychainItem {
        var item: SecKeychainItem?
        try LocalCredentialFailure.check(
            SecKeychainFindGenericPassword(
                keychain, UInt32(LocalCredentialStore.service.utf8.count),
                LocalCredentialStore.service,
                UInt32(record.utf8.count), record, nil, nil, &item))
        guard let item else { throw LocalCredentialFailure.keychain }
        return item
    }

    func decryptionACL(_ record: String) throws -> [SecACL] {
        var access: SecAccess?
        try LocalCredentialFailure.check(SecKeychainItemCopyAccess(try item(record), &access))
        guard let access,
            let selected = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt)
                as? [SecACL], !selected.isEmpty
        else { throw LocalCredentialFailure.keychain }
        return selected
    }

    func rawSyntheticBytes(_ record: String) throws -> Data {
        var count: UInt32 = 0
        var buffer: UnsafeMutableRawPointer?
        try LocalCredentialFailure.check(
            SecKeychainItemCopyAttributesAndData(try item(record), nil, nil, nil, &count, &buffer))
        guard let buffer else { throw LocalCredentialFailure.keychain }
        let bytes = Data(bytes: buffer, count: Int(count))
        try LocalCredentialFailure.check(SecKeychainItemFreeAttributesAndData(nil, buffer))
        return bytes
    }

    func verifyOnlyTrustedReader(_ record: String, executable: String) throws {
        var expected: SecTrustedApplication?
        try LocalCredentialFailure.check(
            SecTrustedApplicationCreateFromPath(executable, &expected))
        guard let expected else { throw LocalCredentialFailure.keychain }
        var expectedBytes: CFData?
        try LocalCredentialFailure.check(SecTrustedApplicationCopyData(expected, &expectedBytes))
        guard let expectedBytes else { throw LocalCredentialFailure.keychain }
        for entry in try decryptionACL(record) {
            var applications: CFArray?
            var description: CFString?
            var selector = SecKeychainPromptSelector(rawValue: 0)
            try LocalCredentialFailure.check(
                SecACLCopyContents(entry, &applications, &description, &selector))
            guard let trusted = applications as? [SecTrustedApplication], trusted.count == 1,
                let application = trusted.first
            else { throw LocalCredentialFailure.denied }
            var actualBytes: CFData?
            try LocalCredentialFailure.check(
                SecTrustedApplicationCopyData(application, &actualBytes))
            guard let actualBytes, CFEqual(actualBytes, expectedBytes) else {
                throw LocalCredentialFailure.denied
            }
        }
        var actualKeychain: SecKeychain?
        try LocalCredentialFailure.check(
            SecKeychainItemCopyKeychain(try item(record), &actualKeychain))
        guard let actualKeychain, CFEqual(actualKeychain, keychain) else {
            throw LocalCredentialFailure.keychain
        }
    }

    /// Deliberately hostile ACL exists only on synthetic bytes in this disposable keychain.
    func addBroadlyTrustedSyntheticItem(_ record: String, payload: Data) throws {
        var access: SecAccess?
        try LocalCredentialFailure.check(
            SecAccessCreate("Synthetic hostile fixture" as CFString, nil, &access))
        guard let access,
            let selected = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt)
                as? [SecACL], !selected.isEmpty
        else { throw LocalCredentialFailure.keychain }
        for entry in selected {
            try LocalCredentialFailure.check(
                SecACLSetContents(entry, nil, "Synthetic hostile fixture" as CFString, []))
        }
        let insertion: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: LocalCredentialStore.service,
            kSecAttrAccount as String: record,
            kSecValueData as String: payload,
            kSecUseKeychain as String: keychain,
            kSecAttrAccess as String: access,
        ]
        try LocalCredentialFailure.check(SecItemAdd(insertion as CFDictionary, nil))
    }
}
