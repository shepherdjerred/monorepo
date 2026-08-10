public import Foundation

public struct ProviderCredential: Equatable, Sendable {
  public let accessToken: String
  public let expiresAt: Date?
  public let source: String

  public init(accessToken: String, expiresAt: Date? = nil, source: String) throws {
    let normalized = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw QuotaError.credentialEmpty }
    self.accessToken = normalized
    self.expiresAt = expiresAt
    self.source = source
  }

  public func requireCurrent(for provider: ProviderID, now: Date = .now) throws
    -> ProviderCredential
  {
    if let expiresAt, expiresAt <= now {
      throw QuotaError.credentialsExpired(provider)
    }
    return self
  }
}

public protocol CredentialStore: Sendable {
  func credential(for provider: ProviderID, reload: Bool) async throws -> ProviderCredential
}

public struct ProviderRequest: Equatable, Sendable, CustomStringConvertible {
  public let provider: ProviderID
  public let url: URL
  public let bearerToken: String
  public let headers: [String: String]
  public let timeout: TimeInterval

  public init(
    provider: ProviderID,
    url: URL,
    bearerToken: String,
    headers: [String: String] = [:],
    timeout: TimeInterval = 20
  ) {
    self.provider = provider
    self.url = url
    self.bearerToken = bearerToken
    self.headers = headers
    self.timeout = timeout
  }

  public var description: String {
    "ProviderRequest(provider: \(provider.rawValue), url: \(url.absoluteString), bearerToken: <redacted>)"
  }
}

public struct ProviderResponse: Equatable, Sendable {
  public let statusCode: Int
  public let data: Data

  public init(statusCode: Int, data: Data) {
    self.statusCode = statusCode
    self.data = data
  }
}

public protocol HTTPTransport: Sendable {
  func send(_ request: ProviderRequest) async throws -> ProviderResponse
}

public final class URLSessionTransport: HTTPTransport, @unchecked Sendable {
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

  public func send(_ request: ProviderRequest) async throws -> ProviderResponse {
    var urlRequest = URLRequest(url: request.url, timeoutInterval: request.timeout)
    urlRequest.httpMethod = "GET"
    urlRequest.setValue("Bearer \(request.bearerToken)", forHTTPHeaderField: "Authorization")
    urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
    for (name, value) in request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }

    do {
      let (data, response) = try await session.data(for: urlRequest)
      guard let response = response as? HTTPURLResponse else {
        throw QuotaError.network(request.provider)
      }
      return ProviderResponse(statusCode: response.statusCode, data: data)
    } catch let error as QuotaError {
      throw error
    } catch let error as URLError where error.code == .timedOut {
      throw QuotaError.requestTimedOut(request.provider)
    } catch {
      throw QuotaError.network(request.provider)
    }
  }
}

public struct ProviderHTTPClient: Sendable {
  private let transport: any HTTPTransport
  private let credentials: any CredentialStore

  public init(transport: any HTTPTransport, credentials: any CredentialStore) {
    self.transport = transport
    self.credentials = credentials
  }

  public func get(
    provider: ProviderID,
    url: URL,
    headers: [String: String] = [:],
    timeout: TimeInterval = 20
  ) async throws -> Data {
    let initialCredential: ProviderCredential
    do {
      initialCredential = try await credentials.credential(for: provider, reload: false)
        .requireCurrent(for: provider)
    } catch QuotaError.credentialsExpired {
      initialCredential = try await credentials.credential(for: provider, reload: true)
        .requireCurrent(for: provider)
    }
    let first = try await send(
      provider: provider,
      url: url,
      headers: headers,
      timeout: timeout,
      credential: initialCredential
    )
    if first.statusCode == 401 {
      let reloaded = try await credentials.credential(for: provider, reload: true)
        .requireCurrent(for: provider)
      let retry = try await send(
        provider: provider,
        url: url,
        headers: headers,
        timeout: timeout,
        credential: reloaded
      )
      return try validate(retry, provider: provider)
    }
    return try validate(first, provider: provider)
  }

  private func send(
    provider: ProviderID,
    url: URL,
    headers: [String: String],
    timeout: TimeInterval,
    credential: ProviderCredential
  ) async throws -> ProviderResponse {
    try await transport.send(
      ProviderRequest(
        provider: provider,
        url: url,
        bearerToken: credential.accessToken,
        headers: headers,
        timeout: timeout
      )
    )
  }

  private func validate(_ response: ProviderResponse, provider: ProviderID) throws -> Data {
    switch response.statusCode {
    case 200..<300: response.data
    case 401: throw QuotaError.unauthorized(provider)
    case 429: throw QuotaError.rateLimited(provider)
    default: throw QuotaError.network(provider)
    }
  }
}
