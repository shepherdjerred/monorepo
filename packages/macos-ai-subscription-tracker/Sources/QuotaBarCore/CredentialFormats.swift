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

struct OpenCodeAuthFile: Decodable {
  let kimiForCodingOAuth: OpenCodeOAuthCredential?
  let kimi: OpenCodeOAuthCredential?

  enum CodingKeys: String, CodingKey {
    case kimiForCodingOAuth = "kimi-for-coding-oauth"
    case kimi
  }

  func credentials(for provider: ProviderID) -> [TokenValue] {
    switch provider {
    case .kimi: [kimiForCodingOAuth, kimi].compactMap { $0?.value }
    case .claudeCode, .codex, .antigravity, .cursor, .grok: []
    }
  }

  static func labels(for provider: ProviderID) -> Set<String> {
    switch provider {
    case .kimi: ["kimi-for-coding-oauth", "kimi"]
    case .claudeCode, .codex, .antigravity, .cursor, .grok: []
    }
  }
}

struct OpenCodeOAuthCredential: Decodable {
  let access: String
  let expires: Double?

  var value: TokenValue {
    TokenValue(accessToken: access, expiresAt: normalizedDate(expires))
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

struct CredentialRow: Decodable {
  let label: String
  let value: String
}

private func normalizedDate(_ value: Double?) -> Date? {
  guard let value else { return nil }
  let seconds = value > 10_000_000_000 ? value / 1_000 : value
  return Date(timeIntervalSince1970: seconds)
}
