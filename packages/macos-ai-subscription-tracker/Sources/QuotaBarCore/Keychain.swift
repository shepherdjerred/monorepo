public import Foundation
import Security

/// The read-only half of keychain access. `LocalCredentialStore` only ever reads items another
/// tool owns and must never write them, so it depends on this narrower protocol.
public protocol KeychainReading: Sendable {
  func read(service: String, account: String?) throws -> Data?
}

public protocol KeychainClient: KeychainReading {
  func write(_ data: Data, service: String, account: String) throws
  func delete(service: String, account: String) throws
}

public struct SystemKeychainClient: KeychainClient, Sendable {
  public init() {}

  public func read(service: String, account: String?) throws -> Data? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    if let account { query[kSecAttrAccount as String] = account }
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw QuotaError.keychain(status: status) }
    guard let data = result as? Data else { throw QuotaError.keychain(status: errSecDecode) }
    return data
  }

  public func write(_ data: Data, service: String, account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecSuccess { return }
    guard updateStatus == errSecItemNotFound else {
      throw QuotaError.keychain(status: updateStatus)
    }
    var item = query
    for (key, value) in attributes { item[key] = value }
    let addStatus = SecItemAdd(item as CFDictionary, nil)
    guard addStatus == errSecSuccess else { throw QuotaError.keychain(status: addStatus) }
  }

  public func delete(service: String, account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw QuotaError.keychain(status: status)
    }
  }
}

/// Reads a login-keychain item owned by another tool through `/usr/bin/security` instead of
/// `SecItemCopyMatching`.
///
/// Claude Code stores its OAuth credentials with `security add-generic-password -U`, which
/// re-creates the item and resets its access-control list to the creating tool. A grant Brim earns
/// from the system's "Always Allow" dialog therefore survives only until the next token refresh,
/// after which every poll prompts for the login keychain password again. `/usr/bin/security` is
/// the trusted application that each of those rewrites re-establishes, so reading through it stays
/// silent and keeps working across refreshes.
public struct SecurityToolKeychainClient: KeychainReading, Sendable {
  /// `security` exits 44 when no item matches the query and 36 when the keychain itself is
  /// missing. Both mean the credential is absent, which is the normal state for a tool the user has
  /// not signed into. Every other non-zero status is a genuine failure and must surface.
  private static let absentStatuses: Set<Int32> = [36, 44]
  private static let executableURL = URL(fileURLWithPath: "/usr/bin/security")

  private let commandRunner: any SynchronousCommandRunning

  public init(
    commandRunner: any SynchronousCommandRunning = FoundationSynchronousCommandRunner()
  ) {
    self.commandRunner = commandRunner
  }

  public func read(service: String, account: String?) throws -> Data? {
    var arguments = ["find-generic-password", "-w", "-s", service]
    if let account {
      arguments.append(contentsOf: ["-a", account])
    }
    let result = try commandRunner.run(executableURL: Self.executableURL, arguments: arguments)
    guard !Self.absentStatuses.contains(result.terminationStatus) else { return nil }
    guard result.terminationStatus == 0,
      let output = String(data: result.stdout, encoding: .utf8)
    else {
      throw QuotaError.commandFailed("security")
    }
    let payload = output.trimmingCharacters(in: .whitespacesAndNewlines)
    return payload.isEmpty ? nil : Data(payload.utf8)
  }
}
