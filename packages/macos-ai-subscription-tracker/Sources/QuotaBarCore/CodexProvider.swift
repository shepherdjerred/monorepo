public import Foundation

public struct CodexProvider: UsageProvider {
  public let id = ProviderID.codex
  private let client: ProviderHTTPClient
  private let usageEndpoint: URL
  private let resetEndpoint: URL

  public init(client: ProviderHTTPClient, usageEndpoint: URL, resetEndpoint: URL) {
    self.client = client
    self.usageEndpoint = usageEndpoint
    self.resetEndpoint = resetEndpoint
  }

  public func fetch() async throws -> UsageSnapshot {
    async let resetResult = captureSurface {
      try await client.get(provider: id, url: resetEndpoint)
    }
    let usageData = try await client.get(provider: id, url: usageEndpoint)
    let resolvedResets = await resetResult
    switch resolvedResets {
    case let .success(data):
      do {
        return try Self.parse(data: usageData, resets: Self.parseResets(data: data))
      } catch let error as QuotaError {
        return try Self.parse(data: usageData, resetErrorMessage: error.localizedDescription)
      } catch {
        return try Self.parse(
          data: usageData,
          resetErrorMessage: "Codex reset data changed unexpectedly."
        )
      }
    case let .failure(message):
      return try Self.parse(data: usageData, resetErrorMessage: message)
    }
  }

  public static func parse(
    data: Data,
    resets: [Reset] = [],
    resetErrorMessage: String? = nil,
    now: Date = .now
  ) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(CodexUsageResponse.self, from: data, provider: .codex)
    guard !response.windows.isEmpty else { throw QuotaError.unsupportedResponse(.codex) }
    let windows = try response.windows.sorted(by: { $0.key < $1.key }).map { key, payload in
      let metadata = classify(key: key, durationSeconds: payload.durationSeconds)
      return try UsageWindow.validated(
        id: "codex-\(slug(key))",
        label: metadata.label,
        kind: metadata.kind,
        usedPercent: payload.usedPercent,
        resetAt: payload.resetAt,
        sourceTimestamp: now
      )
    }
    return UsageSnapshot(
      provider: .codex,
      windows: windows,
      resets: resets.filter { $0.exp > now }.sorted { $0.exp < $1.exp },
      resetErrorMessage: resetErrorMessage,
      notes: ["Quota windows are labeled from provider duration metadata."],
      sourceTimestamp: now
    )
  }

  public static func parseResets(data: Data, now: Date = .now) throws -> [Reset] {
    let response = try ProviderDecoder.decode(CodexResetResponse.self, from: data, provider: .codex)
    return response.credits.compactMap { credit in
      guard credit.status == .available, credit.expiresAt > now else { return nil }
      return Reset(exp: credit.expiresAt)
    }.sorted { $0.exp < $1.exp }
  }

  private static func classify(key: String, durationSeconds: Int?) -> WindowDescriptor {
    guard let durationSeconds else {
      return WindowDescriptor(label: "\(title(key))", kind: .providerDefined)
    }
    switch durationSeconds {
    case 18_000:
      return WindowDescriptor(label: "5-hour", kind: .rolling(durationSeconds: durationSeconds))
    case 604_800:
      return WindowDescriptor(label: "Weekly", kind: .weekly)
    case 2_419_200...2_678_400:
      return WindowDescriptor(label: "Monthly", kind: .monthly)
    default:
      let hours = Double(durationSeconds) / 3_600
      let label =
        hours.rounded() == hours
        ? "\(Int(hours))-hour"
        : "Provider window · \(durationSeconds)s"
      return WindowDescriptor(label: label, kind: .rolling(durationSeconds: durationSeconds))
    }
  }
}

private struct WindowDescriptor {
  let label: String
  let kind: WindowKind
}

private struct CodexUsageResponse: Decodable {
  let windows: [String: CodexWindow]

  enum CodingKeys: String, CodingKey {
    case rateLimit = "rate_limit"
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.windows = try container.decode(CodexRateLimit.self, forKey: .rateLimit).windows
  }
}

private struct CodexRateLimit: Decodable {
  let windows: [String: CodexWindow]

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    var windows: [String: CodexWindow] = [:]
    for key in container.allKeys where key.stringValue.hasSuffix("_window") {
      if let window = try container.decodeIfPresent(CodexWindow.self, forKey: key) {
        windows[key.stringValue] = window
      }
    }
    self.windows = windows
  }
}

private struct CodexWindow: Decodable {
  let usedPercent: Double?
  let resetAt: Date?
  let durationSeconds: Int?

  enum CodingKeys: String, CodingKey {
    case usedPercent = "used_percent"
    case resetAt = "reset_at"
    case durationSeconds = "limit_window_seconds"
    case alternateDurationSeconds = "window_seconds"
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.usedPercent = try ProviderDecoder.percentage(
      ProviderDecoder.number(in: container, forKey: .usedPercent)
    )
    self.resetAt = try ProviderDecoder.date(in: container, forKey: .resetAt)
    let duration =
      try container.decodeIfPresent(Int.self, forKey: .durationSeconds)
      ?? container.decodeIfPresent(Int.self, forKey: .alternateDurationSeconds)
    if let duration, duration <= 0 { throw QuotaValidationError.invalidDuration }
    self.durationSeconds = duration
    guard usedPercent != nil || resetAt != nil else {
      throw QuotaError.unsupportedResponse(.codex)
    }
  }
}

private struct CodexResetResponse: Decodable {
  let credits: [CodexResetCredit]
}

private struct CodexResetCredit: Decodable {
  let status: CodexResetStatus
  let expiresAt: Date

  enum CodingKeys: String, CodingKey {
    case status
    case expiresAt = "expires_at"
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.status = try container.decode(CodexResetStatus.self, forKey: .status)
    guard let expiresAt = try ProviderDecoder.date(in: container, forKey: .expiresAt) else {
      throw QuotaValidationError.invalidDate
    }
    self.expiresAt = expiresAt
  }
}

private enum CodexResetStatus: String, Decodable {
  case available
  case used
  case expired
}
