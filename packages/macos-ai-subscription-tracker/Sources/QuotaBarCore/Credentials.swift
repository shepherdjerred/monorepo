public import Foundation
import SQLite3
import Security

public protocol KeychainClient: Sendable {
  func read(service: String, account: String?) throws -> Data?
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

public actor ManualCredentialStore: CredentialStore {
  public static let service = "com.sjerred.QuotaBar.credentials"
  private let keychain: any KeychainClient

  public init(keychain: any KeychainClient = SystemKeychainClient()) {
    self.keychain = keychain
  }

  public func credential(
    for provider: ProviderID,
    rejecting _: ProviderCredential?
  ) throws -> ProviderCredential {
    guard let data = try keychain.read(service: Self.service, account: provider.rawValue) else {
      throw QuotaError.credentialsMissing(provider)
    }
    guard let token = String(data: data, encoding: .utf8) else {
      throw QuotaError.keychain(status: errSecDecode)
    }
    return try ProviderCredential(accessToken: token, source: "Brim Keychain")
  }

  public func credentialIfPresent(for provider: ProviderID) throws -> ProviderCredential? {
    guard let data = try keychain.read(service: Self.service, account: provider.rawValue) else {
      return nil
    }
    guard let token = String(data: data, encoding: .utf8) else {
      throw QuotaError.keychain(status: errSecDecode)
    }
    return try ProviderCredential(accessToken: token, source: "Brim Keychain")
  }

  public func save(_ token: String, for provider: ProviderID) throws {
    let credential = try ProviderCredential(accessToken: token, source: "Brim Keychain")
    try keychain.write(
      Data(credential.accessToken.utf8),
      service: Self.service,
      account: provider.rawValue
    )
  }

  public func remove(for provider: ProviderID) throws {
    try keychain.delete(service: Self.service, account: provider.rawValue)
  }
}

public final class LocalCredentialStore: CredentialStore, @unchecked Sendable {
  private let fileManager: FileManager
  private let homeDirectory: URL
  private let kimiCodeHome: URL?
  private let claudeKeychain: any KeychainClient
  private let selectionLock = NSLock()
  private var rejectedTokens: [ProviderID: Set<String>] = [:]

  public init(
    fileManager: FileManager = .default,
    homeDirectory: URL? = nil,
    kimiCodeHome: URL? = nil,
    claudeKeychain: any KeychainClient = SystemKeychainClient()
  ) {
    self.fileManager = fileManager
    self.homeDirectory = homeDirectory ?? fileManager.homeDirectoryForCurrentUser
    if let kimiCodeHome {
      self.kimiCodeHome = kimiCodeHome
    } else if let configured = ProcessInfo.processInfo.environment["KIMI_CODE_HOME"],
      !configured.isEmpty
    {
      self.kimiCodeHome = URL(fileURLWithPath: configured, isDirectory: true)
    } else {
      self.kimiCodeHome = nil
    }
    self.claudeKeychain = claudeKeychain
  }

  public func credential(
    for provider: ProviderID,
    rejecting rejectedCredential: ProviderCredential?
  ) throws -> ProviderCredential {
    let excludedTokens = excludedTokens(
      for: provider,
      rejecting: rejectedCredential
    )
    let credential: ProviderCredential?
    switch provider {
    case .claudeCode: credential = try readClaude(excluding: excludedTokens)
    case .codex: credential = try readCodex(excluding: excludedTokens)
    case .kimi: credential = try readCurrentKimiCredential(excluding: excludedTokens)
    case .grok: credential = try readOpenCode(provider: provider, excluding: excludedTokens)
    }
    guard let credential else { throw QuotaError.credentialsMissing(provider) }
    return try credential.requireCurrent(for: provider)
  }

  private func readClaude(excluding excludedTokens: Set<String>) throws -> ProviderCredential? {
    let path = homeDirectory.appendingPathComponent(".claude/.credentials.json")
    var expiredFileCredential: ProviderCredential?
    if let file = try decodeFile(ClaudeCredentialFile.self, at: path, provider: .claudeCode) {
      for value in file.credentialCandidates {
        let credential = try makeCredential(value, source: path.path)
        guard !excludedTokens.contains(credential.accessToken) else { continue }
        do {
          return try credential.requireCurrent(for: .claudeCode)
        } catch QuotaError.credentialsExpired {
          if expiredFileCredential == nil { expiredFileCredential = credential }
        }
      }
    }
    guard let data = try claudeKeychain.read(service: "Claude Code-credentials", account: nil)
    else { return expiredFileCredential }
    let file = try decode(ClaudeCredentialFile.self, from: data, provider: .claudeCode)
    for value in file.credentialCandidates {
      let keychainCredential = try makeCredential(value, source: "Claude Code Keychain")
      guard !excludedTokens.contains(keychainCredential.accessToken) else { continue }
      do {
        return try keychainCredential.requireCurrent(for: .claudeCode)
      } catch QuotaError.credentialsExpired {
        if expiredFileCredential == nil { expiredFileCredential = keychainCredential }
      }
    }
    return expiredFileCredential
  }

