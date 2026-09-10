public import Foundation

public struct OpenAIEndpoints: Sendable {
  public let baseURL: URL

  public init(baseURL: URL) {
    guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil else {
      preconditionFailure("OpenAI endpoint must use an HTTPS URL with a host.")
    }
    self.baseURL = baseURL
  }

  public static func live() -> OpenAIEndpoints {
    OpenAIEndpoints(baseURL: liveBaseURL(from: liveOpenAICostsURL, name: "OpenAI"))
  }

  public func costs(startTime: Int, endTime: Int, page: String?) -> URL {
    var items = [
      URLQueryItem(name: "start_time", value: String(startTime)),
      URLQueryItem(name: "end_time", value: String(endTime)),
      URLQueryItem(name: "bucket_width", value: "1d"),
      URLQueryItem(name: "limit", value: "31"),
    ]
    if let page {
      items.append(URLQueryItem(name: "page", value: page))
    }
    return url(path: "v1/organization/costs", queryItems: items)
  }

  private func url(path: String, queryItems: [URLQueryItem]) -> URL {
    var components = URLComponents()
    components.scheme = baseURL.scheme
    components.host = baseURL.host
    components.port = baseURL.port
    components.path = joinedPath(path)
    components.queryItems = queryItems
    guard let url = components.url else {
      preconditionFailure("The OpenAI endpoint URL could not be constructed.")
    }
    return url
  }

  private func joinedPath(_ path: String) -> String {
    let prefix = baseURL.path.hasSuffix("/") ? String(baseURL.path.dropLast()) : baseURL.path
    return prefix + "/" + path
  }
}

public struct AnthropicEndpoints: Sendable {
  public let baseURL: URL

  public init(baseURL: URL) {
    guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil else {
      preconditionFailure("Anthropic endpoint must use an HTTPS URL with a host.")
    }
    self.baseURL = baseURL
  }

  public static func live() -> AnthropicEndpoints {
    AnthropicEndpoints(baseURL: liveBaseURL(from: liveAnthropicCostReportURL, name: "Anthropic"))
  }

  public func costReport(startingAt: String, endingAt: String, page: String?) -> URL {
    var items = [
      URLQueryItem(name: "starting_at", value: startingAt),
      URLQueryItem(name: "ending_at", value: endingAt),
      URLQueryItem(name: "bucket_width", value: "1d"),
      URLQueryItem(name: "limit", value: "31"),
    ]
    if let page {
      items.append(URLQueryItem(name: "page", value: page))
    }
    return url(path: "v1/organizations/cost_report", queryItems: items)
  }

  private func url(path: String, queryItems: [URLQueryItem]) -> URL {
    var components = URLComponents()
    components.scheme = baseURL.scheme
    components.host = baseURL.host
    components.port = baseURL.port
    components.path = joinedPath(path)
    components.queryItems = queryItems
    guard let url = components.url else {
      preconditionFailure("The Anthropic endpoint URL could not be constructed.")
    }
    return url
  }

  private func joinedPath(_ path: String) -> String {
    let prefix = baseURL.path.hasSuffix("/") ? String(baseURL.path.dropLast()) : baseURL.path
    return prefix + "/" + path
  }
}

private let liveOpenAICostsURL = "https://api.openai.com/v1/organization/costs"
private let liveAnthropicCostReportURL = "https://api.anthropic.com/v1/organizations/cost_report"

private func liveBaseURL(from endpoint: String, name: String) -> URL {
  guard let endpointURL = URL(string: endpoint),
    let scheme = endpointURL.scheme,
    let host = endpointURL.host
  else {
    preconditionFailure("The \(name) endpoint URL is invalid.")
  }
  var components = URLComponents()
  components.scheme = scheme
  components.host = host
  components.port = endpointURL.port
  guard let url = components.url else {
    preconditionFailure("The \(name) default URL is invalid.")
  }
  return url
}
