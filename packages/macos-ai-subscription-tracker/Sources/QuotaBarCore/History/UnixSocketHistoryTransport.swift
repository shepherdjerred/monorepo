public import Foundation

/// HTTP/1.1 over the history daemon's Unix-domain socket. URLSession cannot
/// reach a Unix socket, so this speaks the small HTTP subset in
/// `HistoryHTTP` over a blocking POSIX socket on a dispatch queue, off the
/// Swift concurrency pool.
public struct UnixSocketHistoryTransport: HistoryTransport {
  public let socketPath: String
  public let timeout: TimeInterval

  public init(socketPath: String = Self.defaultSocketPath(), timeout: TimeInterval = 15) {
    self.socketPath = socketPath
    self.timeout = timeout
  }

  /// `~/.toolkit/history/daemon.sock`.
  public static func defaultSocketPath(
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> String {
    home.appendingPathComponent(".toolkit/history/daemon.sock").path
  }

  public func get(_ target: String) async throws -> HistoryHTTPResponse {
    let socketPath = socketPath
    let timeout = timeout
    return try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        continuation.resume(
          with: Result { () throws(HistoryAPIError) -> HistoryHTTPResponse in
            try UnixSocketExchange(path: socketPath, timeout: timeout).send(
              HistoryHTTP.request(target: target))
          })
      }
    }
  }
}

/// One request and response on a fresh connection.
private struct UnixSocketExchange {
  let path: String
  let timeout: TimeInterval

  func send(_ request: Data) throws(HistoryAPIError) -> HistoryHTTPResponse {
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw .connectionFailed("socket: \(Self.lastError())") }
    defer { close(descriptor) }
    try configure(descriptor)
    try connect(descriptor)
    try write(request, to: descriptor)
    return try readResponse(from: descriptor)
  }

  private func configure(_ descriptor: Int32) throws(HistoryAPIError) {
    var noSigPipe: Int32 = 1
    var interval = timeval(
      tv_sec: Int(timeout), tv_usec: Int32((timeout - timeout.rounded(.down)) * 1_000_000))
    let size = socklen_t(MemoryLayout<timeval>.size)
    guard
      setsockopt(
        descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        == 0,
      setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &interval, size) == 0,
      setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &interval, size) == 0
    else {
      throw .connectionFailed("setsockopt: \(Self.lastError())")
    }
  }

  private func connect(_ descriptor: Int32) throws(HistoryAPIError) {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = Array(path.utf8)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard pathBytes.count < capacity else {
      throw .connectionFailed("socket path is longer than \(capacity - 1) bytes: \(path)")
    }
    withUnsafeMutableBytes(of: &address.sun_path) { buffer in
      buffer.copyBytes(from: pathBytes)
    }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let result = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { generic in
        Darwin.connect(descriptor, generic, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard result == 0 else {
      let code = errno
      if code == ENOENT || code == ECONNREFUSED {
        throw .daemonNotRunning(socketPath: path)
      }
      throw .connectionFailed("connect: \(Self.describe(code))")
    }
  }

  private func write(_ data: Data, to descriptor: Int32) throws(HistoryAPIError) {
    var sent = 0
    while sent < data.count {
      let count = data[sent...].withUnsafeBytes { bytes in
        Darwin.write(descriptor, bytes.baseAddress, bytes.count)
      }
      guard count > 0 else { throw .connectionFailed("write: \(Self.lastError())") }
      sent += count
    }
  }

  private func readResponse(from descriptor: Int32) throws(HistoryAPIError) -> HistoryHTTPResponse {
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
      let count = chunk.withUnsafeMutableBytes { bytes in
        read(descriptor, bytes.baseAddress, bytes.count)
      }
      if count < 0 {
        let code = errno
        let detail =
          code == EAGAIN ? "no reply within \(String(format: "%g", timeout))s" : Self.describe(code)
        throw .connectionFailed("read: \(detail)")
      }
      if count == 0 { return try HistoryHTTP.finalResponse(in: buffer) }
      buffer.append(contentsOf: chunk[0..<count])
      if let response = try HistoryHTTP.response(in: buffer) { return response }
    }
  }

  private static func lastError() -> String { describe(errno) }

  private static func describe(_ code: Int32) -> String {
    String(cString: strerror(code))
  }
}
