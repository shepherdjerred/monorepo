import Foundation

/// Typed reads from the toolkit history daemon's `/v1` API.
public struct HistoryClient: Sendable {
  public static let supportedAPIVersion = 1

  private let transport: any HistoryTransport

  public init(transport: any HistoryTransport = UnixSocketHistoryTransport()) {
    self.transport = transport
  }

  /// Sessions, most recently updated first.
  public func sessions(
    filter: HistorySessionFilter = HistorySessionFilter(),
    range: HistoryTimeRange,
    limit: Int,
    offset: Int = 0
  ) async throws(HistoryAPIError) -> HistorySessionsPage {
    try await fetch(.sessions(filter, range: range, limit: limit, offset: offset))
  }

  /// Full-text search over titles and messages, best match first.
  public func search(
    _ query: String,
    filter: HistorySessionFilter = HistorySessionFilter(),
    range: HistoryTimeRange,
    limit: Int,
    offset: Int = 0
  ) async throws(HistoryAPIError) -> HistorySessionsPage {
    try await fetch(
      .search(query: query, filter: filter, range: range, limit: limit, offset: offset))
  }

  /// One session plus a page of its messages.
  public func session(id: Int, offset: Int = 0, limit: Int) async throws(HistoryAPIError)
    -> HistorySessionDetail
  {
    try await fetch(.session(id: id, offset: offset, limit: limit))
  }

  public func usage(
    groupBy group: HistoryUsageGroup,
    range: HistoryTimeRange,
    source: HistorySource? = nil
  ) async throws(HistoryAPIError) -> HistoryUsageReport {
    try await fetch(.usage(group, range: range, source: source))
  }

  /// Every machine, source, and workspace with indexed sessions.
  public func facets() async throws(HistoryAPIError) -> HistoryFacetsReport {
    try await fetch(.facets)
  }

  /// A page of one history session's captured requests, oldest first.
  public func captures(session: Int, limit: Int, offset: Int = 0) async throws(HistoryAPIError)
    -> HistoryCapturesPage
  {
    try await fetch(.captures(session: session, limit: limit, offset: offset))
  }

  /// One captured request, rebuilt, with what it added.
  public func capture(id: Int) async throws(HistoryAPIError) -> HistoryCaptureDetail {
    try await fetch(.capture(id: id))
  }

  public func tools(range: HistoryTimeRange, limit: Int = 50) async throws(HistoryAPIError)
    -> HistoryToolsReport
  {
    try await fetch(.tools(range: range, limit: limit))
  }

  private func fetch<Response: HistoryVersionedResponse>(
    _ endpoint: HistoryEndpoint
  ) async throws(HistoryAPIError) -> Response {
    let response: HistoryHTTPResponse
    do {
      response = try await transport.get(endpoint.target)
    } catch let error as HistoryAPIError {
      throw error
    } catch {
      throw .connectionFailed(error.localizedDescription)
    }
    return try Self.decode(response, path: endpoint.path)
  }

  static func decode<Response: HistoryVersionedResponse>(
    _ response: HistoryHTTPResponse, path: String
  ) throws(HistoryAPIError) -> Response {
    guard (200..<300).contains(response.status) else {
      let body: HistoryErrorBody = try decodeJSON(response.body, path: path)
      throw .server(status: response.status, message: body.error)
    }
    let envelope: HistoryVersionEnvelope = try decodeJSON(response.body, path: path)
    guard envelope.apiVersion == supportedAPIVersion else {
      throw .unsupportedAPIVersion(envelope.apiVersion)
    }
    return try decodeJSON(response.body, path: path)
  }

  private static func decodeJSON<Value: Decodable>(_ data: Data, path: String)
    throws(HistoryAPIError) -> Value
  {
    do {
      let decoder = JSONDecoder()
      decoder.dateDecodingStrategy = .custom(HistoryTimestamp.decode)
      return try decoder.decode(Value.self, from: data)
    } catch let error as DecodingError {
      throw .decoding(path: path, detail: describe(error))
    } catch {
      throw .decoding(path: path, detail: error.localizedDescription)
    }
  }

  /// "missing key `usage` at sessions[0]" rather than Foundation's debug dump.
  static func describe(_ error: DecodingError) -> String {
    switch error {
    case let .keyNotFound(key, context):
      "missing key `\(key.stringValue)`\(location(context.codingPath))"
    case let .valueNotFound(_, context):
      "null value\(location(context.codingPath))"
    case let .typeMismatch(_, context), let .dataCorrupted(context):
      "\(context.debugDescription)\(location(context.codingPath))"
    @unknown default:
      String(describing: error)
    }
  }

  private static func location(_ path: [any CodingKey]) -> String {
    guard !path.isEmpty else { return "" }
    let text = path.map { key in
      key.intValue.map { "[\($0)]" } ?? ".\(key.stringValue)"
    }
    .joined()
    return " at " + (text.hasPrefix(".") ? String(text.dropFirst()) : text)
  }
}
