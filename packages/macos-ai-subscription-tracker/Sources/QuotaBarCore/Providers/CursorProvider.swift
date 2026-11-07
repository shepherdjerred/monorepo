public import Foundation

public struct CursorProvider: UsageProvider {
  public let id = ProviderID.cursor
  private let client: ProviderHTTPClient
  private let endpoint: URL
  private let planEndpoint: URL

  public init(client: ProviderHTTPClient, endpoint: URL, planEndpoint: URL) {
    self.client = client
    self.endpoint = endpoint
    self.planEndpoint = planEndpoint
  }

  private static let headers = [
    "Content-Type": "application/json",
    "Connect-Protocol-Version": "1",
  ]

  public func fetch() async throws -> UsageSnapshot {
    let credential = try await client.resolveCredential(for: id)
    return try await fetch(usingCredential: credential)
  }

  /// Usage and plan use one credential. Only a usage 401 restarts the fetch: the plan is
  /// supplementary, so its failures (401 included) leave it unset with a note.
  private func fetch(usingCredential credential: ProviderCredential) async throws -> UsageSnapshot {
    async let planResult = capturePlanSurface {
      try await client.post(
        provider: id, url: planEndpoint, body: Data("{}".utf8), credential: credential,
        headers: Self.headers)
    }
    let usageData: Data
    do {
      usageData = try await client.post(
        provider: id, url: endpoint, body: Data("{}".utf8), credential: credential,
        headers: Self.headers)
    } catch QuotaError.unauthorized {
      _ = await planResult
      return try await restartFetch(excluding: credential)
    }
    let usage = try Self.parse(data: usageData)
    return PlanOutcome(await planResult, parse: Self.parsePlan).applied(to: usage)
  }

  private func restartFetch(excluding credential: ProviderCredential) async throws -> UsageSnapshot
  {
    do {
      let replacement = try await client.resolveCredential(for: id, excluding: credential)
      return try await fetch(usingCredential: replacement)
    } catch QuotaError.credentialsMissing {
      throw QuotaError.unauthorized(id)
    }
  }

  /// `GetPlanInfo`: `planInfo.planName` ("Pro") and `planInfo.price` ("$20/mo"). A price in
  /// any other form is left unset rather than guessed.
  public static func parsePlan(data: Data) throws -> PlanInfo? {
    let response = try JSONDecoder().decode(CursorPlanResponse.self, from: data)
    return PlanInfo(
      name: response.planInfo.planName,
      monthlyCostUSD: response.planInfo.price.flatMap(monthlyDollars)
    )
  }

  private static func monthlyDollars(_ price: String) -> Int? {
    guard let match = price.wholeMatch(of: /\$([0-9]{1,5})\/mo/) else { return nil }
    return Int(match.1)
  }

  public static func parse(data: Data, now: Date = .now) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(
      CursorUsageResponse.self, from: data, provider: .cursor)
    guard response.enabled else { throw QuotaError.unsupportedResponse(.cursor) }
    guard let resetMilliseconds = Double(response.billingCycleEnd),
      resetMilliseconds.isFinite, resetMilliseconds > 0
    else {
      throw QuotaValidationError.invalidDate
    }
    let resetSeconds = resetMilliseconds / 1_000
    guard abs(resetSeconds) < 1e13 else { throw QuotaValidationError.invalidDate }
    let resetAt = Date(timeIntervalSince1970: resetSeconds)
    let cursorModels = try ProviderDecoder.percentage(response.planUsage.autoPercentUsed)
    let otherModels = try ProviderDecoder.percentage(response.planUsage.apiPercentUsed)
    guard let cursorModels, let otherModels else {
      throw QuotaError.unsupportedResponse(.cursor)
    }
    let windows = [
      try UsageWindow.validated(
        id: "cursor-models",
        label: "Cursor Models",
        kind: .monthly,
        usedPercent: cursorModels,
        resetAt: resetAt,
        sourceTimestamp: now
      ),
      try UsageWindow.validated(
        id: "cursor-other-models",
        label: "Other Models",
        kind: .monthly,
        usedPercent: otherModels,
        resetAt: resetAt,
        sourceTimestamp: now
      ),
    ]
    return UsageSnapshot(
      provider: .cursor,
      windows: windows,
      notes: [
        "Uses Cursor's local sign-in and an unsupported private client contract that may change."
      ],
      sourceTimestamp: now
    )
  }
}

private struct CursorPlanResponse: Decodable {
  struct Plan: Decodable {
    let planName: String?
    let price: String?
  }
  let planInfo: Plan
}

private struct CursorUsageResponse: Decodable {
  let enabled: Bool
  let billingCycleEnd: String
  let planUsage: CursorPlanUsage
}

private struct CursorPlanUsage: Decodable {
  let autoPercentUsed: Double?
  let apiPercentUsed: Double?
}