  private func readCodex(excluding excludedTokens: Set<String>) throws -> ProviderCredential? {
    let path = homeDirectory.appendingPathComponent(".codex/auth.json")
    guard
      let value = try decodeFile(CodexCredentialFile.self, at: path, provider: .codex)?.credential
    else {
      return nil
    }
    let credential = try makeCredential(value, source: path.path)
    return excludedTokens.contains(credential.accessToken) ? nil : credential
  }

  private func readKimi(excluding excludedTokens: Set<String>) throws -> ProviderCredential? {
    let root = kimiCodeHome ?? homeDirectory.appendingPathComponent(".kimi-code")
    let directory = root.appendingPathComponent("credentials")
    guard fileManager.fileExists(atPath: directory.path) else { return nil }
    var expiredCredential: ProviderCredential?
    let files = try fileManager.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil
    ).filter { $0.lastPathComponent != "mcp" }.sorted { $0.path < $1.path }
    for path in files {
      guard let file = try decodeFile(KimiCredentialFile.self, at: path, provider: .kimi) else {
        continue
      }
      for value in file.credentialCandidates {
        let credential = try makeCredential(value, source: path.path)
        guard !excludedTokens.contains(credential.accessToken) else { continue }
        do {
          return try credential.requireCurrent(for: .kimi)
        } catch QuotaError.credentialsExpired {
          if expiredCredential == nil { expiredCredential = credential }
        }
      }
    }
    return expiredCredential
  }

  private func readCurrentKimiCredential(
    excluding excludedTokens: Set<String>
  ) throws -> ProviderCredential? {
    guard let localCredential = try readKimi(excluding: excludedTokens) else {
      return try readOpenCode(provider: .kimi, excluding: excludedTokens)
    }
    do {
      return try localCredential.requireCurrent(for: .kimi)
    } catch QuotaError.credentialsExpired {
      guard
        let openCodeCredential = try readOpenCode(provider: .kimi, excluding: excludedTokens)
      else {
        throw QuotaError.credentialsExpired(.kimi)
      }
      return openCodeCredential
    }
  }

  private func readOpenCode(
    provider: ProviderID,
    excluding excludedTokens: Set<String>
  ) throws -> ProviderCredential? {
    var expiredCredential: ProviderCredential?
    for path in openCodeAuthPaths where fileManager.fileExists(atPath: path.path) {
      guard let file = try decodeFile(OpenCodeAuthFile.self, at: path, provider: provider) else {
        continue
      }
      for value in file.credentials(for: provider) {
        let credential = try makeCredential(value, source: path.path)
        guard !excludedTokens.contains(credential.accessToken) else { continue }
        do {
          return try credential.requireCurrent(for: provider)
        } catch QuotaError.credentialsExpired {
          expiredCredential = credential
        }
      }
    }
    let labels = OpenCodeAuthFile.labels(for: provider)
    for database in openCodeDatabasePaths where fileManager.fileExists(atPath: database.path) {
      let rows = try readOpenCodeRows(database: database)
      for row in rows where labels.contains(row.label.lowercased()) {
        let value = try decode(
          OpenCodeOAuthCredential.self, from: Data(row.value.utf8), provider: provider)
        let credential = try makeCredential(value.value, source: database.path)
        guard !excludedTokens.contains(credential.accessToken) else { continue }
        do {
          return try credential.requireCurrent(for: provider)
        } catch QuotaError.credentialsExpired {
          expiredCredential = credential
        }
      }
    }
    return expiredCredential
  }

  private func excludedTokens(
    for provider: ProviderID,
    rejecting rejectedCredential: ProviderCredential?
  ) -> Set<String> {
    selectionLock.withLock {
      var rejected = rejectedTokens[provider] ?? []
      if let rejectedCredential {
        rejected.insert(rejectedCredential.accessToken)
        rejectedTokens[provider] = rejected
      }
      return rejected
    }
  }

  private var openCodeAuthPaths: [URL] {
    [
      homeDirectory.appendingPathComponent(".local/share/opencode/auth.json"),
      homeDirectory.appendingPathComponent(".config/opencode/auth.json"),
      homeDirectory.appendingPathComponent("Library/Application Support/opencode/auth.json"),
    ]
  }

