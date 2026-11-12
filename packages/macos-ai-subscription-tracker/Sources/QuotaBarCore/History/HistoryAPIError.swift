public import Foundation

/// Why the Sessions window could not read the history daemon. There is no
/// fallback to reading the index or transcripts directly.
public enum HistoryAPIError: Error, Equatable, LocalizedError, Sendable {
  /// No daemon is listening on the socket (missing socket or refused).
  case daemonNotRunning(socketPath: String)
  /// The socket exists but the exchange failed (timeout, reset, permissions).
  case connectionFailed(String)
  /// The daemon answered with a non-2xx status and its `{ error }` message.
  case server(status: Int, message: String)
  /// The reply was not the HTTP/1.1 response this client expects.
  case malformedHTTP(String)
  /// The JSON did not match the `/v1` contract.
  case decoding(path: String, detail: String)
  /// The daemon speaks a different `/v1` contract version.
  case unsupportedAPIVersion(Int)

  public var errorDescription: String? {
    switch self {
    case let .daemonNotRunning(socketPath):
      "The toolkit history daemon is not running (no listener at \(socketPath))."
    case let .connectionFailed(detail):
      "Brim could not talk to the toolkit history daemon: \(detail)."
    case let .server(status, message):
      "The history daemon returned HTTP \(status): \(message)"
    case let .malformedHTTP(detail):
      "The history daemon sent an unexpected HTTP reply: \(detail)."
    case let .decoding(path, detail):
      "The history daemon's \(path) response does not match Brim's contract: \(detail)."
    case let .unsupportedAPIVersion(version):
      "The history daemon serves API version \(version); Brim reads version "
        + "\(HistoryClient.supportedAPIVersion)."
    }
  }

  /// The command that usually fixes this, shown under the error.
  public var fixCommand: String? {
    switch self {
    case .daemonNotRunning:
      "toolkit history daemon install"
    case .connectionFailed:
      "toolkit history daemon status"
    case let .server(status, _) where status >= 500:
      "toolkit history daemon status"
    case .server, .malformedHTTP, .decoding, .unsupportedAPIVersion:
      nil
    }
  }

  /// One sentence on what the fix command does.
  public var recoverySuggestion: String? {
    switch self {
    case .daemonNotRunning:
      "Install and start the daemon's LaunchAgent, then refresh."
    case .connectionFailed, .server:
      fixCommand.map { _ in "Check the daemon's state and logs under ~/.toolkit/history/logs." }
    case .malformedHTTP, .decoding, .unsupportedAPIVersion:
      "Install toolkit (packages/toolkit: bun run install:local) and Brim from the same "
        + "revision, then restart the daemon."
    }
  }
}
