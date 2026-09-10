public import Foundation

public struct OpenAIAPIClient: Sendable {
  public let id = APIPlatformID.openAI
  private let transport: any APIPlatformTransport
  private let endpoints: OpenAIEndpoints

  public init(
    transport: any APIPlatformTransport = URLSessionAPIPlatformTransport(),
    endpoints: OpenAIEndpoints = OpenAIEndpoints.live()
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
    let startTime = Int(start.timeIntervalSince1970)
    let endTime = Int(now.timeIntervalSince1970)
    guard endTime >= startTime else { throw APIPlatformError.malformedResponse(id) }

    var monthlySpend = Decimal.zero
    var page: String?
    var seenPages: Set<String> = []
    repeat {
      if let page, !seenPages.insert(page).inserted {
        throw APIPlatformError.malformedResponse(id)
      }
      let envelope: CostsPage = try await get(
        path: endpoints.costs(startTime: startTime, endTime: endTime, page: page),
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
        guard result.amount.currency.lowercased() == "usd" else {
          throw APIPlatformError.malformedResponse(id)
        }
        guard result.amount.value >= 0 else { throw APIPlatformError.malformedResponse(id) }
        total += result.amount.value
      }
    }
    return total
  }

  private func get<Value: Decodable>(path: URL, token: String) async throws -> Value {
    let response = try await transport.send(
      APIPlatformRequest(
        platform: id,
        url: path,
        headers: APIPlatformHTTP.bearerHeaders(token: token)
      )
    )
    return try APIPlatformHTTP.decode(Value.self, from: response, platform: id)
  }
}

private struct CostsPage: Decodable {
  let data: [CostBucket]
  let hasMore: Bool
  let nextPage: String?
}

private struct CostBucket: Decodable {
  let results: [CostResult]
}

private struct CostResult: Decodable {
  let amount: CostAmount
}

private struct CostAmount: Decodable {
  let value: Decimal
  let currency: String
}
