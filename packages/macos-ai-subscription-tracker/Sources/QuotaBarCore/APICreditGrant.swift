public import Foundation

public struct APICreditGrant: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case purchased
    case granted
    case unspecified

    public var rowLabel: String {
      switch self {
      case .purchased: "Purchased"
      case .granted: "Granted"
      case .unspecified: "Credit"
      }
    }

    public static let displayOrder: [Kind] = [.purchased, .granted, .unspecified]
  }

  public let kind: Kind
  public let remainingUSD: Decimal
  public let expiresAt: Date?

  public init(kind: Kind, remainingUSD: Decimal, expiresAt: Date?) {
    self.kind = kind
    self.remainingUSD = remainingUSD
    self.expiresAt = expiresAt
  }

  public func helpLine() -> String {
    let amount = remainingUSD.formatted(Self.usd.locale(Locale(identifier: "en_US")))
    guard let expiresAt else { return "\(amount), no expiration returned" }
    let when = expiresAt.formatted(
      Date.FormatStyle(date: .abbreviated, time: .omitted).locale(Locale(identifier: "en_US"))
    )
    return "\(amount), expires \(when)"
  }

  public func isUnexpired(at date: Date) -> Bool {
    guard let expiresAt else { return true }
    return expiresAt > date
  }

  private static let usd = Decimal.FormatStyle.Currency(code: "USD")
}

public struct APICreditBalanceRow: Equatable, Sendable, Identifiable {
  public var id: String { label }
  public let label: String
  public let remainingUSD: Decimal
  public let soonestExpiry: Date?
  public let helpText: String
}

public struct APIPlatformCredits: Codable, Equatable, Sendable {
  public var remaining: Decimal?
  public var grants: [APICreditGrant]
  public var unavailableReason: String?

  public init(
    remaining: Decimal? = nil,
    grants: [APICreditGrant] = [],
    unavailableReason: String? = nil
  ) {
    self.remaining = remaining
    self.grants = grants
    self.unavailableReason = unavailableReason
  }
}

public enum APICreditGrantList: Equatable, Sendable {
  case grants([APICreditGrant])
  case unavailable
}

public enum APICreditGrantError: Error, Equatable {
  case malformed
}

public enum APICreditGrants {
  public static let unavailableMessage =
    "Purchased and granted credits were not returned by the Admin API."

  public static func parse(_ data: Data, now: Date) throws -> APICreditGrantList {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let rows = root["data"] as? [Any]
    else { throw APICreditGrantError.malformed }
    if rows.isEmpty { return .unavailable }
    var grants: [APICreditGrant] = []
    for row in rows {
      guard let object = row as? [String: Any] else { throw APICreditGrantError.malformed }
      let grant = try grant(from: object)
      if grant.isUnexpired(at: now) { grants.append(grant) }
    }
    return grants.isEmpty ? .unavailable : .grants(grants)
  }

  private static func grant(from object: [String: Any]) throws -> APICreditGrant {
    let amount = try remaining(from: object)
    guard amount.currency == "usd", amount.value >= 0 else { throw APICreditGrantError.malformed }
    return APICreditGrant(
      kind: kind(from: object),
      remainingUSD: amount.value,
      expiresAt: try expiry(from: object)
    )
  }

  private static func remaining(
    from object: [String: Any]
  ) throws -> (value: Decimal, currency: String) {
    if let nested = object["remaining_amount"] {
      guard let body = nested as? [String: Any] else { throw APICreditGrantError.malformed }
      return (try decimal(body["value"]), try currency(body["currency"]))
    }
    return (try decimal(object["remaining"]), try currency(object["currency"]))
  }

  private static func kind(from object: [String: Any]) -> APICreditGrant.Kind {
    let raw = (object["grant_type"] as? String) ?? (object["type"] as? String)
    switch raw?.lowercased() {
    case "purchase", "purchased", "paid", "prepaid":
      return .purchased
    case "granted", "promotional", "subscription":
      return .granted
    default:
      return .unspecified
    }
  }

  private static func expiry(from object: [String: Any]) throws -> Date? {
    guard let raw = object["expires_at"], !LocalLogJSON.isNull(raw) else { return nil }
    guard let text = raw as? String, let date = LocalLogTime().parse(text) else {
      throw APICreditGrantError.malformed
    }
    return date
  }

  private static func decimal(_ value: Any?) throws -> Decimal {
    guard let value, !LocalLogJSON.isNull(value) else { throw APICreditGrantError.malformed }
    do {
      return try LocalLogJSON.decimal(value)
    } catch {
      throw APICreditGrantError.malformed
    }
  }

  private static func currency(_ value: Any?) throws -> String {
    guard let text = value as? String else { throw APICreditGrantError.malformed }
    return text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }
}

extension APIPlatformSnapshot {
  public func creditBalanceRows(at date: Date) -> [APICreditBalanceRow] {
    let active = creditGrants.filter { $0.isUnexpired(at: date) }
    return APICreditGrant.Kind.displayOrder.compactMap { kind in
      let grants = active.filter { $0.kind == kind }
      guard !grants.isEmpty else { return nil }
      return APICreditBalanceRow(
        label: kind.rowLabel,
        remainingUSD: grants.reduce(Decimal.zero) { $0 + $1.remainingUSD },
        soonestExpiry: grants.compactMap(\.expiresAt).min(),
        helpText: grants.map { $0.helpLine() }.joined(separator: "\n")
      )
    }
  }
}
