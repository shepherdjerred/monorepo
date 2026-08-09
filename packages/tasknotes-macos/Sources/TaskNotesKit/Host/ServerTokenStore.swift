internal import Security
internal import Synchronization

internal import struct Foundation.Data
internal import class Foundation.NSString

/// Where the server's bearer token lives.
///
/// A protocol rather than a concrete type for one reason: the real
/// implementation writes to the login Keychain, and a test that ran against it
/// would leave an entry in the developer's own Keychain and — worse — could
/// read or overwrite the one the installed app is using. Every test uses
/// ``InMemoryTokenStore``.
public protocol ServerTokenStore: Sendable {
    /// The stored token, or `nil` when none has been saved.
    func token() -> String?

    /// Store `token`, or remove the entry when it is `nil` or empty.
    ///
    /// Empty and absent are deliberately the same state here, unlike the saved
    /// views' storage: a bearer token of `""` is not a credential, and keeping
    /// one would make the app send `Authorization: Bearer ` and get a 401 that
    /// looks like a server problem rather than an unset field.
    func setToken(_ token: String?)
}

/// The login Keychain, as a generic password.
///
/// ## Why the Keychain and not `UserDefaults`
///
/// Everything else this app persists — the server address, saved views, window
/// state — is a preference, and `UserDefaults` is the platform's answer for
/// preferences. A bearer token is not a preference: it is a credential that
/// grants full read/write access to the vault. `UserDefaults` inside the sandbox
/// is a plist in the container, readable by anything that can read the
/// container and included verbatim in an unencrypted backup.
///
/// The plan names the Security framework directly for this, and explicitly
/// rejects `KeychainAccess` — a wrapper with no release since 2021 — for a
/// dependency whose entire job is four C calls.
public struct KeychainTokenStore: ServerTokenStore {
    /// The `kSecAttrService` the entry is filed under.
    ///
    /// Bundle-scoped so a debug build and the installed app do not fight over
    /// one entry, which would otherwise present as the token vanishing whenever
    /// the other one wrote.
    private let service: String

    /// The `kSecAttrAccount`. One server, one token, so it is a constant.
    private static let account = "server"

    public init(service: String = "red.sjer.tasknotes.serverToken") {
        self.service = service
    }

    public func token() -> String? {
        let query: [NSString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: Self.account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]

        // `unsafe` because `SecItemCopyMatching` writes through an
        // `UnsafeMutablePointer`, which `SWIFT_STRICT_MEMORY_SAFETY` requires be
        // spelled out at the call site. That marker is the *point* of the
        // setting — it makes the one genuinely unsafe line in this package
        // visible — and it is not one of the four unchecked escapes the lint
        // rule bans, none of which assert anything here: the result is still
        // narrowed with `as?` below.
        var item: CFTypeRef?
        let status = unsafe SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func setToken(_ token: String?) {
        let base: [NSString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: Self.account,
        ]

        // Delete first, unconditionally, then add. `SecItemUpdate` needs the
        // entry to already exist and `SecItemAdd` fails with
        // `errSecDuplicateItem` when it does, so the alternative is branching on
        // a status code to decide which call to make — two paths where one will
        // do, and the delete is also exactly what an empty token should leave
        // behind.
        SecItemDelete(base as CFDictionary)

        guard let token, !token.isEmpty, let data = token.data(using: .utf8) else { return }

        var insert = base
        insert[kSecValueData] = data
        // The token is only ever needed while someone is using the app, and
        // `ThisDeviceOnly` keeps it out of an iCloud Keychain sync and out of an
        // encrypted backup restored onto another Mac.
        insert[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }
}

/// A token store that keeps the value in memory.
///
/// For tests and previews. It exists so no test has to touch the real Keychain
/// — see the note on ``ServerTokenStore``.
///
/// `Mutex` rather than a lock plus `@unchecked Sendable`: the latter is one of
/// the unsafe type escapes this package bans outright, and it would be a
/// promise to the compiler rather than a fact. `Mutex` makes the same guarantee
/// checkable.
public final class InMemoryTokenStore: ServerTokenStore {
    private let stored: Mutex<String?>

    public init(token: String? = nil) {
        stored = Mutex(token)
    }

    public func token() -> String? {
        stored.withLock { $0 }
    }

    public func setToken(_ token: String?) {
        stored.withLock { current in
            current = (token?.isEmpty == true) ? nil : token
        }
    }
}
