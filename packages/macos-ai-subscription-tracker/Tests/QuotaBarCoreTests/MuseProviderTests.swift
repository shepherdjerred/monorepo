import Foundation
import XCTest

@testable import QuotaBarCore

final class MuseProviderTests: XCTestCase {
  func testMuseParsesWindowAndWeeklyPools() throws {
    let now = date("2026-09-20T12:00:00Z")
    let snapshot = try MuseProvider.parse(data: fixture("muse-usage-success"), now: now)

    XCTAssertEqual(snapshot.provider, .muse)
    XCTAssertEqual(snapshot.accountLabel, "Muse Code High Usage")
    XCTAssertEqual(snapshot.windows.map(\.label), ["5-hour", "Weekly"])
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [62, 25])
    XCTAssertEqual(snapshot.windows[0].resetAt, date("2026-09-20T17:00:00Z"))
    XCTAssertEqual(snapshot.windows[1].resetAt, date("2026-09-22T00:00:00Z"))
    XCTAssertEqual(snapshot.sourceTimestamp, now)
    XCTAssertTrue(
      snapshot.notes.contains(
        "Uses the signed-in Muse CLI without reading or storing its token."))
  }

  func testMuseMissingAllowanceIsCredentialsMissing() {
    let signedOut = Data(
      #"{"schemaVersion":1,"allowance":null,"reason":"not_signed_in","hint":null}"#.utf8)
    XCTAssertThrowsError(try MuseProvider.parse(data: signedOut)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
    XCTAssertThrowsError(try MuseProvider.parse(data: Data("not-json".utf8))) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
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

  func testMuseFetchNonZeroExitIsCredentialsMissing() async {
    let runner = StubCommandRunner(
      result: .success(CommandResult(stdout: Data(), terminationStatus: 1)))
    let provider = MuseProvider(
      commandRunner: runner, executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/muse"))
    do {
      _ = try await provider.fetch()
      XCTFail("Expected credentialsMissing")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
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
  }

  let result: Result<CommandResult, QuotaError>
  private(set) var calls: [Call] = []

  init(result: Result<CommandResult, QuotaError>) {
    self.result = result
  }

  func run(executableURL: URL, arguments: [String]) throws -> CommandResult {
    calls.append(Call(executableURL: executableURL, arguments: arguments))
    return try result.get()
  }
}
