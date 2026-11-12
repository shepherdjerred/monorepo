import Foundation

/// How far back the Sessions window looks. The daemon filters a session list
/// by last update and usage by when each event happened.
public enum HistoryTimeRange: String, CaseIterable, Identifiable, Sendable {
  case day
  case week
  case month
  case quarter
  case all

  public var id: Self { self }

  public var label: String {
    switch self {
    case .day: "24 hours"
    case .week: "7 days"
    case .month: "30 days"
    case .quarter: "90 days"
    case .all: "All time"
    }
  }

  /// The daemon's `since` value; absent means no lower bound.
  var sinceParameter: String? {
    switch self {
    case .day: "24h"
    case .week: "7d"
    case .month: "30d"
    case .quarter: "90d"
    case .all: nil
    }
  }
}

/// A machine whose sessions the index holds.
public enum HistoryMachine: Hashable, Sendable {
  /// This Mac's own sessions, stored without a machine id.
  case local
  /// A machine mirrored by `brim sync pull`.
  case mirrored(String)

  public init(key: String?) {
    self = key.map(Self.mirrored) ?? .local
  }

  public var displayName: String {
    switch self {
    case .local: "This Mac"
    case let .mirrored(id): id
    }
  }

  var parameter: String {
    switch self {
    case .local: "local"
    case let .mirrored(id): id
    }
  }
}

/// Server-side filters for `/v1/sessions`.
public struct HistorySessionFilter: Equatable, Hashable, Sendable {
  public var source: HistorySource?
  public var machine: HistoryMachine?
  public var workspace: String?

  public init(
    source: HistorySource? = nil, machine: HistoryMachine? = nil, workspace: String? = nil
  ) {
    self.source = source
    self.machine = machine
    self.workspace = workspace
  }
}

extension HistorySessionFilter {
  fileprivate var queryItems: [(String, String?)] {
    [
      ("source", source?.rawValue), ("machine", machine?.parameter),
      ("workspace", workspace),
    ]
  }
}

/// A `/v1` request target (path and query).
enum HistoryEndpoint: Equatable, Sendable {
  case sessions(HistorySessionFilter, range: HistoryTimeRange, limit: Int, offset: Int)
  case search(
    query: String, filter: HistorySessionFilter, range: HistoryTimeRange, limit: Int, offset: Int)
  case session(id: Int, offset: Int, limit: Int)
  case usage(HistoryUsageGroup, range: HistoryTimeRange, source: HistorySource?)
  case tools(range: HistoryTimeRange, limit: Int)
  case facets

  var path: String {
    switch self {
    case .sessions: "/v1/sessions"
    case .search: "/v1/search"
    case let .session(id, _, _): "/v1/sessions/\(id)"
    case .usage: "/v1/usage"
    case .tools: "/v1/tools"
    case .facets: "/v1/facets"
    }
  }

  var target: String {
    let query = queryItems.compactMap { name, value in
      value.map { "\(name)=\(Self.encode($0))" }
    }
    return query.isEmpty ? path : "\(path)?\(query.joined(separator: "&"))"
  }

  private var queryItems: [(String, String?)] {
    switch self {
    case let .sessions(filter, range, limit, offset):
      [("since", range.sinceParameter)] + filter.queryItems
        + [("limit", String(limit)), ("offset", String(offset))]
    case let .search(query, filter, range, limit, offset):
      [("q", query), ("since", range.sinceParameter)] + filter.queryItems
        + [("limit", String(limit)), ("offset", String(offset))]
    case let .session(_, offset, limit):
      [("offset", String(offset)), ("limit", String(limit))]
    case let .usage(group, range, source):
      [("groupBy", group.rawValue), ("since", range.sinceParameter), ("source", source?.rawValue)]
    case let .tools(range, limit):
      [("since", range.sinceParameter), ("limit", String(limit))]
    case .facets:
      []
    }
  }

  /// Percent-encodes everything but RFC 3986 unreserved characters. The
  /// daemon parses queries with `URLSearchParams`, which reads `+` as a
  /// space, so `+` must be encoded too.
  static func encode(_ value: String) -> String {
    var encoded = ""
    for byte in value.utf8 {
      if unreserved.contains(byte) {
        encoded.unicodeScalars.append(UnicodeScalar(byte))
      } else {
        encoded += "%" + hexDigits[Int(byte >> 4)] + hexDigits[Int(byte & 0x0F)]
      }
    }
    return encoded
  }

  private static let unreserved = Set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~".utf8)
  private static let hexDigits = "0123456789ABCDEF".map(String.init)
}
