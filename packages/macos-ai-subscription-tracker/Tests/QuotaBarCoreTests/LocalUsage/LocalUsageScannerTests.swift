import Foundation
import XCTest

@testable import QuotaBarCore

final class LocalLogLocationTests: XCTestCase {
  func testClaudeConfigDirReplacesTheDefaultProjectRoots() {
    let home = URL(fileURLWithPath: "/home/tester")
    XCTAssertEqual(
      LocalLogLocations.claudeProjectRoots(environment: [:], home: home).map(\.path),
      ["/home/tester/.claude/projects", "/home/tester/.config/claude/projects"]
    )
    XCTAssertEqual(
      LocalLogLocations.claudeProjectRoots(
        environment: ["CLAUDE_CONFIG_DIR": "/tmp/claude, ~/already/projects, ,"],
        home: home
      ).map(\.path),
      ["/tmp/claude/projects", "/home/tester/already/projects"]
    )
  }

  func testCodexHomeAppendsSessions() {
    let home = URL(fileURLWithPath: "/home/tester")
    XCTAssertEqual(
      LocalLogLocations.codexSessionRoots(environment: [:], home: home).map(\.path),
      ["/home/tester/.codex/sessions"]
    )
    XCTAssertEqual(
      LocalLogLocations.codexSessionRoots(
        environment: ["CODEX_HOME": "/tmp/codex,~/codex"],
        home: home
      ).map(\.path),
      ["/tmp/codex/sessions", "/home/tester/codex/sessions"]
    )
  }
}

final class LocalUsageScannerTests: XCTestCase {
  private let now = date("2026-11-01T18:00:00Z")

  func testScanOmitsAMissingLogDirectory() {
    let home = URL(fileURLWithPath: "/tmp/quotabar-missing-\(UUID().uuidString)")
    let usage = LocalUsageScanner.scan(
      now: now,
      timeZone: utcTimeZone(),
      environment: [:],
      home: home,
      catalog: scannerCatalog()
    )
    XCTAssertTrue(usage.isEmpty)
  }

  func testScanKeepsTodayAndReportsAnUnreadableFile() throws {
    let home = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: home) }
    let claude = home.appendingPathComponent(".claude/projects/session/today.jsonl")
    try write(fixtureText("claude-local-usage", ext: "jsonl"), to: claude)
    try touch(claude, at: now)
    let stale = home.appendingPathComponent(".claude/projects/session/stale.jsonl")
    try write(assistant(input: 50_000), to: stale)
    try touch(stale, at: date("2026-10-31T12:00:00Z"))
    let broken = home.appendingPathComponent(".claude/projects/session/broken.jsonl")
    try write(
      #"{"type":"assistant","timestamp":"2026-11-01T06:00:00Z","requestId":"bad","#
        + #""message":{"id":"bad","model":"claude-sonnet-5-5","usage":{"input_tokens":true}}}"#,
      to: broken
    )
    try touch(broken, at: now)

    let codexRoot = home.appendingPathComponent(".codex/sessions")
    let codex = codexRoot.appendingPathComponent("today.jsonl")
    try write(fixtureText("codex-local-usage", ext: "jsonl"), to: codex)
    try touch(codex, at: now)
    let archived = codexRoot.appendingPathComponent("archived_sessions/skip.jsonl")
    try write(codexBurst(total: 9_000_000), to: archived)
    try touch(archived, at: now)

    let usage = LocalUsageScanner.scan(
      now: now,
      timeZone: utcTimeZone(),
      environment: [:],
      home: home,
      catalog: scannerCatalog()
    )
    let claudeUsage = try XCTUnwrap(usage[.claudeCode])
    XCTAssertTrue(claudeUsage.unreadable)
    XCTAssertEqual(claudeUsage.totalTokens, 1650 + 52 + 20 + 10 + 3)
    XCTAssertNil(claudeUsage.estimatedCostUSD)
    XCTAssertEqual(claudeUsage.unpricedModels, ["mystery-model"])
    let codexUsage = try XCTUnwrap(usage[.codex])
    XCTAssertFalse(codexUsage.unreadable)
    XCTAssertEqual(codexUsage.totalTokens, 35 + 48)
    XCTAssertNotNil(codexUsage.estimatedCostUSD)
  }

  func testConfiguredClaudeDirectoryReplacesTheHomeLogs() throws {
    let home = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: home) }
    let ignored = home.appendingPathComponent(".claude/projects/session/ignored.jsonl")
    try write(assistant(input: 40_000), to: ignored)
    try touch(ignored, at: now)
    let configured = home.appendingPathComponent("custom/projects/used.jsonl")
    try write(assistant(input: 25), to: configured)
    try touch(configured, at: now)

    let usage = LocalUsageScanner.scan(
      now: now,
      timeZone: utcTimeZone(),
      environment: ["CLAUDE_CONFIG_DIR": home.appendingPathComponent("custom").path],
      home: home,
      catalog: scannerCatalog()
    )
    XCTAssertEqual(usage[.claudeCode]?.totalTokens, 25)
    XCTAssertNil(usage[.codex])
  }

  private func touch(_ url: URL, at date: Date) throws {
    try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path)
  }

  private func assistant(input: Int) -> String {
    """
    {"type":"assistant","uuid":"\(UUID().uuidString)","timestamp":"2026-11-01T08:00:00Z",\
    "requestId":"req","message":{"id":"msg","model":"claude-sonnet-5-5",\
    "usage":{"input_tokens":\(input),"output_tokens":0}}}
    """
  }

  private func codexBurst(total: Int) -> String {
    """
    {"type":"token_count","timestamp":"2026-11-01T08:00:00Z","ordinal":1,\
    "payload":{"info":{"last_token_usage":{"input_tokens":\(total),"cached_input_tokens":0,\
    "cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":\(total)},\
    "total_token_usage":{"input_tokens":\(total),"cached_input_tokens":0,\
    "cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":\(total)}}}}
    """
  }
}

private func scannerCatalog() -> PricingCatalog {
  PricingCatalog(
    fetchedOn: "2026-11-01",
    prices: [
      "claude-sonnet-5-5": ModelTokenPrice(
        input: decimal("2"), output: decimal("10"), cacheCreate: decimal("2.5"),
        cacheRead: decimal("0.1")),
      "claude-opus-5-5": ModelTokenPrice(
        input: decimal("4"), output: decimal("20"), cacheCreate: decimal("5"),
        cacheRead: decimal("0.2")),
      "claude-haiku-5-5": ModelTokenPrice(
        input: decimal("0.1"), output: decimal("0.5"), cacheCreate: decimal("0.125"),
        cacheRead: decimal("0.01")),
      "gpt-6.1-sol": ModelTokenPrice(
        input: decimal("2"), output: decimal("10"), cacheCreate: decimal("2.5"),
        cacheRead: decimal("0.1")),
    ]
  )
}
