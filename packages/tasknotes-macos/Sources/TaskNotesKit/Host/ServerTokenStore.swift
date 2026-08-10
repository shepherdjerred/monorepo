internal import Security
internal import Synchronization
public import TaskNotesUniFFI

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
    ///
    /// ⚠️ **Not discardable.** A caller that drops the answer shows a Settings
    /// pane claiming a credential was saved while the next `configure` reads
    /// nothing — the one failure mode where the app's account of itself and
    /// its behaviour disagree, and the user has no way to tell.
    ///
    /// - Returns: the failure, or `nil` when the value was stored. An
    ///   implementation that cannot store the replacement must leave whatever
    ///   was already there intact.
    func setToken(_ token: String?) -> CoreError?
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

    public func setToken(_ token: String?) -> CoreError? {
        let base: [NSString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: Self.account,
        ]

        guard let token, !token.isEmpty, let data = token.data(using: .utf8) else {
            // Clearing the field is a real instruction, so an entry that was
            // not there to begin with is success rather than something to
            // report.
            let removal = SecItemDelete(base as CFDictionary)
            guard removal == errSecSuccess || removal == errSecItemNotFound else {
                return Self.failure("could not remove the stored server token", removal)
            }
            return nil
        }

        // Update in place, and add only when there is nothing to update.
        //
        // ⚠️ **Never delete first.** A delete-then-add pair looks like one path
        // instead of two, but it spends the working credential before it knows
        // the replacement will land: if the add then fails — the Keychain
        // locked, the signing entitlement wrong, the daemon unavailable — the
        // old token is already gone and the app is left with no credential at
        // all, having just told the user it saved one.
        let update = SecItemUpdate(base as CFDictionary, [kSecValueData: data] as CFDictionary)
        if update == errSecSuccess { return nil }
        guard update == errSecItemNotFound else {
            return Self.failure("could not update the stored server token", update)
        }

        var insert = base
        insert[kSecValueData] = data
        // The token is only ever needed while someone is using the app, and
        // `ThisDeviceOnly` keeps it out of an iCloud Keychain sync and out of an
        // encrypted backup restored onto another Mac.
        insert[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let insertion = SecItemAdd(insert as CFDictionary, nil)
        guard insertion == errSecSuccess else {
            return Self.failure("could not store the server token", insertion)
        }
        return nil
    }

    /// A Keychain status, as something the banner can say.
    ///
    /// `.Invariant` rather than a new error type: this is the same channel as
    /// every other "something this Mac could not do", and `TaskNotesStore`
    /// already routes that to the connection banner.
    private static func failure(_ what: String, _ status: OSStatus) -> CoreError {
        .Invariant(message: "\(what) (Keychain status \(status))")
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

    public func setToken(_ token: String?) -> CoreError? {
        stored.withLock { current in
            current = (token?.isEmpty == true) ? nil : token
        }
        return nil
    }
}
