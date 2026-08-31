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
  case historyCorrupt
  case historyWriteFailed
  case commandFailed(String)
  case settingsCorrupt

  public var errorDescription: String? {
    switch self {
    case let .credentialsMissing(provider):
      switch provider {
      case .antigravity:
        "No signed-in Antigravity CLI was found. Install and sign in to agy."
      case .cursor:
        "No local Cursor sign-in was found. Sign in through Cursor."
      default:
        "No local credentials found for \(provider.displayName)."
      }
    case let .credentialsExpired(provider):
      if provider == .kimi || provider == .grok {
        "\(provider.displayName) credentials expired. Refresh them through OpenCode."
      } else if provider == .cursor {
        "Cursor credentials expired. Sign in again through Cursor."
      } else {
        "\(provider.displayName) credentials expired. Sign in again with its CLI."
      }
    case .credentialEmpty:
      "Enter a credential before saving."
    case let .keychain(status):
      "Unable to access Brim credentials in Keychain (status \(status))."
    case let .invalidURL(provider):
      "The configured \(provider.displayName) usage URL is invalid."
    case let .unauthorized(provider):
      if provider == .kimi || provider == .grok {
        "\(provider.displayName) rejected the local credential. "
          + "Refresh it through OpenCode or update the Brim override."
      } else if provider == .cursor {
        "Cursor rejected its local session. Sign in again through Cursor."
      } else {
        "\(provider.displayName) rejected the local credential. Sign in again."
      }
    case let .rateLimited(provider):
      "\(provider.displayName) temporarily rate-limited Brim."
    case let .requestTimedOut(provider):
      "\(provider.displayName) did not respond before the timeout."
    case let .network(provider):
      "Brim could not reach \(provider.displayName)."
    case let .malformedResponse(provider):
      "\(provider.displayName) returned malformed quota data."
    case let .unsupportedResponse(provider):
      "\(provider.displayName) changed its unsupported quota response."
    case .cacheCorrupt:
      "The saved Brim cache is corrupt."
    case .cacheWriteFailed:
      "Brim could not save its latest successful usage data."
    case .historyCorrupt:
      "The saved Brim usage history is corrupt."
    case .historyWriteFailed:
      "Brim could not save usage history."
    case let .commandFailed(command):
      "Brim could not read local credentials with \(command)."
    case .settingsCorrupt:
      "Brim settings contain an unsupported provider identifier."
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
