import Foundation
import XCTest

@testable import QuotaBarCore

func fixture(_ name: String) -> Data {
  guard let url = Bundle.module.url(forResource: name, withExtension: "json") else {
    preconditionFailure("Missing fixture \(name)")
  }
  do {
    return try Data(contentsOf: url)
  } catch {
    preconditionFailure("Unreadable fixture \(name)")
  }
}

func date(_ value: String) -> Date {
  guard let result = ISO8601DateFormatter().date(from: value) else {
    preconditionFailure("Invalid test date")
  }
  return result
}

func window(
  id: String = "weekly",
  remaining: Double?,
  resetAt: Date? = nil,
  sourceTimestamp: Date = .now
) -> UsageWindow {
  do {
    return try UsageWindow.validated(
      id: id,
      label: id.capitalized,
      kind: .weekly,
      usedPercent: remaining.map { 100 - $0 },
      resetAt: resetAt,
      sourceTimestamp: sourceTimestamp
    )
  } catch {
    preconditionFailure("Invalid test window")
  }
}

func temporaryDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent("quotabar-tests-\(UUID().uuidString)", isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

actor StubCredentialStore: CredentialStore {
  private var credentials: [ProviderCredential]
  private(set) var rejectionRequests: [Bool] = []

  init(tokens: [String]) {
    self.credentials = tokens.map { token in
      do { return try ProviderCredential(accessToken: token, source: "test") } catch {
        preconditionFailure("Invalid test credential")
      }
    }
  }

  func credential(
    for provider: ProviderID,
    rejecting rejectedCredential: ProviderCredential?
  ) throws -> ProviderCredential {
    rejectionRequests.append(rejectedCredential != nil)
    guard !credentials.isEmpty else { throw QuotaError.credentialsMissing(provider) }
    if let rejectedCredential {
      credentials.removeAll { $0.accessToken == rejectedCredential.accessToken }
    }
    guard let credential = credentials.first else { throw QuotaError.credentialsMissing(provider) }
    return credential
  }
}

actor StubTransport: HTTPTransport {
  private var results: [Result<ProviderResponse, QuotaError>]
  private(set) var requests: [ProviderRequest] = []

  init(_ results: [Result<ProviderResponse, QuotaError>]) {
    self.results = results
  }

  func send(_ request: ProviderRequest) throws -> ProviderResponse {
    requests.append(request)
    guard !results.isEmpty else { throw QuotaError.network(request.provider) }
    return try results.removeFirst().get()
  }
}

actor RoutingTransport: HTTPTransport {
  private var routes: [String: Result<ProviderResponse, QuotaError>]
  private(set) var requests: [ProviderRequest] = []

  init(routes: [String: Result<ProviderResponse, QuotaError>]) {
    self.routes = routes
  }

  func send(_ request: ProviderRequest) throws -> ProviderResponse {
    requests.append(request)
    guard let result = routes[request.url.absoluteString] else {
      throw QuotaError.network(request.provider)
    }
    return try result.get()
  }
}

/// Routes by URL like `RoutingTransport`, but a route may additionally reject one bearer token
/// with 401 while accepting any other — for testing that a provider keeps every request for one
/// fetch on a single, consistent credential.
actor TokenRoutingTransport: HTTPTransport {
  private var routes:
    [String: (rejectedToken: String?, response: Result<ProviderResponse, QuotaError>)]
  private(set) var requests: [ProviderRequest] = []

  init(routes: [String: (rejectedToken: String?, response: Result<ProviderResponse, QuotaError>)]) {
    self.routes = routes
  }

  func send(_ request: ProviderRequest) throws -> ProviderResponse {
    requests.append(request)
    guard let route = routes[request.url.absoluteString] else {
      throw QuotaError.network(request.provider)
    }
    if let rejectedToken = route.rejectedToken, request.bearerToken == rejectedToken {
      return ProviderResponse(statusCode: 401, data: Data())
    }
    return try route.response.get()
  }
}

final class FakeKeychain: KeychainClient, @unchecked Sendable {
  private let lock = NSLock()
  private var values: [String: Data] = [:]
  var failureStatus: Int32?

  func read(service: String, account: String?) throws -> Data? {
    try lock.withLock {
      if let failureStatus { throw QuotaError.keychain(status: failureStatus) }
      return values[key(service: service, account: account)]
    }
  }

  func write(_ data: Data, service: String, account: String) throws {
    try lock.withLock {
      if let failureStatus { throw QuotaError.keychain(status: failureStatus) }
      values[key(service: service, account: account)] = data
    }
  }

  func delete(service: String, account: String) throws {
    try lock.withLock {
      if let failureStatus { throw QuotaError.keychain(status: failureStatus) }
      values.removeValue(forKey: key(service: service, account: account))
    }
  }

  func seed(_ data: Data, service: String, account: String? = nil) {
    lock.withLock { values[key(service: service, account: account)] = data }
  }

  private func key(service: String, account: String?) -> String {
    "\(service)::\(account ?? "")"
  }
}
