public import Foundation

public struct OpenRouterEndpoints: Sendable {
  public let baseURL: URL

  public init(baseURL: URL = OpenRouterEndpoints.defaultBaseURL) {
    guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil else {
      preconditionFailure("OpenRouter endpoint must use an HTTPS URL with a host.")
    }
    self.baseURL = baseURL
  }

  public static let defaultBaseURL: URL = {
    guard let url = URL(string: "https://openrouter.ai") else {
      preconditionFailure("The OpenRouter default URL is invalid.")
    }
    return url
  }()

  public func credits() -> URL {
    baseURL.appendingPathComponent("api/v1/credits")
  }

  public func workspaces(offset: Int, limit: Int) -> URL {
    url(
      path: "api/v1/workspaces",
      queryItems: [
        URLQueryItem(name: "offset", value: String(offset)),
        URLQueryItem(name: "limit", value: String(limit)),
      ]
    )
  }

  public func keys(workspaceID: String, offset: Int) -> URL {
    url(
      path: "api/v1/keys",
      queryItems: [
        URLQueryItem(name: "workspace_id", value: workspaceID),
        URLQueryItem(name: "include_disabled", value: "true"),
        URLQueryItem(name: "offset", value: String(offset)),
      ]
    )
  }

  private func url(path: String, queryItems: [URLQueryItem]) -> URL {
    var components = URLComponents()
    components.scheme = baseURL.scheme
    components.host = baseURL.host
    components.port = baseURL.port
    components.path = baseURL.path + "/" + path
    components.queryItems = queryItems
    guard let url = components.url else {
      preconditionFailure("The OpenRouter endpoint URL could not be constructed.")
    }
    return url
  }
}

public struct OpenRouterAPIClient: Sendable {
  public let id = APIPlatformID.openRouter
  private let transport: any APIPlatformTransport
  private let endpoints: OpenRouterEndpoints
  private let pageSize = 100

  public init(
    transport: any APIPlatformTransport = URLSessionAPIPlatformTransport(),
    endpoints: OpenRouterEndpoints = OpenRouterEndpoints()
  ) {
    self.transport = transport
    self.endpoints = endpoints
  }

  public func fetchSnapshot(
    token: String,
    now: Date = .now,
    timeZone: TimeZone = .autoupdatingCurrent
  ) async throws -> APIPlatformSnapshot {
    let credits: CreditsEnvelope = try await get(path: endpoints.credits(), token: token)
    let workspaces = try await fetchAllWorkspaces(token: token)
    let keys = try await fetchAllKeys(workspaces: workspaces, token: token)
    let creditsRemaining = credits.data.totalCredits - credits.data.totalUsage
    guard creditsRemaining >= 0 else { throw APIPlatformError.malformedResponse(id) }

    let monthlySpend = keys.reduce(Decimal.zero) { total, key in
      total + key.usageMonthly + key.byokUsageMonthly
    }
    let projectedSpend = try APIPlatformProjection.projectedSpend(
      platform: id, monthlySpend: monthlySpend, now: now, timeZone: timeZone)

    return APIPlatformSnapshot(
      platform: id,
      workspaceNames: workspaces.map(\.name).sorted(),
      creditsRemaining: creditsRemaining,
      monthlySpend: monthlySpend,
      projectedSpend: projectedSpend,
      sourceTimestamp: now
    )
  }

  private func fetchAllWorkspaces(token: String) async throws -> [Workspace] {
    var offset = 0
    var result: [Workspace] = []
    while true {
      let page: WorkspacePage = try await get(
        path: endpoints.workspaces(offset: offset, limit: pageSize), token: token)
      guard page.data.count <= pageSize else { throw APIPlatformError.malformedResponse(id) }
      result.append(contentsOf: page.data)
      if result.count >= page.totalCount || page.data.isEmpty { return result }
      offset += page.data.count
    }
  }

  private func fetchAllKeys(workspaces: [Workspace], token: String) async throws -> [APIKey] {
    var result: [APIKey] = []
    for workspace in workspaces {
      var offset = 0
      while true {
        let page: APIKeyPage = try await get(
          path: endpoints.keys(workspaceID: workspace.id, offset: offset), token: token)
        guard page.data.count <= pageSize else { throw APIPlatformError.malformedResponse(id) }
        result.append(contentsOf: page.data)
        if page.data.isEmpty || page.data.count < pageSize { break }
        offset += page.data.count
      }
    }
    return result
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

private struct CreditsEnvelope: Decodable {
  let data: Credits
}

private struct Credits: Decodable {
  let totalCredits: Decimal
  let totalUsage: Decimal
}

private struct WorkspacePage: Decodable {
  let data: [Workspace]
  let totalCount: Int
}

private struct Workspace: Decodable {
  let id: String
  let name: String
}

private struct APIKeyPage: Decodable {
  let data: [APIKey]
}

private struct APIKey: Decodable {
  let usageMonthly: Decimal
  let byokUsageMonthly: Decimal
}
