import Foundation
import XCTest

@testable import QuotaBarCore

final class PlanTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1_786_000_000)

  func testHumanizedPlanNames() {
    XCTAssertEqual(PlanName.humanized("claude_max_20x", droppingPrefix: "claude"), "Max 20x")
    XCTAssertEqual(PlanName.humanized("claude_pro", droppingPrefix: "claude"), "Pro")
    XCTAssertEqual(PlanName.humanized("pro"), "Pro")
    XCTAssertEqual(PlanName.humanized("PLUS"), "Plus")
    // The prefix is dropped only when something remains after it.
    XCTAssertEqual(PlanName.humanized("claude", droppingPrefix: "claude"), "Claude")
    XCTAssertNil(PlanName.humanized(""))
    XCTAssertNil(PlanName.humanized(nil))
    XCTAssertNil(PlanInfo(name: "  "))
  }

  func testClaudePlanComesFromTheResetBlockTier() throws {
    let snapshot = try ClaudeCodeProvider.parse(
      data: Data(
        #"""
        {
          "five_hour": {"utilization": 10, "resets_at": "2026-08-09T05:00:00Z"},
          "cedar_ember": {
            "eligible": false, "ineligible_reason": "no_grant", "grants": [],
            "event_props": {"surface": "claude_code_cli", "tier": "claude_max_20x"}
          }
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(snapshot.plan?.name, "Max 20x")
    XCTAssertNil(snapshot.plan?.monthlyCostUSD)
    // No tier: no plan, and the usage is unaffected.
    XCTAssertNil(try ClaudeCodeProvider.parse(data: fixture("claude-success"), now: now).plan)
  }

  func testCodexPlanComesFromPlanType() throws {
    let snapshot = try CodexProvider.parse(data: fixture("codex-success"), now: now)
    XCTAssertEqual(snapshot.plan?.name, "Pro")
  }

  func testGrokPlanComesFromSettings() throws {
    XCTAssertEqual(try GrokProvider.parsePlan(data: fixture("grok-settings"))?.name, "SuperGrok")
    XCTAssertNil(try GrokProvider.parsePlan(data: Data("{}".utf8)))
    XCTAssertEqual(try KimiProvider.parsePlan(data: fixture("kimi-me"))?.name, "Pro")
  }

  func testStaleAndCopiedSnapshotsKeepThePlan() throws {
    let window = try UsageWindow.validated(
      id: "w", label: "Weekly", kind: .weekly, usedPercent: 5, resetAt: nil, sourceTimestamp: now)
    let snapshot = UsageSnapshot(
      provider: .cursor, plan: PlanInfo(name: "Pro", monthlyCostUSD: 20), windows: [window],
      sourceTimestamp: now)
    XCTAssertEqual(snapshot.markedStale(reason: "offline").plan, snapshot.plan)
    XCTAssertEqual(snapshot.replacing(windows: []).plan, snapshot.plan)
    XCTAssertEqual(
      snapshot.replacing(appendingNotes: ["Plan unavailable: x"]).notes, ["Plan unavailable: x"])
  }

  func testCacheWrittenBeforePlansStillDecodes() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("snapshots.json")
    let window = try UsageWindow.validated(
      id: "w", label: "Weekly", kind: .weekly, usedPercent: 5, resetAt: nil, sourceTimestamp: now)
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: JSONEncoder().encode([
          UsageSnapshot(provider: .codex, windows: [window], sourceTimestamp: now)
        ])) as? [[String: Any]])
    object[0].removeValue(forKey: "plan")
    try JSONSerialization.data(withJSONObject: object).write(to: url)

    let loaded = try JSONSnapshotStore(url: url).load()

    XCTAssertNil(loaded[.codex]?.plan)
    XCTAssertEqual(loaded[.codex]?.windows, [window])
  }

  func testSlowPlanRequestBecomesANoteInsteadOfDelayingUsage() async {
    let slow = await capturePlanSurface(within: .milliseconds(50)) {
      try await Task.sleep(for: .seconds(30))
      return Data()
    }
    guard case let .failure(message) = slow else {
      XCTFail("Expected the deadline")
      return
    }
    let outcome = PlanOutcome(slow) { _ in PlanInfo(name: "unused") }
    XCTAssertNil(outcome.plan)
    XCTAssertEqual(outcome.notes, ["Plan unavailable: \(message)"])

    let fast = await capturePlanSurface(within: .seconds(5)) { Data("{}".utf8) }
    guard case .success = fast else {
      XCTFail("Expected the plan")
      return
    }
  }

  func testReportedPriceOverridesTheTable() throws {
    let window = try UsageWindow.validated(
      id: "w", label: "Weekly", kind: .weekly, usedPercent: 5, resetAt: nil, sourceTimestamp: now)
    let cursor = UsageSnapshot(
      provider: .cursor, plan: PlanInfo(name: "Pro+", monthlyCostUSD: 60), windows: [window],
      sourceTimestamp: now)
    XCTAssertEqual(SubscriptionPlan.monthlyCostUSD(for: .cursor, snapshot: cursor), 60)
    XCTAssertEqual(SubscriptionPlan.monthlyCostUSD(for: .cursor, snapshot: nil), 20)
    XCTAssertEqual(
      SubscriptionPlan.totalMonthlyCostUSD(snapshots: [.cursor: cursor]),
      SubscriptionPlan.totalMonthlyCostUSD() + 40)
  }
}
