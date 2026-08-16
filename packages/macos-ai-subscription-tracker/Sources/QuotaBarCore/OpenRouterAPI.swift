public import Foundation

public enum APIHTTPMethod: String, Equatable, Sendable {
  case get = "GET"
}

public struct OpenRouterRequest: Equatable, Sendable, CustomStringConvertible {
  public let method: APIHTTPMethod
  public let url: URL
  public let bearerToken: String
  public let timeout: TimeInterval

  public init(
    method: APIHTTPMethod = .get,
    url: URL,
    bearerToken: String,
    timeout: TimeInterval = 20
  ) {
    self.method = method
    self.url = url
    self.bearerToken = bearerToken
    self.timeout = timeout
  }

  public var description: String {
    "OpenRouterRequest(method: \(method.rawValue), url: \(url.absoluteString), bearerToken: <redacted>)"
  }
}

public struct OpenRouterResponse: Equatable, Sendable {
  public let statusCode: Int
  public let data: Data

  public init(statusCode: Int, data: Data) {
    self.statusCode = statusCode
    self.data = data
  }
}

public protocol OpenRouterTransport: Sendable {
  func send(_ request: OpenRouterRequest) async throws -> OpenRouterResponse
}

public final class URLSessionOpenRouterTransport: OpenRouterTransport, @unchecked Sendable {
  private let session: URLSession

  public init(session: URLSession? = nil) {
    if let session {
      self.session = session
    } else {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = 20
      configuration.timeoutIntervalForResource = 30
      self.session = URLSession(configuration: configuration)
    }
  }

  public func send(_ request: OpenRouterRequest) async throws -> OpenRouterResponse {
    var urlRequest = URLRequest(url: request.url, timeoutInterval: request.timeout)
    urlRequest.httpMethod = request.method.rawValue
    urlRequest.setValue("Bearer \(request.bearerToken)", forHTTPHeaderField: "Authorization")
    urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")

    do {
      let (data, response) = try await session.data(for: urlRequest)
      guard let response = response as? HTTPURLResponse else {
        throw APIPlatformError.network
      }
      return OpenRouterResponse(statusCode: response.statusCode, data: data)
    } catch let error as APIPlatformError {
      throw error
    } catch let error as URLError where error.code == .timedOut {
      throw APIPlatformError.requestTimedOut
    } catch {
      throw APIPlatformError.network
    }
  }
}

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
  private let transport: any OpenRouterTransport
  private let endpoints: OpenRouterEndpoints
  private let pageSize = 100

  public init(
    transport: any OpenRouterTransport = URLSessionOpenRouterTransport(),
    endpoints: OpenRouterEndpoints = OpenRouterEndpoints()
  ) {
    self.transport = transport
    self.endpoints = endpoints
  }

  public func fetchSnapshot(
    managementKey: String,
    now: Date = .now,
    timeZone: TimeZone = .autoupdatingCurrent
  ) async throws -> APIPlatformSnapshot {
    let credits: CreditsEnvelope = try await get(path: endpoints.credits(), token: managementKey)
    let workspaces = try await fetchAllWorkspaces(token: managementKey)
    let keys = try await fetchAllKeys(workspaces: workspaces, token: managementKey)
    let creditsRemaining = credits.data.totalCredits - credits.data.totalUsage
    guard creditsRemaining >= 0 else { throw APIPlatformError.malformedResponse }

    let monthlySpend = keys.reduce(Decimal.zero) { total, key in
      total + key.usageMonthly + key.byokUsageMonthly
    }
    guard monthlySpend >= 0 else { throw APIPlatformError.malformedResponse }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let elapsedDays = calendar.component(.day, from: now)
    guard let range = calendar.range(of: .day, in: .month, for: now), elapsedDays > 0 else {
      throw APIPlatformError.malformedResponse
    }
    let daysInMonth = range.count
    let projectedSpend = monthlySpend / Decimal(elapsedDays) * Decimal(daysInMonth)

    return APIPlatformSnapshot(
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
      guard page.data.count <= pageSize else { throw APIPlatformError.malformedResponse }
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
        guard page.data.count <= pageSize else { throw APIPlatformError.malformedResponse }
        result.append(contentsOf: page.data)
        if page.data.isEmpty || page.data.count < pageSize { break }
        offset += page.data.count
      }
    }
    return result
  }

  private func get<Value: Decodable>(path: URL, token: String) async throws -> Value {
    let response = try await transport.send(
      OpenRouterRequest(url: path, bearerToken: token)
    )
    switch response.statusCode {
    case 200..<300:
      do {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(Value.self, from: response.data)
      } catch {
        throw APIPlatformError.malformedResponse
      }
    case 401:
      throw APIPlatformError.unauthorized
    case 403:
      throw APIPlatformError.forbidden
    case 429:
      throw APIPlatformError.rateLimited
    default:
      throw APIPlatformError.network
    }
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
