public import Foundation

public enum APIPlatformID: String, Codable, Equatable, Sendable {
  case openRouter = "openrouter"

  public var displayName: String { "OpenRouter" }
}

public struct APIPlatformSnapshot: Codable, Equatable, Sendable {
  public let platform: APIPlatformID
  public let workspaceNames: [String]
  public let creditsRemaining: Decimal
  public let monthlySpend: Decimal
  public let projectedSpend: Decimal
  public let sourceTimestamp: Date

  public init(
    platform: APIPlatformID = .openRouter,
    workspaceNames: [String],
    creditsRemaining: Decimal,
    monthlySpend: Decimal,
    projectedSpend: Decimal,
    sourceTimestamp: Date
  ) {
    self.platform = platform
    self.workspaceNames = workspaceNames
    self.creditsRemaining = creditsRemaining
    self.monthlySpend = monthlySpend
    self.projectedSpend = projectedSpend
    self.sourceTimestamp = sourceTimestamp
  }
}

public enum APIPlatformDisplayState: Equatable, Sendable {
  case loading
  case available(APIPlatformSnapshot)
  case stale(APIPlatformSnapshot, reason: String)
  case unavailable(message: String)
  case unauthenticated(message: String)
}

public enum APIPlatformError: Error, Equatable, LocalizedError, Sendable {
  case credentialsMissing
  case credentialEmpty
  case keychain(status: Int32)
  case invalidURL
  case unauthorized
  case forbidden
  case rateLimited
  case requestTimedOut
  case network
  case malformedResponse
  case cacheCorrupt
  case cacheWriteFailed

  public var errorDescription: String? {
    switch self {
    case .credentialsMissing:
      "Add an OpenRouter Management API key in Brim Settings."
    case .credentialEmpty:
      "Enter an OpenRouter Management API key before saving."
    case let .keychain(status):
      "Unable to access the OpenRouter credential in Keychain (status \(status))."
    case .invalidURL:
      "The OpenRouter API URL is invalid."
    case .unauthorized:
      "OpenRouter rejected the Management API key. Check the key in Brim Settings."
    case .forbidden:
      "The OpenRouter key does not have permission to read account usage."
    case .rateLimited:
      "OpenRouter temporarily rate-limited Brim."
    case .requestTimedOut:
      "OpenRouter did not respond before the timeout."
    case .network:
      "Brim could not reach OpenRouter."
    case .malformedResponse:
      "OpenRouter returned malformed account data."
    case .cacheCorrupt:
      "The saved OpenRouter cache is corrupt."
    case .cacheWriteFailed:
      "Brim could not save the latest OpenRouter data."
    }
  }

  public var isAuthenticationError: Bool {
    switch self {
    case .credentialsMissing, .unauthorized, .forbidden:
      true
    default:
      false
    }
  }
}
