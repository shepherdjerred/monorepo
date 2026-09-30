import Foundation
import XCTest

@testable import QuotaBarCore

final class ClaudeCodeKeychainTests: XCTestCase {
  func testReadsThroughTheSecurityToolTheKeychainAlreadyTrusts() throws {
    let runner = StubCommandRunner(stdout: "token-payload\n", terminationStatus: 0)
    let client = SecurityToolKeychainClient(commandRunner: runner)

    let data = try client.read(service: "Claude Code-credentials", account: nil)

    XCTAssertEqual(data.flatMap { String(bytes: $0, encoding: .utf8) }, "token-payload")
    XCTAssertEqual(runner.invocation?.executableURL.path, "/usr/bin/security")
    XCTAssertEqual(
      runner.invocation?.arguments,
      ["find-generic-password", "-w", "-s", "Claude Code-credentials"]
    )
  }

  func testNarrowsTheQueryWhenAnAccountIsRequested() throws {
    let runner = StubCommandRunner(stdout: "token-payload", terminationStatus: 0)
    let client = SecurityToolKeychainClient(commandRunner: runner)

    _ = try client.read(service: "Claude Code-credentials", account: "jerred")

    XCTAssertEqual(
      runner.invocation?.arguments,
      ["find-generic-password", "-w", "-s", "Claude Code-credentials", "-a", "jerred"]
    )
  }

  func testOnlyItemNotFoundReadsAsAbsent() throws {
    // 44 is `errSecItemNotFound` through the exit status' low byte.
    let client = SecurityToolKeychainClient(
      commandRunner: StubCommandRunner(stdout: "", terminationStatus: 44)
    )

    XCTAssertNil(try client.read(service: "Claude Code-credentials", account: nil))
  }

  func testLockedKeychainFailsInsteadOfReadingAsAbsent() {
    // 36 is `errSecInteractionNotAllowed`: the credential exists but this Mac will not hand it
    // over. Reading that as absent would report "no local credentials" for a locked Keychain.
    let client = SecurityToolKeychainClient(
      commandRunner: StubCommandRunner(stdout: "", terminationStatus: 36)
    )

    XCTAssertThrowsError(try client.read(service: "Claude Code-credentials", account: nil)) {
      XCTAssertEqual($0 as? QuotaError, .commandFailed("security"))
    }
  }

  func testUnexpectedStatusFailsLoudly() {
    let client = SecurityToolKeychainClient(
      commandRunner: StubCommandRunner(stdout: "", terminationStatus: 1)
    )

    XCTAssertThrowsError(try client.read(service: "Claude Code-credentials", account: nil)) {
      XCTAssertEqual($0 as? QuotaError, .commandFailed("security"))
    }
  }

  func testEmptyPayloadReadsAsAbsent() throws {
    let client = SecurityToolKeychainClient(
      commandRunner: StubCommandRunner(stdout: "\n", terminationStatus: 0)
    )

    XCTAssertNil(try client.read(service: "Claude Code-credentials", account: nil))
  }

  func testClaudeCredentialsResolveWithoutTouchingTheSecurityFramework() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let runner = StubCommandRunner(
      stdout: #"{"claudeAiOauth":{"accessToken":"security-tool-token"}}"#,
      terminationStatus: 0
    )
    let store = LocalCredentialStore(
      homeDirectory: root,
      claudeKeychain: SecurityToolKeychainClient(commandRunner: runner)
    )

    let credential = try store.credential(for: .claudeCode, rejecting: nil)

    XCTAssertEqual(credential.accessToken, "security-tool-token")
    XCTAssertEqual(runner.invocation?.executableURL.path, "/usr/bin/security")
  }
}

private final class StubCommandRunner: SynchronousCommandRunning, @unchecked Sendable {
  struct Invocation: Equatable {
    let executableURL: URL
    let arguments: [String]
  }

  private let lock = NSLock()
  private let result: CommandResult
  private var recorded: Invocation?

  init(stdout: String, terminationStatus: Int32) {
    result = CommandResult(stdout: Data(stdout.utf8), terminationStatus: terminationStatus)
  }

  var invocation: Invocation? { lock.withLock { recorded } }

  func run(executableURL: URL, arguments: [String]) throws -> CommandResult {
    lock.withLock {
      recorded = Invocation(executableURL: executableURL, arguments: arguments)
    }
    return result
  }
}
