import Foundation
import XCTest

@testable import QuotaBarCore

final class HistoryHTTPTests: XCTestCase {
  func testParsesAContentLengthResponseOnceComplete() throws {
    let raw = http(body: #"{"a":1}"#)
    XCTAssertNil(try HistoryHTTP.response(in: Data(raw.utf8.prefix(10))))
    XCTAssertNil(try HistoryHTTP.response(in: Data(raw.utf8.dropLast(2))))
    let response = try XCTUnwrap(try HistoryHTTP.response(in: Data(raw.utf8)))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(utf8Text(response.body), #"{"a":1}"#)
  }

  func testRequestsCloseTheConnection() {
    XCTAssertEqual(
      utf8Text(HistoryHTTP.request(target: "/v1/tools")),
      "GET /v1/tools HTTP/1.1\r\nHost: history\r\nAccept: application/json\r\n"
        + "Connection: close\r\n\r\n")
  }

  func testRejectsResponsesThisClientDoesNotSpeak() {
    let chunked = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
    assertMalformed(chunked, "unsupported Transfer-Encoding chunked")
    assertMalformed(
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n", "no Content-Length header")
    assertMalformed(
      "HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n", "invalid Content-Length -1")
    assertMalformed(
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: text/html\r\n\r\nhi",
      "Content-Type text/html is not JSON")
    assertMalformed(
      "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", "Content-Type none is not JSON")
    assertMalformed(http(body: "{}") + "extra", "5 bytes after the declared body")
    assertMalformed("HTTP/2 200\r\n\r\n", "invalid status line HTTP/2 200")
    assertMalformed("HTTP/1.1 OK\r\n\r\n", "invalid status line HTTP/1.1 OK")
    assertMalformed("HTTP/1.1 200 OK\r\nbroken\r\n\r\n", "header line without a colon: broken")
    XCTAssertThrowsError(
      try HistoryHTTP.response(in: Data([0xFF, 0xFE]) + Data("\r\n\r\n".utf8))
    ) { error in
      XCTAssertEqual(error as? HistoryAPIError, .malformedHTTP("headers are not UTF-8"))
    }
    XCTAssertThrowsError(
      try HistoryHTTP.response(in: Data(repeating: 0x41, count: 70_000))
    ) { error in
      XCTAssertEqual(
        error as? HistoryAPIError, .malformedHTTP("response headers exceed 65536 bytes"))
    }
  }

  func testAShortReadAtEndOfStreamIsAnError() throws {
    XCTAssertEqual(try HistoryHTTP.finalResponse(in: Data(http(body: "{}").utf8)).status, 200)
    XCTAssertThrowsError(try HistoryHTTP.finalResponse(in: Data("HTTP/1.1".utf8))) { error in
      XCTAssertEqual(
        error as? HistoryAPIError,
        .malformedHTTP("the connection closed after 8 bytes, mid-response"))
    }
  }

  private func assertMalformed(
    _ raw: String, _ detail: String, file: StaticString = #filePath, line: UInt = #line
  ) {
    let data = Data(raw.utf8)
    XCTAssertThrowsError(try HistoryHTTP.response(in: data), file: file, line: line) { error in
      XCTAssertEqual(error as? HistoryAPIError, .malformedHTTP(detail), file: file, line: line)
    }
  }
}

final class UnixSocketHistoryTransportTests: XCTestCase {
  func testAMissingSocketMeansTheDaemonIsNotRunning() async throws {
    let path = shortSocketPath()
    let transport = UnixSocketHistoryTransport(socketPath: path)
    do {
      _ = try await transport.get("/v1/tools")
      XCTFail("Expected an error")
    } catch {
      XCTAssertEqual(error as? HistoryAPIError, .daemonNotRunning(socketPath: path))
      XCTAssertEqual(
        (error as? HistoryAPIError)?.fixCommand, "toolkit history daemon install")
    }
  }

  func testTheDefaultSocketIsUnderToolkitHistory() {
    XCTAssertEqual(
      UnixSocketHistoryTransport.defaultSocketPath(home: URL(fileURLWithPath: "/Users/me")),
      "/Users/me/.toolkit/history/daemon.sock")
  }

  func testRejectsASocketPathTooLongForSockaddr() async {
    let path = "/tmp/" + String(repeating: "a", count: 200)
    do {
      _ = try await UnixSocketHistoryTransport(socketPath: path).get("/v1/tools")
      XCTFail("Expected an error")
    } catch {
      XCTAssertEqual(
        error as? HistoryAPIError,
        .connectionFailed("socket path is longer than 103 bytes: \(path)"))
    }
  }

  func testExchangesARequestWithARealUnixSocketServer() async throws {
    let body = try sharedHistoryFixture("tools")
    let server = try OneShotUnixServer(
      response: Data("HTTP/1.1 200 OK\r\nContent-Type: application/json;charset=utf-8\r\n".utf8)
        + Data("Content-Length: \(body.count)\r\n\r\n".utf8) + body)
    defer { server.remove() }
    async let request = server.serve()
    let client = HistoryClient(transport: UnixSocketHistoryTransport(socketPath: server.path))
    let report = try await client.tools(range: .week, limit: 3)
    XCTAssertEqual(report.rows.count, 3)
    let received = await request
    XCTAssertTrue(received.hasPrefix("GET /v1/tools?since=7d&limit=3 HTTP/1.1\r\n"), received)
    XCTAssertTrue(received.contains("Connection: close\r\n"))
  }

  func testAConnectionClosedMidResponseIsMalformed() async throws {
    let server = try OneShotUnixServer(
      response: Data(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{}".utf8))
    defer { server.remove() }
    async let request = server.serve()
    do {
      _ = try await UnixSocketHistoryTransport(socketPath: server.path).get("/v1/tools")
      XCTFail("Expected an error")
    } catch {
      XCTAssertEqual(
        error as? HistoryAPIError,
        .malformedHTTP("the connection closed after 73 bytes, mid-response"))
    }
    _ = await request
  }

  func testASilentServerTimesOut() async throws {
    let server = try OneShotUnixServer(response: nil)
    defer { server.remove() }
    async let request = server.serve()
    do {
      _ = try await UnixSocketHistoryTransport(socketPath: server.path, timeout: 0.2).get("/")
      XCTFail("Expected an error")
    } catch {
      XCTAssertEqual(error as? HistoryAPIError, .connectionFailed("read: no reply within 0.2s"))
    }
    _ = await request
  }

  func testTransportFailuresThatAreNotTypedBecomeConnectionFailures() async {
    struct Offline: LocalizedError {
      var errorDescription: String? { "offline" }
    }
    let client = HistoryClient(transport: FakeHistoryTransport { _, _ in throw Offline() })
    do {
      _ = try await client.tools(range: .all)
      XCTFail("Expected an error")
    } catch {
      XCTAssertEqual(error, .connectionFailed("offline"))
    }
  }
}

private func http(body: String) -> String {
  "HTTP/1.1 200 OK\r\nContent-Type: application/json;charset=utf-8\r\n"
    + "Content-Length: \(body.utf8.count)\r\n\r\n\(body)"
}

/// `sockaddr_un` allows 103 bytes, so the test socket lives directly in /tmp.
private func shortSocketPath() -> String {
  "/tmp/brim-\(UUID().uuidString.prefix(8)).sock"
}

/// A listening Unix socket that accepts one connection, reads the request
/// head, writes `response` (or nothing, then waits for the client to hang
/// up), and closes.
private struct OneShotUnixServer {
  let path: String
  private let descriptor: Int32
  private let response: Data?

  init(response: Data?) throws {
    path = shortSocketPath()
    self.response = response
    descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
    let bound = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard descriptor >= 0, bound == 0, listen(descriptor, 1) == 0 else {
      throw POSIXError(.EADDRINUSE)
    }
  }

  /// The request head the client sent.
  func serve() async -> String {
    let descriptor = descriptor
    let response = response
    return await withCheckedContinuation { continuation in
      DispatchQueue.global().async {
        let connection = accept(descriptor, nil, nil)
        var received = Data()
        var chunk = [UInt8](repeating: 0, count: 4_096)
        while received.firstRange(of: Data("\r\n\r\n".utf8)) == nil {
          let count = read(connection, &chunk, chunk.count)
          guard count > 0 else { break }
          received.append(contentsOf: chunk[0..<count])
        }
        if let response {
          _ = response.withUnsafeBytes { write(connection, $0.baseAddress, $0.count) }
        } else {
          _ = read(connection, &chunk, chunk.count)
        }
        close(connection)
        continuation.resume(returning: utf8Text(received))
      }
    }
  }

  func remove() {
    close(descriptor)
    unlink(path)
  }
}
