public import Foundation

public struct CursorProvider: UsageProvider {
  public let id = ProviderID.cursor
  private let client: ProviderHTTPClient
  private let endpoint: URL

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
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      ]
    )
    return try Self.parse(data: data)
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

private struct CursorUsageResponse: Decodable {
  let enabled: Bool
  let billingCycleEnd: String
  let planUsage: CursorPlanUsage
}

private struct CursorPlanUsage: Decodable {
  let autoPercentUsed: Double?
  let apiPercentUsed: Double?
}
