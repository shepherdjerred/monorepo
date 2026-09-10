public import Foundation
import SQLite3
import Security

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
  private let grokHome: URL?
  private let cursorStateDatabase: URL?
  private let claudeKeychain: any KeychainReading
  private let selectionLock = NSLock()
  private var rejectedTokens: [ProviderID: Set<String>] = [:]

  public init(
    fileManager: FileManager = .default,
    homeDirectory: URL? = nil,
    kimiCodeHome: URL? = nil,
    grokHome: URL? = nil,
    cursorStateDatabase: URL? = nil,
    claudeKeychain: any KeychainReading = SecurityToolKeychainClient()
  ) {
    self.fileManager = fileManager
    self.homeDirectory = homeDirectory ?? fileManager.homeDirectoryForCurrentUser
    self.kimiCodeHome = Self.configuredHome(kimiCodeHome, environmentKey: "KIMI_CODE_HOME")
    self.grokHome = Self.configuredHome(grokHome, environmentKey: "GROK_HOME")
    self.cursorStateDatabase = cursorStateDatabase
    self.claudeKeychain = claudeKeychain
  }

  private static func configuredHome(_ explicit: URL?, environmentKey: String) -> URL? {
    if let explicit { return explicit }
    guard let configured = ProcessInfo.processInfo.environment[environmentKey], !configured.isEmpty
    else { return nil }
    return URL(fileURLWithPath: configured, isDirectory: true)
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
    case .antigravity: credential = nil
    case .cursor: credential = try readCursor(excluding: excludedTokens)
    case .kimi: credential = try readCurrentKimiCredential(excluding: excludedTokens)
    case .grok:
      credential = try GrokCLICredentialDiscovery.read(
        grokHome: grokHome,
        homeDirectory: homeDirectory,
        fileManager: fileManager,
        excluding: excludedTokens
      )
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
      includingPropertiesForKeys: [.isRegularFileKey]
    )
    // Only exclude entries that are structurally never credential files (hidden dotfiles like
    // .DS_Store, the "mcp" subdirectory, non-regular files). A file that passes this filter is
    // expected to be a real credential file, so a decode failure below must propagate rather
    // than be swallowed here - masking genuine corruption as "not a credential file" can leave
    // Brim reporting missing credentials, or worse, authenticating as the wrong account.
    .filter { url in
      guard !url.lastPathComponent.hasPrefix("."), url.lastPathComponent != "mcp" else {
        return false
      }
      let isRegularFile = try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile
      return isRegularFile == true
    }
    .sorted { $0.path < $1.path }
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
      // `rejecting: nil` only happens at the start of a fresh top-level fetch (never
      // mid-restart, which always excludes the credential that just failed) - reset the
      // history there so a token rejected in an earlier replacement sequence doesn't stay
      // permanently excluded for the app's whole lifetime. Mirrors
      // CompositeCredentialStore.rejectedManualTokens for the same reason.
      var rejected = rejectedCredential == nil ? [] : (rejectedTokens[provider] ?? [])
      if let rejectedCredential {
        rejected.insert(rejectedCredential.accessToken)
      }
      rejectedTokens[provider] = rejected
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

  private var resolvedCursorStateDatabase: URL {
    cursorStateDatabase
      ?? homeDirectory.appendingPathComponent(
        "Library/Application Support/Cursor/User/globalStorage/state.vscdb")
  }

  private func readCursor(excluding excludedTokens: Set<String>) throws -> ProviderCredential? {
    let database = resolvedCursorStateDatabase
    guard fileManager.fileExists(atPath: database.path) else { return nil }
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
    let query = "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';"
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(connection, query, -1, &statement, nil) == SQLITE_OK,
      let statement
    else {
      if let statement { sqlite3_finalize(statement) }
      throw QuotaError.commandFailed("SQLite")
    }
    defer { sqlite3_finalize(statement) }
    switch sqlite3_step(statement) {
    case SQLITE_ROW:
      let token = try sqliteString(statement: statement, column: 0)
      guard sqlite3_step(statement) == SQLITE_DONE else {
        throw QuotaError.commandFailed("SQLite")
      }
      let credential = try ProviderCredential(accessToken: token, source: database.path)
      return excludedTokens.contains(credential.accessToken) ? nil : credential
    case SQLITE_DONE:
      return nil
    default:
      throw QuotaError.commandFailed("SQLite")
    }
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
