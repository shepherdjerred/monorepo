import Foundation
import XCTest

@testable import QuotaBarCore

final class MuseProviderTests: XCTestCase {
  func testMuseParsesWindowAndWeeklyPools() throws {
    let now = date("2026-09-20T12:00:00Z")
    let snapshot = try MuseProvider.parse(data: fixture("muse-usage-success"), now: now)

    XCTAssertEqual(snapshot.provider, .muse)
    XCTAssertEqual(snapshot.plan?.name, "Muse Code High Usage")
    XCTAssertNil(snapshot.accountLabel)
    XCTAssertEqual(snapshot.windows.map(\.label), ["5-hour", "Weekly"])
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [62, 25])
    XCTAssertEqual(snapshot.windows[0].resetAt, date("2026-09-20T17:00:00Z"))
    XCTAssertEqual(snapshot.windows[1].resetAt, date("2026-09-22T00:00:00Z"))
    XCTAssertEqual(snapshot.sourceTimestamp, now)
    XCTAssertTrue(
      snapshot.notes.contains(
        "Uses the signed-in Muse CLI without reading or storing its token."))
  }

  func testMuseExplicitSignInFailure() {
    let signedOut = Data(
      #"{"schemaVersion":1,"allowance":null,"reason":"not_signed_in","hint":null}"#.utf8)
    XCTAssertThrowsError(try MuseProvider.parse(data: signedOut)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsExpired(.muse))
    }
    XCTAssertThrowsError(try MuseProvider.parse(data: Data("not-json".utf8))) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
  }

  func testMuseServerSentNoUsageReturnsZeroUsageWindows() throws {
    let noUsage = Data(
      (#"{"schemaVersion":1,"allowance":null,"reason":"server_sent_no_usage","#
        + #""hint":"the server sent no usage data for this subscription"}"#).utf8)
    let snapshot = try MuseProvider.parse(data: noUsage)
    XCTAssertEqual(snapshot.windows.map(\.label), ["5-hour", "Weekly"])
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [0, 0])
    XCTAssertTrue(
      snapshot.notes.contains("Uses the signed-in Muse CLI without reading or storing its token."))
  }

  func testMuseLocateExecutableIgnoresAgentBin() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let agentBin = root.appendingPathComponent(".local/share/agent-bin")
    let realBin = root.appendingPathComponent("bin")
    try FileManager.default.createDirectory(at: agentBin, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: realBin, withIntermediateDirectories: true)
    let fakeWrapper = agentBin.appendingPathComponent("muse")
    let fakeReal = realBin.appendingPathComponent("muse")
    FileManager.default.createFile(
      atPath: fakeWrapper.path, contents: Data("fake".utf8),
      attributes: [.posixPermissions: 0o755])
    FileManager.default.createFile(
      atPath: fakeReal.path, contents: Data("fake".utf8),
      attributes: [.posixPermissions: 0o755])

    let environment = ["PATH": "\(agentBin.path):\(realBin.path)"]
    let located = try MuseProvider.locateExecutable(environment: environment, homeDirectory: root)
    XCTAssertEqual(located.path, fakeReal.path)
  }

  func testMuseDropsWindowsWithoutUsablePercentages() throws {
    let snapshot = try MuseProvider.parse(data: museUsage(windowUsed: 62, weeklyUsed: nil))
    XCTAssertEqual(snapshot.windows.map(\.label), ["5-hour"])
  }

  func testMuseRejectsPresentButUnusableValues() {
    // A present negative percentage fails loudly instead of dropping the window.
    XCTAssertThrowsError(try MuseProvider.parse(data: museUsage(windowUsed: -5))) { error in
      XCTAssertEqual(error as? QuotaValidationError, .invalidPercentage)
    }
    // A present percentage with an unexpected type surfaces provider drift as malformed.
    let stringPercent = Data(
      (#"{"schemaVersion":1,"allowance":{"tier":"Muse Code High Usage","#
        + #""window":{"usedPercent":"62","resetsAtMs":1789923600000},"#
        + #""weekly":{"usedPercent":25,"resetsAtMs":1790035200000}}}"#).utf8)
    XCTAssertThrowsError(try MuseProvider.parse(data: stringPercent)) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
  }

  func testMuseAcceptsFloatPercentages() throws {
    let snapshot = try MuseProvider.parse(data: museUsage(windowUsed: 62.5))
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [62.5, 25])
  }

  func testMuseOverQuotaClampsToFullWithNote() throws {
    let snapshot = try MuseProvider.parse(data: museUsage(windowUsed: 142))
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [100, 25])
    XCTAssertTrue(
      snapshot.notes.contains("Muse reports over-quota usage; shown as fully used."))
  }

  func testMuseAllowanceWithoutPoolsIsUnsupported() {
    let empty = Data(
      #"{"schemaVersion":1,"allowance":{"tier":"Muse Code High Usage"}}"#.utf8)
    XCTAssertThrowsError(try MuseProvider.parse(data: empty)) { error in
      XCTAssertEqual(error as? QuotaError, .unsupportedResponse(.muse))
    }
  }

  func testMuseFetchRunsUsageJSON() async throws {
    let executable = URL(fileURLWithPath: "/opt/homebrew/bin/muse")
    let runner = StubCommandRunner(
      result: .success(
        CommandResult(stdout: fixture("muse-usage-success"), terminationStatus: 0)))
    let snapshot = try await MuseProvider(commandRunner: runner, executableURL: executable)
      .fetch()

    XCTAssertEqual(snapshot.provider, .muse)
    let calls = await runner.calls
    XCTAssertEqual(calls.map(\.executableURL), [executable])
    XCTAssertEqual(calls.map(\.arguments), [["usage", "--json"]])
  }

  func testMuseFetchNonZeroExitWithoutReasonIsCommandFailure() async {
    let runner = StubCommandRunner(
      result: .success(CommandResult(stdout: Data(), terminationStatus: 1)))
    let provider = MuseProvider(
      commandRunner: runner, executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/muse"))
    do {
      _ = try await provider.fetch()
      XCTFail("Expected providerCommandFailed")
    } catch {
      XCTAssertEqual(error as? QuotaError, .providerCommandFailed(.muse))
    }
  }

  func testMuseRecoveryOnlyUsesModelAfterExplicitAuthFailure() async throws {
    let allowance = fixture("muse-usage-success")
    let healthy = CommandResult(stdout: allowance, terminationStatus: 0)
    let authFailure = CommandResult(
      stdout: Data(#"{"allowance":null,"reason":"not_signed_in"}"#.utf8), terminationStatus: 1)
    let recovery = CommandResult(stdout: Data(), terminationStatus: 0)
    let runner = StubCommandRunner(results: [authFailure, recovery, healthy, healthy])
    let provider = MuseProvider(
      commandRunner: runner, executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/muse"))

    _ = try await provider.recoverSignIn()
    _ = try await provider.recoverSignIn()
    let calls = await runner.calls
    XCTAssertEqual(calls.map { $0.arguments.first }, ["usage", "exec", "usage", "usage"])
    let turn = try XCTUnwrap(calls.first { $0.arguments.first == "exec" })
    let directory = try XCTUnwrap(turn.workingDirectory)
    XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    XCTAssertTrue(turn.arguments.contains("--max-model-steps"))
    XCTAssertTrue(turn.arguments.contains("--disable-shell"))
  }

  func testMuseExecutableDiscoveryUsesPathWithoutShell() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let executable = root.appendingPathComponent("bin/muse")
    try write("#!/bin/sh\n", to: executable)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o755],
      ofItemAtPath: executable.path
    )

    XCTAssertEqual(
      try MuseProvider.locateExecutable(
        environment: ["PATH": executable.deletingLastPathComponent().path],
        homeDirectory: root
      ).standardizedFileURL,
      executable.standardizedFileURL
    )
  }
}

private func museUsage(windowUsed: Double? = 62, weeklyUsed: Double? = 25) -> Data {
  let windowPercent = windowUsed.map { "\"usedPercent\":\($0)," } ?? ""
  let weeklyPercent = weeklyUsed.map { "\"usedPercent\":\($0)," } ?? ""
  let body =
    "{\"schemaVersion\":1,\"allowance\":{\"tier\":\"Muse Code High Usage\","
    + "\"window\":{\(windowPercent)\"resetsAtMs\":1789923600000},"
    + "\"weekly\":{\(weeklyPercent)\"resetsAtMs\":1790035200000},"
    + "\"asOfMs\":1789920000000,\"source\":\"mint\"},\"reason\":null,\"hint\":null}"
  return Data(body.utf8)
}

private actor StubCommandRunner: CommandRunning {
  struct Call: Sendable {
    let executableURL: URL
    let arguments: [String]
    let workingDirectory: URL?
  }

  private var results: [Result<CommandResult, QuotaError>]
  private(set) var calls: [Call] = []

  init(result: Result<CommandResult, QuotaError>) {
    results = [result]
  }

  init(results: [CommandResult]) {
    self.results = results.map { .success($0) }
  }

  func run(executableURL: URL, arguments: [String], workingDirectory: URL?) throws -> CommandResult
  {
    calls.append(
      Call(executableURL: executableURL, arguments: arguments, workingDirectory: workingDirectory))
    guard !results.isEmpty else { throw QuotaError.providerCommandFailed(.muse) }
    return try results.removeFirst().get()
  }
}
