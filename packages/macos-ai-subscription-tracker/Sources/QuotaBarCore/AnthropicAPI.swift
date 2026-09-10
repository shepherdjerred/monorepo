public import Foundation

public struct AnthropicAPIClient: Sendable {
  public let id = APIPlatformID.anthropic
  private let transport: any APIPlatformTransport
  private let endpoints: AnthropicEndpoints

  public init(
    transport: any APIPlatformTransport = URLSessionAPIPlatformTransport(),
    endpoints: AnthropicEndpoints = AnthropicEndpoints.live()
  ) {
    self.transport = transport
    self.endpoints = endpoints
  }

  public func fetchSnapshot(
    token: String,
    now: Date = .now,
    timeZone: TimeZone = .autoupdatingCurrent
  ) async throws -> APIPlatformSnapshot {
    let start = try APIPlatformProjection.monthStart(platform: id, now: now, timeZone: timeZone)
    let startingAt = Self.rfc3339(start)
    let endingAt = Self.rfc3339(now)

    var monthlySpend = Decimal.zero
    var page: String?
    var seenPages: Set<String> = []
    repeat {
      if let page, !seenPages.insert(page).inserted {
        throw APIPlatformError.malformedResponse(id)
      }
      let envelope: CostReport = try await get(
        path: endpoints.costReport(startingAt: startingAt, endingAt: endingAt, page: page),
        token: token
      )
      monthlySpend += try totalUSD(envelope.data)
      if envelope.hasMore {
        guard let nextPage = envelope.nextPage, !nextPage.isEmpty else {
          throw APIPlatformError.malformedResponse(id)
        }
        page = nextPage
      } else {
        page = nil
      }
    } while page != nil

    let projectedSpend = try APIPlatformProjection.projectedSpend(
      platform: id, monthlySpend: monthlySpend, now: now, timeZone: timeZone)
    return APIPlatformSnapshot(
      platform: id,
      workspaceNames: [],
      creditsRemaining: nil,
      monthlySpend: monthlySpend,
      projectedSpend: projectedSpend,
      sourceTimestamp: now
    )
  }

  private func totalUSD(_ buckets: [CostBucket]) throws -> Decimal {
    var total = Decimal.zero
    for bucket in buckets {
      for result in bucket.results {
        guard result.currency.lowercased() == "usd" else {
          throw APIPlatformError.malformedResponse(id)
        }
        let cents = try posixDecimal(result.amount)
        guard cents >= 0 else { throw APIPlatformError.malformedResponse(id) }
        total += cents / 100
      }
    }
    return total
  }

  private func posixDecimal(_ value: String) throws -> Decimal {
    let scanner = Scanner(string: value)
    scanner.locale = Locale(identifier: "en_US_POSIX")
    scanner.charactersToBeSkipped = nil
    guard let parsed = scanner.scanDecimal(), scanner.isAtEnd else {
      throw APIPlatformError.malformedResponse(id)
    }
    return parsed
  }

  private static func rfc3339(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
  }

  private func get<Value: Decodable>(path: URL, token: String) async throws -> Value {
    let response = try await transport.send(
      APIPlatformRequest(
        platform: id,
        url: path,
        headers: APIPlatformHTTP.anthropicHeaders(token: token)
      )
    )
    return try APIPlatformHTTP.decode(Value.self, from: response, platform: id)
  }
}

private struct CostReport: Decodable {
  let data: [CostBucket]
  let hasMore: Bool
  let nextPage: String?
}

private struct CostBucket: Decodable {
  let results: [CostResult]
}

private struct CostResult: Decodable {
  let amount: String
  let currency: String
}
