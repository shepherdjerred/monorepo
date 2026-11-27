import Foundation

private enum BrimPublishError: LocalizedError {
  case invalidBaseURL
  case invalidToken
  case connection
  case rejected(Int)
  case missingReceipt

  var errorDescription: String? {
    switch self {
    case .invalidBaseURL:
      "Use a Brim service HTTPS base URL without credentials, a query, or fragment."
    case .invalidToken: "The MacBook collector credential is missing or invalid."
    case .connection: "Brim could not reach the shared service."
    case let .rejected(status): "The Brim service refused the collection (HTTP \(status))."
    case .missingReceipt: "The Brim service returned an invalid collection receipt."
    }
  }
}

struct BrimCollectorPublisher: Sendable {
  private let endpoint: URL
  private let token: String
  private let session: URLSession

  init(baseURL: String, token: String, session: URLSession? = nil) throws {
    guard let url = URL(string: baseURL), url.scheme == "https", url.host() != nil,
      url.user() == nil, url.password() == nil, url.query() == nil, url.fragment() == nil
    else { throw BrimPublishError.invalidBaseURL }
    guard !token.isEmpty, token.utf8.allSatisfy({ 33...126 ~= $0 }) else {
      throw BrimPublishError.invalidToken
    }
    endpoint = url.appending(path: "v1/publish/macbook")
    self.token = token
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 20
    configuration.timeoutIntervalForResource = 30
    self.session = session ?? URLSession(configuration: configuration)
  }

  func publish(_ collection: BrimCollection, samples: [UsageHistorySample]) async throws {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "PUT"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(Payload(collection: collection, samples: samples))

    let result: (Data, URLResponse)
    do {
      result = try await session.data(for: request, delegate: RejectRedirects())
    } catch {
      throw BrimPublishError.connection
    }
    let (data, response) = result
    guard let http = response as? HTTPURLResponse else { throw BrimPublishError.connection }
    guard http.statusCode == 200 else { throw BrimPublishError.rejected(http.statusCode) }
    guard let receipt = try? JSONDecoder().decode(Receipt.self, from: data),
      receipt.version == Payload.apiVersion, receipt.collectedAt == collection.collectedAt
    else { throw BrimPublishError.missingReceipt }
  }
}

private struct Payload: Encodable {
  static let apiVersion = 1
  let version = Self.apiVersion
  let collectedAt: Date
  let quotas: [BrimQuotaObservation]
  let billing: [BrimBillingObservation]
  let quotaHistory: [UsageHistorySample]

  init(collection: BrimCollection, samples: [UsageHistorySample]) {
    collectedAt = collection.collectedAt
    quotas = collection.quotas
    billing = collection.billing
    quotaHistory = samples
  }
}

private struct Receipt: Decodable {
  let version: Int
  let collectedAt: Date
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest
  ) async -> URLRequest? {
    nil
  }
}
