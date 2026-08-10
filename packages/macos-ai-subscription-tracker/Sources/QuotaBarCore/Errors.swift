public import Foundation

public enum QuotaError: Error, Equatable, LocalizedError, Sendable {
  case credentialsMissing(ProviderID)
  case credentialsExpired(ProviderID)
  case credentialEmpty
  case keychain(status: Int32)
  case invalidURL(ProviderID)
  case unauthorized(ProviderID)
  case rateLimited(ProviderID)
  case requestTimedOut(ProviderID)
  case network(ProviderID)
  case malformedResponse(ProviderID)
  case unsupportedResponse(ProviderID)
  case cacheCorrupt
  case cacheWriteFailed
  case commandFailed(String)
  case settingsCorrupt

  public var errorDescription: String? {
    switch self {
    case let .credentialsMissing(provider):
      "No local credentials found for \(provider.displayName)."
    case let .credentialsExpired(provider):
      if provider == .kimi || provider == .grok {
        "\(provider.displayName) credentials expired. Refresh them through OpenCode."
      } else {
        "\(provider.displayName) credentials expired. Sign in again with its CLI."
      }
    case .credentialEmpty:
      "Enter a credential before saving."
    case let .keychain(status):
      "Unable to access QuotaBar credentials in Keychain (status \(status))."
    case let .invalidURL(provider):
      "The configured \(provider.displayName) usage URL is invalid."
    case let .unauthorized(provider):
      if provider == .kimi || provider == .grok {
        "\(provider.displayName) rejected the local credential. "
          + "Refresh it through OpenCode or update the QuotaBar override."
      } else {
        "\(provider.displayName) rejected the local credential. Sign in again."
      }
    case let .rateLimited(provider):
      "\(provider.displayName) temporarily rate-limited QuotaBar."
    case let .requestTimedOut(provider):
      "\(provider.displayName) did not respond before the timeout."
    case let .network(provider):
      "QuotaBar could not reach \(provider.displayName)."
    case let .malformedResponse(provider):
      "\(provider.displayName) returned malformed quota data."
    case let .unsupportedResponse(provider):
      "\(provider.displayName) changed its unsupported quota response."
    case .cacheCorrupt:
      "The saved QuotaBar cache is corrupt."
    case .cacheWriteFailed:
      "QuotaBar could not save its latest successful usage data."
    case let .commandFailed(command):
      "QuotaBar could not read local credentials with \(command)."
    case .settingsCorrupt:
      "QuotaBar settings contain an unsupported provider identifier."
    }
  }

  public var isAuthenticationError: Bool {
    switch self {
    case .credentialsMissing, .credentialsExpired, .unauthorized: true
    default: false
    }
  }
}

public protocol UsageProvider: Sendable {
  var id: ProviderID { get }
  func fetch() async throws -> UsageSnapshot
}