  private var openCodeDatabasePaths: [URL] {
    [
      homeDirectory.appendingPathComponent(".local/share/opencode/opencode.db"),
      homeDirectory.appendingPathComponent("Library/Application Support/opencode/opencode.db"),
    ]
  }

  private func decodeFile<Value: Decodable>(
    _ type: Value.Type,
    at url: URL,
    provider: ProviderID
  ) throws -> Value? {
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    let data = try Data(contentsOf: url)
    return try decode(type, from: data, provider: provider)
  }

  private func decode<Value: Decodable>(
    _ type: Value.Type,
    from data: Data,
    provider: ProviderID
  ) throws -> Value {
    do {
      return try JSONDecoder().decode(type, from: data)
    } catch {
      throw QuotaError.malformedResponse(provider)
    }
  }

  private func makeCredential(_ value: TokenValue, source: String) throws -> ProviderCredential {
    try ProviderCredential(
      accessToken: value.accessToken,
      expiresAt: value.expiresAt,
      source: source
    )
  }

  private func readOpenCodeRows(database: URL) throws -> [CredentialRow] {
    var connection: OpaquePointer?
    guard
      sqlite3_open_v2(database.path, &connection, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
      let connection
    else {
      if let connection { sqlite3_close(connection) }
      throw QuotaError.commandFailed("SQLite")
    }
    defer { sqlite3_close(connection) }
    guard sqlite3_busy_timeout(connection, 1_000) == SQLITE_OK else {
      throw QuotaError.commandFailed("SQLite")
    }

    let query = "SELECT label, value FROM credential WHERE active IS NULL OR active != 0;"
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(connection, query, -1, &statement, nil) == SQLITE_OK,
      let statement
    else {
      if let statement { sqlite3_finalize(statement) }
      throw QuotaError.commandFailed("SQLite")
    }
    defer { sqlite3_finalize(statement) }

    var rows: [CredentialRow] = []
    while true {
      switch sqlite3_step(statement) {
      case SQLITE_ROW:
        rows.append(
          CredentialRow(
            label: try sqliteString(statement: statement, column: 0),
            value: try sqliteString(statement: statement, column: 1)
          ))
      case SQLITE_DONE:
        return rows
      default:
        throw QuotaError.commandFailed("SQLite")
      }
    }
  }

  private func sqliteString(statement: OpaquePointer, column: Int32) throws -> String {
    guard let bytes = sqlite3_column_text(statement, column) else {
      throw QuotaError.commandFailed("SQLite")
    }
    let count = Int(sqlite3_column_bytes(statement, column))
    let buffer = UnsafeBufferPointer(start: bytes, count: count)
    guard let value = String(bytes: buffer, encoding: .utf8) else {
      throw QuotaError.commandFailed("SQLite")
    }
    return value
  }
}

public actor CompositeCredentialStore: CredentialStore {
  private let manual: ManualCredentialStore
  private let local: any CredentialStore
  private var rejectedManualTokens: [ProviderID: Set<String>] = [:]

  public init(manual: ManualCredentialStore, local: any CredentialStore) {
    self.manual = manual
    self.local = local
  }

  public func credential(
    for provider: ProviderID,
    rejecting rejectedCredential: ProviderCredential?
  ) async throws -> ProviderCredential {
    // Remember every manual token rejected during the current replacement sequence, not just
    // the one passed to this call — a caller (e.g. GrokProvider/CodexProvider) that restarts a
    // whole fetch across several 401s only ever excludes its most recent credential, so without
    // this history an already-rejected manual token would be handed out again once a later
    // local token is rejected, oscillating between the two forever instead of exhausting.
    //
    // `rejecting: nil` only happens at the start of a fresh top-level fetch (never mid-restart,
    // which always excludes the credential that just failed), so it marks a new replacement
    // sequence and resets the history. Without this, one rejected manual token would suppress
    // the saved override for the app's entire lifetime, surviving a transient failure or even
    // the user removing and re-saving the same credential.
    var rejected = rejectedCredential == nil ? [] : (rejectedManualTokens[provider] ?? [])
    if let rejectedCredential {
      rejected.insert(rejectedCredential.accessToken)
    }
    rejectedManualTokens[provider] = rejected
    if let manualCredential = try await manual.credentialIfPresent(for: provider),
      !rejected.contains(manualCredential.accessToken)
    {
      return manualCredential
    }
    return try await local.credential(for: provider, rejecting: rejectedCredential)
  }
}
