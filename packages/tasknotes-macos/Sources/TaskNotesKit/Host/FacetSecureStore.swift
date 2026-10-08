public import Foundation
import Security

public protocol FacetSecureStore: Sendable {
    func read(_ name: String) throws -> Data?
    func write(_ name: String, bytes: Data) throws
    func remove(_ name: String) throws
}

/// Secrets are device-bound, excluded from synchronization and vault snapshots.
public struct FacetKeychainStore: FacetSecureStore {
    private let service: String
    public init(service: String = "red.sjer.facet.obsidian") { self.service = service }

    private func query(_ name: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: name,
        ]
    }

    public func read(_ name: String) throws -> Data? {
        var query = query(name)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = unsafe SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = result as? Data else {
            throw FacetSyncError.secureStorage
        }
        return bytes
    }

    public func write(_ name: String, bytes: Data) throws {
        let base = query(name)
        let status = SecItemUpdate(
            base as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw FacetSyncError.secureStorage }
        var insertion = base
        insertion[kSecValueData as String] = bytes
        insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else {
            throw FacetSyncError.secureStorage
        }
    }

    public func remove(_ name: String) throws {
        let status = SecItemDelete(query(name) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw FacetSyncError.secureStorage
        }
    }
}

public enum FacetSyncError: Error, LocalizedError {
    case secureStorage, signedOut, transport, responseTooLarge, cancelled, missingTimestamp
    public var errorDescription: String? {
        switch self {
        case .secureStorage:
            "Facet could not access its secure credentials. Unlock this device and reconnect your Obsidian account."
        case .signedOut:
            "Reconnect your Obsidian account to resume Sync. Your local vault remains available."
        case .transport:
            "Obsidian Sync could not complete its connection. Check your network and retry."
        case .responseTooLarge: "The account service response exceeded its supported size."
        case .cancelled: "This account operation was cancelled."
        case .missingTimestamp:
            "This pending upload has no durable file timestamps. Refresh its vault metadata before retrying Sync."
        }
    }
}
