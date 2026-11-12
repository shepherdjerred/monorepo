public import Foundation

/// A complete HTTP response from the history daemon.
public struct HistoryHTTPResponse: Equatable, Sendable {
  public let status: Int
  public let body: Data

  public init(status: Int, body: Data) {
    self.status = status
    self.body = body
  }
}

/// Sends one `GET` for a request target such as `/v1/sessions?limit=50`.
/// Implementations throw `HistoryAPIError`.
public protocol HistoryTransport: Sendable {
  func get(_ target: String) async throws -> HistoryHTTPResponse
}

/// The HTTP/1.1 subset the daemon speaks: one JSON response per connection
/// with a `Content-Length` body, which Bun always sets for `Response.json`.
/// Anything else (chunked encoding, a non-JSON body, trailing bytes) is
/// rejected rather than guessed at.
enum HistoryHTTP {
  /// Generous for 5,000 full messages; protects against a runaway reply.
  static let maximumBodyBytes = 256 * 1024 * 1024

  static func request(target: String) -> Data {
    Data(
      ("GET \(target) HTTP/1.1\r\nHost: history\r\nAccept: application/json\r\n"
        + "Connection: close\r\n\r\n").utf8)
  }

  /// The parsed response once `buffer` holds all of it, `nil` while more
  /// bytes are needed.
  static func response(in buffer: Data) throws(HistoryAPIError) -> HistoryHTTPResponse? {
    guard let headerEnd = buffer.firstRange(of: headerTerminator) else {
      guard buffer.count <= maximumHeaderBytes else {
        throw .malformedHTTP("response headers exceed \(maximumHeaderBytes) bytes")
      }
      return nil
    }
    let head = try parseHead(buffer[buffer.startIndex..<headerEnd.lowerBound])
    let bodyStart = headerEnd.upperBound
    let available = buffer.endIndex - bodyStart
    guard available >= head.contentLength else { return nil }
    guard available == head.contentLength else {
      throw .malformedHTTP("\(available - head.contentLength) bytes after the declared body")
    }
    return HistoryHTTPResponse(status: head.status, body: Data(buffer[bodyStart...]))
  }

  /// The response at end of stream; a short read is an error.
  static func finalResponse(in buffer: Data) throws(HistoryAPIError) -> HistoryHTTPResponse {
    guard let response = try response(in: buffer) else {
      throw .malformedHTTP("the connection closed after \(buffer.count) bytes, mid-response")
    }
    return response
  }

  private static let headerTerminator = Data("\r\n\r\n".utf8)
  private static let maximumHeaderBytes = 64 * 1024

  private struct Head {
    let status: Int
    let contentLength: Int
  }

  private static func parseHead(_ bytes: Data) throws(HistoryAPIError) -> Head {
    guard let text = String(data: bytes, encoding: .utf8) else {
      throw .malformedHTTP("headers are not UTF-8")
    }
    var lines = text.components(separatedBy: "\r\n")
    let status = try parseStatusLine(lines.removeFirst())
    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else {
        throw .malformedHTTP("header line without a colon: \(line)")
      }
      let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    if let encoding = headers["transfer-encoding"] {
      throw .malformedHTTP("unsupported Transfer-Encoding \(encoding)")
    }
    guard let rawLength = headers["content-length"] else {
      throw .malformedHTTP("no Content-Length header")
    }
    guard let length = Int(rawLength), length >= 0, length <= maximumBodyBytes else {
      throw .malformedHTTP("invalid Content-Length \(rawLength)")
    }
    let contentType = headers["content-type"] ?? "none"
    guard contentType.lowercased().hasPrefix("application/json") else {
      throw .malformedHTTP("Content-Type \(contentType) is not JSON")
    }
    return Head(status: status, contentLength: length)
  }

  private static func parseStatusLine(_ line: String) throws(HistoryAPIError) -> Int {
    let parts = line.split(separator: " ", maxSplits: 2)
    guard parts.count >= 2, parts[0] == "HTTP/1.1" || parts[0] == "HTTP/1.0",
      parts[1].count == 3, let status = Int(parts[1]), (200..<600).contains(status)
    else {
      throw .malformedHTTP("invalid status line \(line)")
    }
    return status
  }
}
