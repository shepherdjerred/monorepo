public import Foundation

public enum APIHTTPMethod: String, Equatable, Sendable {
  case get = "GET"
}

public struct APIPlatformRequest: Equatable, Sendable, CustomStringConvertible {
  public let platform: APIPlatformID
  public let method: APIHTTPMethod
  public let url: URL
  public let headers: [String: String]
  public let timeout: TimeInterval

  public init(
    platform: APIPlatformID,
    method: APIHTTPMethod = .get,
    url: URL,
    headers: [String: String],
    timeout: TimeInterval = 20
  ) {
    self.platform = platform
    self.method = method
    self.url = url
    self.headers = headers
    self.timeout = timeout
  }

  public var description: String {
    "APIPlatformRequest(platform: \(platform.rawValue), method: \(method.rawValue), "
      + "url: \(url.absoluteString), headers: <redacted>)"
  }
}

public struct APIPlatformResponse: Equatable, Sendable {
  public let statusCode: Int
  public let data: Data

  public init(statusCode: Int, data: Data) {
    self.statusCode = statusCode
    self.data = data
  }
}

public protocol APIPlatformTransport: Sendable {
  func send(_ request: APIPlatformRequest) async throws -> APIPlatformResponse
}

public final class URLSessionAPIPlatformTransport: APIPlatformTransport, Sendable {
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

  public func send(_ request: APIPlatformRequest) async throws -> APIPlatformResponse {
    var urlRequest = URLRequest(url: request.url, timeoutInterval: request.timeout)
    urlRequest.httpMethod = request.method.rawValue
    for (name, value) in request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }

    do {
      let (data, response) = try await session.data(for: urlRequest)
      guard let response = response as? HTTPURLResponse else {
        throw APIPlatformError.network(request.platform)
      }
      return APIPlatformResponse(statusCode: response.statusCode, data: data)
    } catch let error as APIPlatformError {
      throw error
    } catch let error as URLError where error.code == .timedOut {
      throw APIPlatformError.requestTimedOut(request.platform)
    } catch {
      throw APIPlatformError.network(request.platform)
    }
  }
}

public enum APIPlatformHTTP {
  public static func bearerHeaders(token: String) -> [String: String] {
    [
      "Authorization": "Bearer \(token)",
      "Accept": "application/json",
    ]
  }

  public static func anthropicHeaders(token: String) -> [String: String] {
    [
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "Accept": "application/json",
    ]
  }

  public static func decode<Value: Decodable>(
    _ type: Value.Type,
    from response: APIPlatformResponse,
    platform: APIPlatformID
  ) throws -> Value {
    switch response.statusCode {
    case 200..<300:
      do {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(Value.self, from: response.data)
      } catch {
        throw APIPlatformError.malformedResponse(platform)
      }
    case 401:
      throw APIPlatformError.unauthorized(platform)
    case 403:
      throw APIPlatformError.forbidden(platform)
    case 429:
      throw APIPlatformError.rateLimited(platform)
    default:
      throw APIPlatformError.network(platform)
    }
  }
}
