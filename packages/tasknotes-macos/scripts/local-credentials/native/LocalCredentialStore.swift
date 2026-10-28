import Foundation
import Security

enum LocalCredentialFailure: Int32, Error {
    case missing = 10
    case interactionRequired = 11
    case denied = 12
    case boundary = 13
    case keychain = 14

    var classification: String {
        switch self {
        case .missing: "local_credentials_missing"
        case .interactionRequired: "local_credentials_interaction_required"
        case .denied: "local_credentials_denied"
        case .boundary: "local_credentials_boundary"
        case .keychain: "local_credentials_keychain_failure"
        }
    }

    static func check(_ status: OSStatus) throws {
        if status == errSecSuccess { return }
        if status == errSecItemNotFound { throw Self.missing }
        if [errSecInteractionNotAllowed, errSecInteractionRequired].contains(status) {
            throw Self.interactionRequired
        }
        if [errSecAuthFailed, errSecUserCanceled, errSecDuplicateItem].contains(status) {
            throw Self.denied
        }
        throw Self.keychain
    }
}

/// This acceptance-only store explicitly uses a local classic keychain, with no UI or sync.
struct LocalCredentialStore {
    static let service = "red.sjer.facet.acceptance.credentials"
    static let maximumBytes = 65_536
    let keychain: SecKeychain
    let trustedExecutable: String

    static func validateRecord(_ record: String) throws {
        guard
            record.range(
                of: "\\A[A-Za-z0-9]{20,32}:[A-Za-z0-9]{20,32}:[A-Za-z0-9]{20,32}\\z",
                options: .regularExpression
            ) != nil
        else { throw LocalCredentialFailure.boundary }
    }

    private func preflight(_ record: String) throws {
        try Self.validateRecord(record)
        // LAContext alone does not suppress classic-keychain authentication dialogs.
        try LocalCredentialFailure.check(SecKeychainSetUserInteractionAllowed(false))
        var state: SecKeychainStatus = 0
        try LocalCredentialFailure.check(SecKeychainGetStatus(keychain, &state))
        guard state & SecKeychainStatus(kSecUnlockStateStatus) != 0 else {
            throw LocalCredentialFailure.interactionRequired
        }
    }

    func read(_ record: String) throws -> Data {
        try preflight(record)
        let item = try protectedItem(record)
        var count: UInt32 = 0
        var buffer: UnsafeMutableRawPointer?
        try LocalCredentialFailure.check(
            SecKeychainItemCopyAttributesAndData(item, nil, nil, nil, &count, &buffer))
        guard let buffer else { throw LocalCredentialFailure.boundary }
        let bytes =
            count > 0 && count <= Self.maximumBytes
            ? Data(bytes: buffer, count: Int(count)) : nil
        try LocalCredentialFailure.check(SecKeychainItemFreeAttributesAndData(nil, buffer))
        guard let bytes else { throw LocalCredentialFailure.boundary }
        return bytes
    }

    private func protectedItem(_ record: String) throws -> SecKeychainItem {
        // Nil password pointers request only the typed item reference, without reading data.
        var reference: SecKeychainItem?
        try LocalCredentialFailure.check(
            SecKeychainFindGenericPassword(
                keychain, UInt32(Self.service.utf8.count), Self.service,
                UInt32(record.utf8.count), record, nil, nil, &reference))
        guard let item = reference else { throw LocalCredentialFailure.keychain }
        var actualKeychain: SecKeychain?
        try LocalCredentialFailure.check(SecKeychainItemCopyKeychain(item, &actualKeychain))
        guard let actualKeychain, CFEqual(actualKeychain, keychain) else {
            throw LocalCredentialFailure.denied
        }
        var access: SecAccess?
        try LocalCredentialFailure.check(SecKeychainItemCopyAccess(item, &access))
        guard let access,
            let selected = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt)
                as? [SecACL], !selected.isEmpty
        else { throw LocalCredentialFailure.denied }
        var expected: SecTrustedApplication?
        try LocalCredentialFailure.check(
            SecTrustedApplicationCreateFromPath(trustedExecutable, &expected))
        guard let expected else { throw LocalCredentialFailure.keychain }
        var expectedBytes: CFData?
        try LocalCredentialFailure.check(SecTrustedApplicationCopyData(expected, &expectedBytes))
        guard let expectedBytes else { throw LocalCredentialFailure.keychain }
        for entry in selected {
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
        return item
    }

    func enroll(_ record: String, payload: Data) throws {
        guard !payload.isEmpty, payload.count <= Self.maximumBytes else {
            throw LocalCredentialFailure.boundary
        }
        try preflight(record)
        // Insert only: an existing item may trust other applications. Never place new
        // credentials under its policy, overwrite its bytes, or silently repair its ACL.
        var application: SecTrustedApplication?
        try LocalCredentialFailure.check(
            SecTrustedApplicationCreateFromPath(trustedExecutable, &application))
        guard let application else { throw LocalCredentialFailure.keychain }
        var access: SecAccess?
        try LocalCredentialFailure.check(
            SecAccessCreate(Self.service as CFString, [application] as CFArray, &access))
        guard let access else { throw LocalCredentialFailure.keychain }
        // kSecUseKeychain selects only this classic file keychain. No Data Protection or
        // synchronizable attribute is present; this record cannot be an iCloud item.
        let insertion: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: record,
            kSecValueData as String: payload,
            kSecUseKeychain as String: keychain,
            kSecAttrAccess as String: access,
        ]
        try LocalCredentialFailure.check(SecItemAdd(insertion as CFDictionary, nil))
    }
}
