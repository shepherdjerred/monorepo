public import Foundation

public struct MuseProvider: UsageProvider {
  public let id = ProviderID.muse
  private let client: ProviderHTTPClient
  private let endpoint: URL

  /// The CLI's startup and `/usage`-panel subscription call. The OAuth token is only ever
  /// sent here, so this URL is fixed and never comes from configuration. Contract documented
  /// by herdr-agent-quota's Muse collector (MIT): the call is idempotent for a signed-in
  /// account, returning the stored key rather than rotating it.
  public static var subscriptionURL: URL {
    guard let url = URL(string: "https://api.meta.ai/muse-code/key") else {
      preconditionFailure("Muse subscription URL is invalid.")
    }
    return url
  }

  public init(client: ProviderHTTPClient, endpoint: URL) {
    self.client = client
    self.endpoint = endpoint
  }

  public func fetch() async throws -> UsageSnapshot {
    let data = try await client.post(
      provider: id,
      url: endpoint,
      body: Data("{}".utf8),
      headers: [
        "x-api-version": "1.0.0",
        "Content-Type": "application/json",
      ]
    )
    return try Self.parse(data: data)
  }

  public static func parse(data: Data, now: Date = .now) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(
      MuseSubscriptionResponse.self, from: data, provider: .muse)
    if response.isSubsActive == false {
      throw QuotaError.unsupportedResponse(.muse)
    }
    guard let usage = response.subsUsage else {
      throw QuotaError.unsupportedResponse(.muse)
    }
    var notes = [
      "Uses the signed-in Muse OAuth credential read-only; only quota data is kept."
    ]
    var windows: [UsageWindow] = []
    if let window = try rollingWindow(usage.window, notes: &notes, now: now) {
      windows.append(window)
    }
    if let window = try fixedWindow(
      usage.weekly, id: "muse-weekly", label: "Weekly", kind: .weekly, notes: &notes, now: now
    ) {
      windows.append(window)
    }
    guard !windows.isEmpty else { throw QuotaError.unsupportedResponse(.muse) }
    return UsageSnapshot(
      provider: .muse,
      accountLabel: accountLabel(response: response, usage: usage),
      windows: windows.sorted { $0.label < $1.label },
      notes: notes,
      sourceTimestamp: now
    )
  }

  /// A window without a usable percentage is dropped rather than failing the snapshot; a
  /// provider that stops reporting a pool degrades to the pools it still reports.
  private static func rollingWindow(
    _ window: MuseQuotaWindow?,
    notes: inout [String],
    now: Date
  ) throws -> UsageWindow? {
    guard let window, let used = validatedPercentage(window.usedPercent) else { return nil }
    guard let minutes = window.windowDurationMinutes, minutes > 0 else { return nil }
    let clamped = clampOverQuota(used, notes: &notes)
    return try UsageWindow.validated(
      id: "muse-window",
      label: minutes == 300 ? "5-hour" : durationLabel(minutes: minutes),
      kind: .rolling(durationSeconds: minutes * 60),
      usedPercent: clamped,
      resetAt: resetDate(window.resetsAt),
      sourceTimestamp: now
    )
  }

  private static func fixedWindow(
    _ window: MuseQuotaWindow?,
    id: String,
    label: String,
    kind: WindowKind,
    notes: inout [String],
    now: Date
  ) throws -> UsageWindow? {
    guard let window, let used = validatedPercentage(window.usedPercent) else { return nil }
    let clamped = clampOverQuota(used, notes: &notes)
    return try UsageWindow.validated(
      id: id,
      label: label,
      kind: kind,
      usedPercent: clamped,
      resetAt: resetDate(window.resetsAt),
      sourceTimestamp: now
    )
  }

  private static func validatedPercentage(_ value: Double?) -> Double? {
    guard let value, value.isFinite, value >= 0 else { return nil }
    return value
  }

  /// The provider reports over-quota percentages above 100 verbatim; Brim windows cap at 100
  /// and say so instead of failing the whole snapshot.
  private static func clampOverQuota(_ value: Double, notes: inout [String]) -> Double {
    guard value > 100 else { return value }
    notes.append("Muse reports over-quota usage; shown as fully used.")
    return 100
  }

  private static func resetDate(_ value: MuseReset?) -> Date? {
    switch value {
    case .seconds(let seconds):
      guard seconds > 0 else { return nil }
      return Date(timeIntervalSince1970: Double(seconds))
    case .iso8601(let string):
      return ISO8601.parse(string)
    case nil:
      return nil
    }
  }

  private static func durationLabel(minutes: Int) -> String {
    if minutes.isMultiple(of: 1_440) { return "\(minutes / 1_440)d" }
    if minutes.isMultiple(of: 60) { return "\(minutes / 60)h" }
    return "\(minutes)m"
  }

  private static func accountLabel(
    response: MuseSubscriptionResponse,
    usage: MuseSubsUsage
  ) -> String? {
    if let name = response.subsTierName?.trimmingCharacters(in: .whitespacesAndNewlines),
      !name.isEmpty
    {
      return name
    }
    if let tier = usage.tier?.trimmingCharacters(in: .whitespacesAndNewlines), !tier.isEmpty {
      return tier
    }
    return nil
  }

  /// Redirects are refused: the OAuth token is only ever for the fixed subscription host,
  /// so a redirect is an error, not a new target.
  public static func noRedirectTransport() -> URLSessionTransport {
    URLSessionTransport(
      session: URLSession(
        configuration: .ephemeral,
        delegate: MuseRedirectRefusal(),
        delegateQueue: nil
      ))
  }
}

