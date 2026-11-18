public import Foundation
internal import Security
internal import Synchronization

/// Typed failure surfaced when reading or writing the Facet server token in Keychain.
public enum FacetKeychainError: Error, LocalizedError, Sendable, Equatable {
    case unreadableText
    case status(action: String, code: Int32)

    public var errorDescription: String? {
        switch self {
        case .unreadableText:
            "The stored server token is not readable UTF-8 text."
        case .status(let action, let code):
            "Could not \(action) in Keychain (OSStatus \(code))."
        }
    }
}

/// Storage boundary for the Facet server bearer token.
public protocol ServerTokenStore: Sendable {
    func token() -> Result<String?, FacetKeychainError>
    func setToken(_ token: String?) -> FacetKeychainError?
}

/// System Keychain bearer-token store accessible after first device unlock on this device only.
public struct KeychainTokenStore: ServerTokenStore {
    private let service: String
    private static let account = "server"

    public init(service: String = "red.sjer.tasknotes.serverToken") {
        self.service = service
    }

    public func token() -> Result<String?, FacetKeychainError> {
        let query: [NSString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: Self.account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = unsafe SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return .success(nil)
        }
        guard status == errSecSuccess else {
            return .failure(.status(action: "read the stored server token", code: status))
        }
        guard let data = item as? Data, let stored = String(data: data, encoding: .utf8) else {
            return .failure(.unreadableText)
        }
        return .success(stored)
    }

    public func setToken(_ token: String?) -> FacetKeychainError? {
        let base: [NSString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: Self.account,
        ]

        guard let token, !token.isEmpty, let data = token.data(using: .utf8) else {
            let removal = SecItemDelete(base as CFDictionary)
            guard removal == errSecSuccess || removal == errSecItemNotFound else {
                return .status(action: "remove the stored server token", code: removal)
            }
            return nil
        }

        let updatedAttributes: [NSString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let update = SecItemUpdate(base as CFDictionary, updatedAttributes as CFDictionary)
        if update == errSecSuccess {
            return nil
        }
        guard update == errSecItemNotFound else {
            return .status(action: "update the stored server token", code: update)
        }

        var insert = base
        insert[kSecValueData] = data
        insert[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let insertion = SecItemAdd(insert as CFDictionary, nil)
        guard insertion == errSecSuccess else {
            return .status(action: "store the server token", code: insertion)
        }
        return nil
    }
}

/// Thread-safe in-memory token store for tests, previews, and isolated UI test runs.
public final class InMemoryTokenStore: ServerTokenStore {
    private let stored: Mutex<String?>

    public init(token: String? = nil) {
        let normalized = (token?.isEmpty == true) ? nil : token
        stored = Mutex(normalized)
    }

    public func token() -> Result<String?, FacetKeychainError> {
        .success(stored.withLock { $0 })
    }

    public func setToken(_ token: String?) -> FacetKeychainError? {
        stored.withLock { current in
            current = (token?.isEmpty == true) ? nil : token
        }
        return nil
    }
}
