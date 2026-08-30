import Foundation
import XCTest

@testable import QuotaBarCore

final class AntigravityCursorProviderTests: XCTestCase {
  func testAntigravityParsesExactPoolsInDisplayOrder() throws {
    let now = date("2026-08-30T20:00:00Z")
    let snapshot = try AntigravityProvider.parse(data: fixture("antigravity-success"), now: now)

    XCTAssertEqual(snapshot.provider, .antigravity)
    XCTAssertEqual(
      snapshot.windows.map(\.label),
      ["Gemini 5-hour", "Gemini weekly", "Claude/GPT 5-hour", "Claude/GPT weekly"]
    )
    for (actual, expected) in zip(snapshot.windows.compactMap(\.usedPercent), [60, 25, 35, 10]) {
      XCTAssertEqual(actual, Double(expected), accuracy: 0.0001)
    }
    XCTAssertEqual(snapshot.windows[0].resetAt, date("2026-08-30T22:00:00Z"))
    XCTAssertEqual(snapshot.sourceTimestamp, now)
  }

  func testAntigravityRejectsAmbiguousMissingAndMalformedResponses() {
    let changedCommand = Data(
      #"{"status":"SUCCESS","command":{"name":"chat","data":{"groups":[]}},"num_turns":0}"#
        .utf8)
    XCTAssertThrowsError(try AntigravityProvider.parse(data: changedCommand)) { error in
      XCTAssertEqual(error as? QuotaError, .unsupportedResponse(.antigravity))
    }

    let missingBucket = Data(
      #"""
      {
        "status": "SUCCESS",
        "command": {
          "name": "usage",
          "data": {
            "groups": [
              {"name": "Gemini Models", "buckets": []},
              {"name": "Claude and GPT models", "buckets": []}
            ]
          }
        },
        "num_turns": 0
      }
      """#.utf8
    )
    XCTAssertThrowsError(try AntigravityProvider.parse(data: missingBucket))
    XCTAssertThrowsError(try AntigravityProvider.parse(data: Data("not-json".utf8))) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.antigravity))
    }
  }

  func testAntigravityRunsZeroTurnUsageCommandAndPropagatesFailures() async throws {
    let executable = URL(fileURLWithPath: "/test/agy")
    let runner = StubCommandRunner(
      result: .success(CommandResult(stdout: fixture("antigravity-success"), terminationStatus: 0))
    )
    let snapshot = try await AntigravityProvider(
      commandRunner: runner,
      executableURL: executable
    ).fetch()
    XCTAssertEqual(snapshot.provider, .antigravity)
    let calls = await runner.calls
    let call = try XCTUnwrap(calls.first)
    XCTAssertEqual(call.executableURL, executable)
    XCTAssertEqual(
      call.arguments,
      ["--print", "/usage", "--output-format", "json", "--print-timeout", "20s"]
    )

    let failed = StubCommandRunner(
      result: .success(CommandResult(stdout: Data(), terminationStatus: 1))
    )
    await XCTAssertThrowsErrorAsync {
      try await AntigravityProvider(commandRunner: failed, executableURL: executable).fetch()
    }
    let timeout = StubCommandRunner(result: .failure(.requestTimedOut(.antigravity)))
    do {
      _ = try await AntigravityProvider(commandRunner: timeout, executableURL: executable).fetch()
      XCTFail("Expected timeout")
    } catch {
      XCTAssertEqual(error as? QuotaError, .requestTimedOut(.antigravity))
    }
  }

  func testAntigravityExecutableDiscoveryUsesPathWithoutShell() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let executable = root.appendingPathComponent("bin/agy")
    try write("#!/bin/sh\n", to: executable)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o755],
      ofItemAtPath: executable.path
    )

    XCTAssertEqual(
      try AntigravityProvider.locateExecutable(
        environment: ["PATH": executable.deletingLastPathComponent().path],
        homeDirectory: root
      ).standardizedFileURL,
      executable.standardizedFileURL
    )
  }

  func testCursorParsesBothMonthlyPoolsAndBillingReset() throws {
    let now = date("2026-08-30T20:00:00Z")
    let snapshot = try CursorProvider.parse(data: fixture("cursor-success"), now: now)

    XCTAssertEqual(snapshot.provider, .cursor)
    XCTAssertEqual(snapshot.windows.map(\.label), ["Cursor Models", "Other Models"])
    XCTAssertEqual(snapshot.windows.map(\.usedPercent), [27.5, 63.25])
    XCTAssertEqual(
      snapshot.windows.map(\.resetAt),
      Array(repeating: Date(timeIntervalSince1970: 1_788_220_800), count: 2)
    )
    XCTAssertTrue(snapshot.notes.joined().contains("unsupported private client contract"))
  }

  func testCursorPostsConnectJSONWithLocalCredential() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 200, data: fixture("cursor-success")))
    ])
    let provider = CursorProvider(
      client: ProviderHTTPClient(
        transport: transport,
        credentials: StubCredentialStore(tokens: ["cursor-local-token"])
      ),
      endpoint: endpoints.cursorUsage
    )

    _ = try await provider.fetch()

    let requests = await transport.requests
    let request = try XCTUnwrap(requests.first)
    XCTAssertEqual(request.method, .post)
    XCTAssertEqual(request.body, Data("{}".utf8))
    XCTAssertEqual(request.headers["Content-Type"], "application/json")
    XCTAssertEqual(request.headers["Connect-Protocol-Version"], "1")
    XCTAssertFalse(request.description.contains("cursor-local-token"))
    XCTAssertFalse(request.description.contains("{}"))
  }

  func testCursorRejectsMissingPoolsInvalidResetsAuthenticationAndTimeouts() async throws {
    let missingPool = Data(
      #"{"enabled":true,"billingCycleEnd":"1788220800000","planUsage":{"autoPercentUsed":25}}"#
        .utf8)
    XCTAssertThrowsError(try CursorProvider.parse(data: missingPool))
    let invalidReset = Data(
      #"{"enabled":true,"billingCycleEnd":"later","planUsage":{"autoPercentUsed":25,"apiPercentUsed":50}}"#
        .utf8)
    XCTAssertThrowsError(try CursorProvider.parse(data: invalidReset))
    XCTAssertThrowsError(try CursorProvider.parse(data: Data("not-json".utf8))) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.cursor))
    }

    let endpoint = try XCTUnwrap(URL(string: "https://example.com/cursor"))
    let unauthorized = CursorProvider(
      client: ProviderHTTPClient(
        transport: StubTransport([.success(ProviderResponse(statusCode: 401, data: Data()))]),
        credentials: StubCredentialStore(tokens: ["token"])
      ),
      endpoint: endpoint
    )
    do {
      _ = try await unauthorized.fetch()
      XCTFail("Expected unauthorized")
    } catch {
      XCTAssertEqual(error as? QuotaError, .unauthorized(.cursor))
    }

    let timedOut = CursorProvider(
      client: ProviderHTTPClient(
        transport: StubTransport([.failure(.requestTimedOut(.cursor))]),
        credentials: StubCredentialStore(tokens: ["token"])
      ),
      endpoint: endpoint
    )
    do {
      _ = try await timedOut.fetch()
      XCTFail("Expected timeout")
    } catch {
      XCTAssertEqual(error as? QuotaError, .requestTimedOut(.cursor))
    }
  }
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