private final class MuseRedirectRefusal: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest
  ) async -> URLRequest? {
    nil
  }
}

private struct MuseSubscriptionResponse: Decodable {
  let isSubsActive: Bool?
  let subsTierName: String?
  let subsUsage: MuseSubsUsage?

  enum CodingKeys: String, CodingKey {
    case isSubsActive = "is_subs_active"
    case subsTierName = "subs_tier_name"
    case subsUsage = "subs_usage"
  }
}

private struct MuseSubsUsage: Decodable {
  let tier: String?
  let window: MuseQuotaWindow?
  let weekly: MuseQuotaWindow?
}

private struct MuseQuotaWindow: Decodable {
  let usedPercent: Double?
  let windowDurationMinutes: Int?
  let resetsAt: MuseReset?

  enum CodingKeys: String, CodingKey {
    case usedPercent = "used_percent"
    case windowDurationMinutes = "window_duration_mins"
    case resetsAt = "resets_at"
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    // Each field degrades to nil independently: a malformed pool drops that window instead of
    // failing the snapshot, matching the provider's fail-closed-per-window contract.
    do {
      self.usedPercent = try container.decodeIfPresent(Double.self, forKey: .usedPercent)
    } catch {
      self.usedPercent = nil
    }
    do {
      self.windowDurationMinutes = try container.decodeIfPresent(
        Int.self, forKey: .windowDurationMinutes)
    } catch {
      self.windowDurationMinutes = nil
    }
    let decodedSeconds: Int64?
    do {
      decodedSeconds = try container.decodeIfPresent(Int64.self, forKey: .resetsAt)
    } catch {
      decodedSeconds = nil
    }
    let decodedString: String?
    do {
      decodedString = try container.decodeIfPresent(String.self, forKey: .resetsAt)
    } catch {
      decodedString = nil
    }
    if let decodedSeconds {
      self.resetsAt = .seconds(decodedSeconds)
    } else if let decodedString {
      self.resetsAt = .iso8601(decodedString)
    } else {
      self.resetsAt = nil
    }
  }
}

private enum MuseReset: Sendable {
  case seconds(Int64)
  case iso8601(String)
}
