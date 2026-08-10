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
    let credential = try await client.resolveCredential(for: id)
    return try await fetch(usingCredential: credential)
  }

  /// Pins the usage and reset requests to one credential so a 401 on either surface cannot leave
  /// the published snapshot combining one credential's quota windows with another credential's
  /// banked resets; a 401 on either surface restarts the complete fetch with a replacement
  /// credential instead of letting each surface reload independently.
  private func fetch(usingCredential credential: ProviderCredential) async throws -> UsageSnapshot {
    async let resetOutcome = captureAuthAwareSurface {
      try await client.get(provider: id, url: resetEndpoint, credential: credential)
    }
    let usageData: Data
    do {
      usageData = try await client.get(provider: id, url: usageEndpoint, credential: credential)
    } catch QuotaError.unauthorized {
      _ = await resetOutcome
      return try await restartFetch(excluding: credential)
    }
    let resolvedResets = await resetOutcome
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
    case .unauthorized:
      return try await restartFetch(excluding: credential)
    }
  }

  private func restartFetch(excluding credential: ProviderCredential) async throws -> UsageSnapshot
  {
    let replacement = try await client.resolveCredential(for: id, excluding: credential)
    return try await fetch(usingCredential: replacement)
  }

  public static func parse(
    data: Data,
    resets: [Reset] = [],
    resetErrorMessage: String? = nil,
    now: Date = .now
  ) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(CodexUsageResponse.self, from: data, provider: .codex)
    guard !response.windows.isEmpty else { throw QuotaError.unsupportedResponse(.codex) }
    var windows: [UsageWindow] = []
    var windowIDs: Set<String> = []
    for (key, payload) in response.windows.sorted(by: { $0.key < $1.key }) {
      let metadata = classify(key: key, durationSeconds: payload.durationSeconds)
      let id = "codex-\(slug(key))"
      guard windowIDs.insert(id).inserted else { throw QuotaValidationError.emptyIdentifier }
      windows.append(
        try UsageWindow.validated(
          id: id,
          label: metadata.label,
          kind: metadata.kind,
          usedPercent: payload.usedPercent,
          resetAt: payload.resetAt,
          sourceTimestamp: now
        )
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
    let durationSeconds = try container.decodeIfPresent(Int.self, forKey: .durationSeconds)
    let alternateDurationSeconds = try container.decodeIfPresent(
      Int.self,
      forKey: .alternateDurationSeconds
    )
    if let durationSeconds, let alternateDurationSeconds,
      durationSeconds != alternateDurationSeconds
    {
      throw QuotaValidationError.invalidDuration
    }
    let duration = durationSeconds ?? alternateDurationSeconds
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
