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
      executableURL: executable,
      planSource: StubPlanSource(.success(fixture("antigravity-code-assist")))
    ).fetch()
    XCTAssertEqual(snapshot.provider, .antigravity)
    XCTAssertEqual(snapshot.plan?.name, "Google AI Pro")
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
      try await AntigravityProvider(
        commandRunner: failed, executableURL: executable,
        planSource: StubPlanSource(.success(Data()))
      ).fetch()
    }
    let timeout = StubCommandRunner(result: .failure(.requestTimedOut(.antigravity)))
    do {
      _ = try await AntigravityProvider(
        commandRunner: timeout, executableURL: executable,
        planSource: StubPlanSource(.success(Data()))
      ).fetch()
      XCTFail("Expected timeout")
    } catch {
      XCTAssertEqual(error as? QuotaError, .requestTimedOut(.antigravity))
    }
  }

  func testAntigravityPlanFailureKeepsUsageAndSaysWhy() async throws {
    let runner = StubCommandRunner(
      result: .success(CommandResult(stdout: fixture("antigravity-success"), terminationStatus: 0))
    )
    let snapshot = try await AntigravityProvider(
      commandRunner: runner,
      executableURL: URL(fileURLWithPath: "/test/agy"),
      planSource: StubPlanSource(.failure(.unauthorized(.antigravity)))
    ).fetch()
    XCTAssertFalse(snapshot.windows.isEmpty)
    XCTAssertNil(snapshot.plan)
    XCTAssertTrue(snapshot.notes.contains { $0.hasPrefix("Plan unavailable:") })
  }

  func testAntigravityPlanPrefersPaidTierOverFreeTier() throws {
    XCTAssertEqual(
      try AntigravityProvider.parsePlan(data: fixture("antigravity-code-assist"))?.name,
      "Google AI Pro")
    XCTAssertEqual(
      try AntigravityProvider.parsePlan(
        data: Data(#"{"currentTier":{"id":"free-tier","name":"Antigravity"}}"#.utf8))?.name,
      "Antigravity")
    XCTAssertNil(try AntigravityProvider.parsePlan(data: Data("{}".utf8)))
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

  func testFoundationCommandRunnerTerminatesCancelledProcess() async throws {
    let task = Task {
      try await FoundationCommandRunner().run(
        executableURL: URL(fileURLWithPath: "/bin/sh"),
        arguments: ["-c", "sleep 5"]
      )
    }
    try await Task.sleep(for: .milliseconds(100))
    task.cancel()

    do {
      _ = try await task.value
      XCTFail("Expected cancellation")
    } catch is CancellationError {
      // Expected: cancellation terminates the child process.
    }
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
    let transport = RoutingTransport(routes: [
      endpoints.cursorUsage.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("cursor-success"))),
      endpoints.cursorPlan.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("cursor-plan"))),
    ])
    let provider = CursorProvider(
      client: ProviderHTTPClient(
        transport: transport,
        credentials: StubCredentialStore(tokens: ["cursor-local-token"])
      ),
      endpoint: endpoints.cursorUsage,
      planEndpoint: endpoints.cursorPlan
    )

    let snapshot = try await provider.fetch()

    XCTAssertEqual(snapshot.plan, PlanInfo(name: "Pro", monthlyCostUSD: 20))
    let requests = await transport.requests
    XCTAssertEqual(Set(requests.map(\.url)), [endpoints.cursorUsage, endpoints.cursorPlan])
    for request in requests {
      XCTAssertEqual(request.method, .post)
      XCTAssertEqual(request.body, Data("{}".utf8))
      XCTAssertEqual(request.headers["Content-Type"], "application/json")
      XCTAssertEqual(request.headers["Connect-Protocol-Version"], "1")
      XCTAssertEqual(request.bearerToken, "cursor-local-token")
      XCTAssertFalse(request.description.contains("cursor-local-token"))
      XCTAssertFalse(request.description.contains("{}"))
    }
  }

  func testCursorPlanFailureKeepsUsageAndSaysWhy() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let provider = CursorProvider(
      client: ProviderHTTPClient(
        transport: RoutingTransport(routes: [
          endpoints.cursorUsage.absoluteString: .success(
            ProviderResponse(statusCode: 200, data: fixture("cursor-success"))),
          endpoints.cursorPlan.absoluteString: .success(
            ProviderResponse(statusCode: 401, data: Data())),
        ]),
        credentials: StubCredentialStore(tokens: ["token"])
      ),
      endpoint: endpoints.cursorUsage,
      planEndpoint: endpoints.cursorPlan
    )

    let snapshot = try await provider.fetch()

    XCTAssertEqual(snapshot.windows.count, 2)
    XCTAssertEqual(snapshot.freshness, .current)
    XCTAssertNil(snapshot.plan)
    XCTAssertTrue(snapshot.notes.contains { $0.hasPrefix("Plan unavailable:") })
  }

  func testCursorPlanPriceParsesOnlyMonthlyDollars() throws {
    func plan(_ price: String) throws -> PlanInfo? {
      try CursorProvider.parsePlan(
        data: Data(#"{"planInfo":{"planName":"Pro","price":"\#(price)"}}"#.utf8))
    }
    XCTAssertEqual(try plan("$20/mo")?.monthlyCostUSD, 20)
    XCTAssertNil(try plan("$20/yr")?.monthlyCostUSD)
    XCTAssertNil(try plan("€20/mo")?.monthlyCostUSD)
    XCTAssertEqual(try plan("custom")?.name, "Pro")
    XCTAssertNil(try CursorProvider.parsePlan(data: Data(#"{"planInfo":{"planName":" "}}"#.utf8)))
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
    let planEndpoint = try XCTUnwrap(URL(string: "https://example.com/cursor-plan"))
    let unauthorized = CursorProvider(
      client: ProviderHTTPClient(
        transport: RoutingTransport(routes: [
          endpoint.absoluteString: .success(ProviderResponse(statusCode: 401, data: Data()))
        ]),
        credentials: StubCredentialStore(tokens: ["token"])
      ),
      endpoint: endpoint,
      planEndpoint: planEndpoint
    )
    do {
      _ = try await unauthorized.fetch()
      XCTFail("Expected unauthorized")
    } catch {
      XCTAssertEqual(error as? QuotaError, .unauthorized(.cursor))
    }

    let timedOut = CursorProvider(
      client: ProviderHTTPClient(
        transport: RoutingTransport(routes: [
          endpoint.absoluteString: .failure(.requestTimedOut(.cursor))
        ]),
        credentials: StubCredentialStore(tokens: ["token"])
      ),
      endpoint: endpoint,
      planEndpoint: planEndpoint
    )
    do {
      _ = try await timedOut.fetch()
      XCTFail("Expected timeout")
    } catch {
      XCTAssertEqual(error as? QuotaError, .requestTimedOut(.cursor))
    }
  }
}

private struct StubPlanSource: AntigravityPlanFetching {
  let result: Result<Data, QuotaError>
  init(_ result: Result<Data, QuotaError>) { self.result = result }
  func codeAssistData() async throws -> Data { try result.get() }
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
