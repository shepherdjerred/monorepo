import Foundation

public struct GrokIdentity: Decodable, Equatable, Sendable {
  public let userID: String
  public let email: String?

  public var accountLabel: String? { email }

  enum CodingKeys: String, CodingKey {
    case userID = "userId"
    case email
  }
}

extension GrokProvider {
  /// `/v1/settings` names the plan for display: `subscription_tier_display` ("SuperGrok").
  static func parsePlan(data: Data) throws -> PlanInfo? {
    PlanInfo(name: try JSONDecoder().decode(GrokSettings.self, from: data).tier)
  }
}

private struct GrokSettings: Decodable {
  let tier: String?
  enum CodingKeys: String, CodingKey { case tier = "subscription_tier_display" }
}
