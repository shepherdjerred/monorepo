public import Foundation

public struct ProviderEndpoints: Sendable {
  public let claudeUsage: URL
  public let codexUsage: URL
  public let codexResets: URL
  public let kimiUsage: URL
  public let grokUser: URL
  public let grokBilling: URL
  public let grokCredits: URL

  public init(
    claudeUsage: URL,
    codexUsage: URL,
    codexResets: URL,
    kimiUsage: URL,
    grokUser: URL,
    grokBilling: URL,
    grokCredits: URL
  ) {
    self.claudeUsage = claudeUsage
    self.codexUsage = codexUsage
    self.codexResets = codexResets
    self.kimiUsage = kimiUsage
    self.grokUser = grokUser
    self.grokBilling = grokBilling
    self.grokCredits = grokCredits
  }

  public static func live() throws -> ProviderEndpoints {
    try live(environment: ProcessInfo.processInfo.environment)
  }

  public static func live(environment: [String: String]) throws -> ProviderEndpoints {
    func url(_ value: String, provider: ProviderID) throws -> URL {
      // `URL(string:)` happily parses a schemeless, relative value like
      // "api.kimi.com/coding/v1/usages" - reject anything that isn't an absolute URL with a
      // host so a misconfigured override surfaces as invalidURL at setup time instead of an
      // ordinary network failure once request-building silently resolves it against no base URL.
      guard let url = URL(string: value),
        let scheme = url.scheme?.lowercased(),
        let host = url.host, !host.isEmpty
      else {
        throw QuotaError.invalidURL(provider)
      }
      // Every request carries the user's OAuth bearer token, so the transport must be
      // encrypted - App Transport Security doesn't universally protect arbitrary local/IP-
      // address endpoints. Only an explicit loopback host may use plain HTTP, for local testing.
      let isLoopbackHost = host == "127.0.0.1" || host.lowercased() == "localhost"
      guard scheme == "https" || (scheme == "http" && isLoopbackHost) else {
        throw QuotaError.invalidURL(provider)
      }
      return url
    }
    return try ProviderEndpoints(
      claudeUsage: url("https://api.anthropic.com/api/oauth/usage", provider: .claudeCode),
      codexUsage: url("https://chatgpt.com/backend-api/wham/usage", provider: .codex),
      codexResets: url(
        "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
        provider: .codex
      ),
      kimiUsage: url(
        environment["QUOTABAR_KIMI_USAGE_URL"] ?? "https://api.kimi.com/coding/v1/usages",
        provider: .kimi
      ),
      grokUser: url("https://cli-chat-proxy.grok.com/v1/user", provider: .grok),
      grokBilling: url("https://cli-chat-proxy.grok.com/v1/billing", provider: .grok),
      grokCredits: url(
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
        provider: .grok
      )
    )
  }
}
