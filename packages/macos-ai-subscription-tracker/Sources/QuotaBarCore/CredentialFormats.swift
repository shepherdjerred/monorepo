import CommonCrypto
import Foundation

struct TokenValue {
  let accessToken: String
  let expiresAt: Date?
}

struct ClaudeCredentialFile: Decodable {
  let claudeAiOauth: ClaudeOAuth?
  let accessToken: String?
  let accessTokenSnake: String?

  enum CodingKeys: String, CodingKey {
    case claudeAiOauth
    case accessToken
    case accessTokenSnake = "access_token"
  }

  /// Ordered candidates when legacy and current representations coexist in one file: each is
  /// tried in turn so an expired `claudeAiOauth` entry cannot mask a fresh top-level token.
  var credentialCandidates: [TokenValue] {
    var candidates: [TokenValue] = []
    if let claudeAiOauth { candidates.append(claudeAiOauth.value) }
    if let token = accessToken ?? accessTokenSnake {
      candidates.append(TokenValue(accessToken: token, expiresAt: nil))
    }
    return candidates
  }
}

struct ClaudeOAuth: Decodable {
  let accessToken: String
  let expiresAt: Double?

  var value: TokenValue {
    TokenValue(accessToken: accessToken, expiresAt: normalizedDate(expiresAt))
  }
}

struct CodexCredentialFile: Decodable {
  let accessToken: String?
  let tokens: CodexTokens?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case tokens
  }

  var credential: TokenValue? {
    guard let token = accessToken ?? tokens?.accessToken else { return nil }
    return TokenValue(accessToken: token, expiresAt: nil)
  }
}

struct CodexTokens: Decodable {
  let accessToken: String

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
  }
}

struct KimiCredentialFile: Decodable {
  let accessToken: String?
  let accessTokenSnake: String?
  let expiresAt: Double?
  let expiresAtSnake: Double?
  let oauth: KimiOAuth?

  enum CodingKeys: String, CodingKey {
    case accessToken
    case accessTokenSnake = "access_token"
    case expiresAt
    case expiresAtSnake = "expires_at"
    case oauth
  }

  /// Ordered candidates when legacy and current representations coexist in one file: each is
  /// tried in turn so an expired `oauth` entry cannot mask a fresh top-level token.
  var credentialCandidates: [TokenValue] {
    var candidates: [TokenValue] = []
    if let oauth { candidates.append(oauth.value) }
    if let token = accessToken ?? accessTokenSnake {
      candidates.append(
        TokenValue(
          accessToken: token,
          expiresAt: normalizedDate(expiresAt ?? expiresAtSnake)
        ))
    }
    return candidates
  }
}

struct KimiOAuth: Decodable {
  let accessToken: String
  let expiresAt: Double?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case expiresAt = "expires_at"
  }

  var value: TokenValue {
    TokenValue(accessToken: accessToken, expiresAt: normalizedDate(expiresAt))
  }
}

struct GrokCLIAuthFile: Decodable {
  let sessions: [String: GrokCLISession]

  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    self.sessions = try container.decode([String: GrokCLISession].self)
  }

  func tokenValues() throws -> [TokenValue] {
    var values: [TokenValue] = []
    for key in sessions.keys.sorted() {
      guard let session = sessions[key], let token = session.token else { continue }
      let expiresAt: Date?
      if let raw = session.expiresAt {
        guard let date = ISO8601.parse(raw) else {
          throw QuotaError.malformedResponse(.grok)
        }
        expiresAt = date
      } else {
        expiresAt = nil
      }
      values.append(TokenValue(accessToken: token, expiresAt: expiresAt))
    }
    return values
  }
}

enum GrokCLICredentialDiscovery {
  static func read(
    grokHome: URL?,
    homeDirectory: URL,
    fileManager: FileManager,
    excluding excludedTokens: Set<String>
  ) throws -> ProviderCredential? {
    let root = grokHome ?? homeDirectory.appendingPathComponent(".grok")
    let path = root.appendingPathComponent("auth.json")
    guard fileManager.fileExists(atPath: path.path) else { return nil }
    let file: GrokCLIAuthFile
    do {
      file = try JSONDecoder().decode(GrokCLIAuthFile.self, from: Data(contentsOf: path))
    } catch let error as QuotaError {
      throw error
    } catch {
      throw QuotaError.malformedResponse(.grok)
    }
    var expiredCredential: ProviderCredential?
    for value in try file.tokenValues() {
      let credential = try ProviderCredential(
        accessToken: value.accessToken,
        expiresAt: value.expiresAt,
        source: path.path
      )
      guard !excludedTokens.contains(credential.accessToken) else { continue }
      do {
        return try credential.requireCurrent(for: .grok)
      } catch QuotaError.credentialsExpired {
        if expiredCredential == nil { expiredCredential = credential }
      }
    }
    return expiredCredential
  }
}

