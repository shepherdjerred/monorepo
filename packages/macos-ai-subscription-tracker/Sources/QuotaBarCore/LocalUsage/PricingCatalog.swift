import Foundation

struct PricingCatalog: Equatable, Sendable {
  let fetchedOn: String
  let prices: [String: ModelTokenPrice]

  static func bundled() throws -> PricingCatalog {
    guard let url = Bundle.module.url(forResource: "model-prices", withExtension: "json") else {
      throw PricingCatalogError.missing
    }
    do {
      return try decode(Data(contentsOf: url))
    } catch let error as PricingCatalogError {
      throw error
    } catch {
      throw PricingCatalogError.unreadable
    }
  }

  func cost(of turn: UsageTurn) -> Decimal? {
    guard let price = prices[turn.model] else { return nil }
    if turn.cacheCreateTokens > 0, price.cacheCreate == nil { return nil }
    if turn.cacheRead > 0, price.cacheRead == nil { return nil }
    let cacheCreate = price.cacheCreate ?? .zero
    let cacheRead = price.cacheRead ?? .zero
    let amount =
      Decimal(turn.input) * price.input
      + Decimal(turn.output) * price.output
      + Decimal(turn.cacheCreate5m) * cacheCreate
      + Decimal(turn.cacheCreate1h) * price.input * 2
      + Decimal(turn.cacheCreateUnsplit) * cacheCreate
      + Decimal(turn.cacheRead) * cacheRead
    return amount / Decimal(1_000_000)
  }

  static func cost(of turn: UsageTurn, using catalog: PricingCatalog?) -> Decimal? {
    if let recorded = turn.recordedCostUSD { return recorded }
    return catalog?.cost(of: turn)
  }

  private static func decode(_ data: Data) throws -> PricingCatalog {
    let file = try JSONDecoder().decode(PricingCatalogFile.self, from: data)
    guard !file.fetchedOn.isEmpty, !file.models.isEmpty else {
      throw PricingCatalogError.unreadable
    }
    return PricingCatalog(fetchedOn: file.fetchedOn, prices: file.models)
  }
}

enum PricingCatalogError: Error {
  case missing
  case unreadable
}

struct ModelTokenPrice: Equatable, Sendable, Decodable {
  var input: Decimal
  var output: Decimal
  var cacheCreate: Decimal?
  var cacheRead: Decimal?

  init(input: Decimal, output: Decimal, cacheCreate: Decimal?, cacheRead: Decimal?) {
    self.input = input
    self.output = output
    self.cacheCreate = cacheCreate
    self.cacheRead = cacheRead
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    input = try container.decode(JSONDecimal.self, forKey: .input).value
    output = try container.decode(JSONDecimal.self, forKey: .output).value
    cacheCreate = try container.decodeIfPresent(JSONDecimal.self, forKey: .cacheCreate)?.value
    cacheRead = try container.decodeIfPresent(JSONDecimal.self, forKey: .cacheRead)?.value
  }

  private enum CodingKeys: String, CodingKey {
    case input
    case output
    case cacheCreate
    case cacheRead
  }
}

private struct PricingCatalogFile: Decodable {
  let fetchedOn: String
  let models: [String: ModelTokenPrice]
}

private struct JSONDecimal: Decodable {
  let value: Decimal

  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      throw DecodingError.valueNotFound(
        Decimal.self,
        DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Missing price")
      )
    }
    if let whole = try? container.decode(Int.self) {
      value = Decimal(whole)
      return
    }
    if let text = try? container.decode(String.self), let parsed = Self.parse(text) {
      value = parsed
      return
    }
    let number = try container.decode(Double.self)
    guard let parsed = Self.parse(String(number)) else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid price")
    }
    value = parsed
  }

  private static func parse(_ text: String) -> Decimal? {
    Decimal(string: text, locale: Locale(identifier: "en_US_POSIX"))
  }
}
