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
    OpenAIEndpoints(baseURL: liveOpenAIBaseURL)
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
    AnthropicEndpoints(baseURL: liveAnthropicBaseURL)
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

private let liveOpenAIBaseURL: URL = {
  guard let url = URL(string: "https://api.openai.com") else {
    preconditionFailure("The OpenAI default URL is invalid.")
  }
  return url
}()

private let liveAnthropicBaseURL: URL = {
  guard let url = URL(string: "https://api.anthropic.com") else {
    preconditionFailure("The Anthropic default URL is invalid.")
  }
  return url
}()