struct GrokCLISession: Decodable {
  let key: String?
  let accessTokenSnake: String?
  let expiresAt: String?

  enum CodingKeys: String, CodingKey {
    case key
    case accessTokenSnake = "access_token"
    case expiresAt = "expires_at"
  }

  var token: String? {
    let raw = (key ?? accessTokenSnake)?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let raw, !raw.isEmpty else { return nil }
    return raw
  }
}

private func normalizedDate(_ value: Double?) -> Date? {
  guard let value else { return nil }
  let seconds = value > 10_000_000_000 ? value / 1_000 : value
  return Date(timeIntervalSince1970: seconds)
}

enum CursorSafeStorageCodec {
  static let prefix = "cursor-safe-storage:v1:"
  private static let salt = "saltysalt"
  private static let iterations: UInt32 = 1003
  private static let iv = [UInt8](repeating: 0x20, count: kCCBlockSizeAES128)

  static func decrypt(
    encryptedToken: String,
    keychain: any KeychainReading
  ) throws -> String {
    guard encryptedToken.hasPrefix(prefix) else {
      return encryptedToken
    }
    let passwordData: Data
    if let data = try keychain.read(service: "Cursor Safe Storage", account: "Cursor Key") {
      passwordData = data
    } else if let data = try keychain.read(service: "Cursor Safe Storage", account: nil) {
      passwordData = data
    } else {
      throw QuotaError.credentialsMissing(.cursor)
    }

    let base64Part = String(encryptedToken.dropFirst(prefix.count))
    guard let rawData = Data(base64Encoded: base64Part) else {
      throw QuotaError.malformedResponse(.cursor)
    }
    let ciphertext = rawData.starts(with: Data("v10".utf8)) ? rawData.dropFirst(3) : rawData

    let derivedKey = try deriveKey(from: passwordData)
    let decryptedData = try crypt(
      operation: CCOperation(kCCDecrypt),
      data: ciphertext,
      key: derivedKey
    )

    guard let decryptedString = String(data: decryptedData, encoding: .utf8) else {
      throw QuotaError.malformedResponse(.cursor)
    }
    let trimmed = decryptedString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw QuotaError.credentialEmpty
    }
    return trimmed
  }

  static func encrypt(
    token: String,
    passwordData: Data
  ) throws -> String {
    let derivedKey = try deriveKey(from: passwordData)
    let encryptedData = try crypt(
      operation: CCOperation(kCCEncrypt),
      data: Data(token.utf8),
      key: derivedKey
    )
    var payload = Data("v10".utf8)
    payload.append(encryptedData)
    return prefix + payload.base64EncodedString()
  }

  private static func deriveKey(from passwordData: Data) throws -> [UInt8] {
    var derivedKey = [UInt8](repeating: 0, count: kCCKeySizeAES128)
    let pbkdfStatus = passwordData.withUnsafeBytes { pwBytes in
      salt.withCString { saltBytes in
        CCKeyDerivationPBKDF(
          CCPBKDFAlgorithm(kCCPBKDF2),
          pwBytes.baseAddress?.assumingMemoryBound(to: Int8.self),
          passwordData.count,
          saltBytes,
          salt.utf8.count,
          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1),
          iterations,
          &derivedKey,
          kCCKeySizeAES128
        )
      }
    }
    guard pbkdfStatus == kCCSuccess else {
      throw QuotaError.commandFailed("CommonCrypto PBKDF")
    }
    return derivedKey
  }

  private static func crypt(
    operation: CCOperation,
    data: Data,
    key: [UInt8]
  ) throws -> Data {
    var outputBytes = [UInt8](repeating: 0, count: data.count + kCCBlockSizeAES128)
    var numBytesProcessed: size_t = 0
    let inputBytes = [UInt8](data)

    let status = CCCrypt(
      operation,
      CCAlgorithm(kCCAlgorithmAES),
      CCOptions(kCCOptionPKCS7Padding),
      key,
      kCCKeySizeAES128,
      iv,
      inputBytes,
      inputBytes.count,
      &outputBytes,
      outputBytes.count,
      &numBytesProcessed
    )
    guard status == kCCSuccess else {
      throw QuotaError.commandFailed("CommonCrypto AES")
    }
    return Data(bytes: outputBytes, count: numBytesProcessed)
  }
}
