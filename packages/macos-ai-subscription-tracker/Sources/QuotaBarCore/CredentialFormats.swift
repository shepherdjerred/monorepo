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

  var credential: TokenValue? {
    if let claudeAiOauth { return claudeAiOauth.value }
    guard let token = accessToken ?? accessTokenSnake else { return nil }
    return TokenValue(accessToken: token, expiresAt: nil)
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

  var credential: TokenValue? {
    if let oauth { return oauth.value }
    guard let token = accessToken ?? accessTokenSnake else { return nil }
    return TokenValue(
      accessToken: token,
      expiresAt: normalizedDate(expiresAt ?? expiresAtSnake)
    )
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
  let xai: OpenCodeOAuthCredential?
  let grok: OpenCodeOAuthCredential?

  enum CodingKeys: String, CodingKey {
    case kimiForCodingOAuth = "kimi-for-coding-oauth"
    case kimi
    case xai
    case grok
  }

  func credentials(for provider: ProviderID) -> [TokenValue] {
    switch provider {
    case .kimi: [kimiForCodingOAuth, kimi].compactMap { $0?.value }
    case .grok: [xai, grok].compactMap { $0?.value }
    case .claudeCode, .codex: []
    }
  }

  static func labels(for provider: ProviderID) -> Set<String> {
    switch provider {
    case .kimi: ["kimi-for-coding-oauth", "kimi"]
    case .grok: ["xai", "grok"]
    case .claudeCode, .codex: []
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

struct CredentialRow: Decodable {
  let label: String
  let value: String
}

private func normalizedDate(_ value: Double?) -> Date? {
  guard let value else { return nil }
  let seconds = value > 10_000_000_000 ? value / 1_000 : value
  return Date(timeIntervalSince1970: seconds)
}
