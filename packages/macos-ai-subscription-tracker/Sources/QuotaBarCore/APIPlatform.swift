public import Foundation

public enum APIPlatformID: String, CaseIterable, Codable, Equatable, Identifiable, Sendable {
  case openRouter = "openrouter"
  case openAI = "openai"
  case anthropic

  public var id: String { rawValue }

  public var displayName: String {
    switch self {
    case .openRouter: "OpenRouter"
    case .openAI: "OpenAI"
    case .anthropic: "Anthropic"
    }
  }

  public var credentialAccount: String {
    switch self {
    case .openRouter: "openrouter-management"
    case .openAI: "openai-admin"
    case .anthropic: "anthropic-admin"
    }
  }

  public var credentialLabel: String {
    switch self {
    case .openRouter: "OpenRouter Management API key"
    case .openAI: "OpenAI Admin API key"
    case .anthropic: "Anthropic Admin API key"
    }
  }

  public var credentialHelpURL: URL? {
    switch self {
    case .openRouter: URL(string: "https://openrouter.ai/settings/management-keys")
    case .openAI: URL(string: "https://developers.openai.com/api/docs/guides/admin-apis")
    case .anthropic: URL(string: "https://platform.claude.com/settings/admin-keys")
    }
  }

  public var spendFootnote: String {
    switch self {
    case .openRouter:
      "Monthly spend is OpenRouter API-key usage and includes estimated BYOK spend. "
        + "Projection uses the current local calendar pace."
    case .openAI:
      "Monthly spend is OpenAI organization API cost for the current local calendar month. "
        + "This is not ChatGPT subscription usage."
    case .anthropic:
      "Monthly spend is Anthropic organization API cost for the current local calendar month. "
        + "This is not Claude Pro or Claude Code subscription usage."
    }
  }
}

public struct APIPlatformSnapshot: Codable, Equatable, Sendable {
  public let platform: APIPlatformID
  public let workspaceNames: [String]
  public let creditsRemaining: Decimal?
  public let monthlySpend: Decimal
  public let projectedSpend: Decimal
  public let sourceTimestamp: Date

  public init(
    platform: APIPlatformID,
    workspaceNames: [String],
    creditsRemaining: Decimal?,
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

public enum APIPlatformProjection {
  public static func projectedSpend(
    platform: APIPlatformID,
    monthlySpend: Decimal,
    now: Date,
    timeZone: TimeZone
  ) throws -> Decimal {
    guard monthlySpend >= 0 else { throw APIPlatformError.malformedResponse(platform) }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let elapsedDays = calendar.component(.day, from: now)
    guard let range = calendar.range(of: .day, in: .month, for: now), elapsedDays > 0 else {
      throw APIPlatformError.malformedResponse(platform)
    }
    return monthlySpend / Decimal(elapsedDays) * Decimal(range.count)
  }

  public static func monthStart(platform: APIPlatformID, now: Date, timeZone: TimeZone) throws
    -> Date
  {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    var components = calendar.dateComponents([.year, .month], from: now)
    components.day = 1
    components.hour = 0
    components.minute = 0
    components.second = 0
    guard let start = calendar.date(from: components) else {
      throw APIPlatformError.malformedResponse(platform)
    }
    return start
  }
}

public enum APIPlatformError: Error, Equatable, LocalizedError, Sendable {
  case credentialsMissing(APIPlatformID)
  case credentialEmpty(APIPlatformID)
  case keychain(APIPlatformID, status: Int32)
  case invalidURL(APIPlatformID)
  case unauthorized(APIPlatformID)
  case forbidden(APIPlatformID)
  case rateLimited(APIPlatformID)
  case requestTimedOut(APIPlatformID)
  case network(APIPlatformID)
  case malformedResponse(APIPlatformID)
  case cacheCorrupt
  case cacheWriteFailed

  public var errorDescription: String? {
    switch self {
    case let .credentialsMissing(platform):
      "Add a \(platform.credentialLabel) in Brim Settings."
    case let .credentialEmpty(platform):
      "Enter a \(platform.credentialLabel) before saving."
    case let .keychain(platform, status):
      "Unable to access the \(platform.displayName) credential in Keychain (status \(status))."
    case let .invalidURL(platform):
      "The \(platform.displayName) API URL is invalid."
    case let .unauthorized(platform):
      "\(platform.displayName) rejected the API key. Check the key in Brim Settings."
    case let .forbidden(platform):
      "The \(platform.displayName) key does not have permission to read account usage."
    case let .rateLimited(platform):
      "\(platform.displayName) temporarily rate-limited Brim."
    case let .requestTimedOut(platform):
      "\(platform.displayName) did not respond before the timeout."
    case let .network(platform):
      "Brim could not reach \(platform.displayName)."
    case let .malformedResponse(platform):
      "\(platform.displayName) returned malformed account data."
    case .cacheCorrupt:
      "The saved API platform cache is corrupt."
    case .cacheWriteFailed:
      "Brim could not save the latest API platform data."
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

  public var platform: APIPlatformID? {
    switch self {
    case let .credentialsMissing(platform),
      let .credentialEmpty(platform),
      let .keychain(platform, _),
      let .invalidURL(platform),
      let .unauthorized(platform),
      let .forbidden(platform),
      let .rateLimited(platform),
      let .requestTimedOut(platform),
      let .network(platform),
      let .malformedResponse(platform):
      platform
    case .cacheCorrupt, .cacheWriteFailed:
      nil
    }
  }
}
