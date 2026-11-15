import Foundation
import XCTest

@testable import QuotaBarCore

final class HistoryReportsTests: XCTestCase {
  func testDecodesTheSharedUsageReportFixture() throws {
    let report: HistoryPeriodUsageReport = try decode("usage-report", path: "/v1/usage")
    XCTAssertEqual(report.period, .week)
    XCTAssertEqual(report.timezone, "America/Los_Angeles")
    XCTAssertEqual(report.startOfWeek, .monday)
    XCTAssertEqual(report.breakdown, [.agent, .machine])
    XCTAssertEqual(report.since, date("2026-11-01T07:00:00Z"))
    XCTAssertNil(report.until)
    XCTAssertNil(report.filters.agent)
    XCTAssertNil(report.filters.source)
    XCTAssertEqual(report.total.measured.totalTokens, 249_750)
    XCTAssertEqual(report.total.measured.events, 6)
    XCTAssertEqual(report.total.measured.usage.costUSD, 3.22)
    XCTAssertFalse(report.total.measured.usage.costComplete)
    XCTAssertEqual(report.total.unpricedModels, ["gpt-preview-x"])
    XCTAssertEqual(report.periods.map(\.period), ["2026-11-02", "2026-11-09"])
    XCTAssertEqual(report.periods[1].start, date("2026-11-09T08:00:00Z"))
    XCTAssertEqual(report.periods[1].end, date("2026-11-16T08:00:00Z"))
    let rows = report.periods[1].breakdown
    XCTAssertEqual(rows.map(\.agent), [.claude, .codex, .claude])
    XCTAssertEqual(rows.map(\.machine), [nil, nil, "jerred-desktop"])
    XCTAssertEqual(rows[1].key(.agent), "codex")
    XCTAssertEqual(rows[2].key(.machine), "jerred-desktop")
    XCTAssertNil(rows[0].key(.model))
    XCTAssertNil(rows[0].key(.project))
    XCTAssertFalse(rows[1].measured.usage.costComplete)
  }

  func testDecodesTheSharedBlocksFixture() throws {
    let report: HistoryBlocksReport = try decode("blocks", path: "/v1/blocks")
    XCTAssertEqual(report.now, date("2026-11-13T23:10:00Z"))
    XCTAssertEqual(report.machine, "all")
    XCTAssertNil(report.agent)
    XCTAssertFalse(report.activeOnly)
    XCTAssertEqual(report.blocks.map(\.agent), [.claude, .claude, .codex])
    let active = report.blocks[1]
    XCTAssertTrue(active.isActive)
    XCTAssertTrue(active.alignedToQuota)
    XCTAssertEqual(active.machines, [nil, "jerred-desktop"])
    XCTAssertEqual(active.models, ["claude-haiku-5-5", "claude-opus-5-5"])
    XCTAssertEqual(active.measured.totalTokens, 144_910)
    XCTAssertEqual(active.measured.usage.costUSD, 2.2)
    let projection = try XCTUnwrap(active.projection)
    XCTAssertEqual(projection.elapsedMinutes, 160)
    XCTAssertEqual(projection.remainingMinutes, 140)
    XCTAssertEqual(projection.costPerHour, 1.1)
    XCTAssertEqual(projection.projectedTokens, 313_972)
    XCTAssertEqual(projection.projectedCostUSD, 4.7667, accuracy: 0.0001)
    XCTAssertNil(report.blocks[0].projection)
    XCTAssertEqual(report.gaps.map(\.agent), [.claude])
    XCTAssertEqual(report.activeByProvider.keys.sorted { $0.rawValue < $1.rawValue }, [.claudeCode])
    XCTAssertEqual(report.activeByProvider[.claudeCode], active)
    XCTAssertNotEqual(report.blocks[0].id, active.id)
  }

  func testUnknownAgentsAndMissingFieldsFailDecoding() throws {
    let fixture = utf8Text(try sharedHistoryFixture("blocks"))
    assertDecodingError(
      fixture.replacingOccurrences(of: #""agent": "codex""#, with: #""agent": "gemini""#),
      as: HistoryBlocksReport.self)
    assertDecodingError(
      fixture.replacingOccurrences(of: #""projection": null"#, with: #""other": null"#),
      as: HistoryBlocksReport.self)
    let report = utf8Text(try sharedHistoryFixture("usage-report"))
    assertDecodingError(
      report.replacingOccurrences(of: #""unpricedModels": ["gpt-preview-x"]"#, with: #""x": []"#),
      as: HistoryPeriodUsageReport.self)
    assertDecodingError(
      report.replacingOccurrences(of: #""period": "week""#, with: #""period": "year""#),
      as: HistoryPeriodUsageReport.self)
  }

  func testUsageReportAndBlocksTargets() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
    calendar.firstWeekday = 1
    let today = HistoryUsageReportQuery.today(
      breakdown: DailyUsageSummary.breakdown, at: date("2026-11-14T07:30:00Z"), calendar: calendar)
    XCTAssertEqual(
      HistoryEndpoint.usageReport(today).target,
      "/v1/usage?period=day&breakdown=agent%2Cmodel%2Cmachine&timezone=America%2FLos_Angeles"
        + "&startOfWeek=sunday&since=2026-11-13")
    let all = HistoryUsageReportQuery(
      period: .month, breakdown: [], range: .all, calendar: calendar)
    XCTAssertEqual(
      HistoryEndpoint.usageReport(all).target,
      "/v1/usage?period=month&timezone=America%2FLos_Angeles&startOfWeek=sunday")
    XCTAssertEqual(
      HistoryEndpoint.blocks(HistoryBlocksQuery(activeOnly: true, scope: .allMachines)).target,
      "/v1/blocks?active=true&machine=all")
    XCTAssertEqual(
      HistoryEndpoint.blocks(HistoryBlocksQuery(activeOnly: false, scope: .thisMac, since: "3d"))
        .target,
      "/v1/blocks?machine=local&since=3d")
  }

  func testAgentsMapToProviders() {
    for provider in ProviderID.allCases {
      XCTAssertEqual(HistoryAgent(provider: provider).provider, provider)
    }
    XCTAssertNil(HistoryAgent.conductor.provider)
    XCTAssertEqual(HistoryAgent.kimi.displayName, "Kimi Code")
    XCTAssertEqual(
      HistoryAgent.allCases.map(\.displayName),
      [
        "Claude Code", "Codex", "Cursor", "Antigravity", "Grok", "Kimi Code", "Meta Muse",
        "Conductor",
      ])
    XCTAssertEqual(HistoryUsagePeriod.allCases.map(\.label), ["Day", "Week", "Month"])
    XCTAssertEqual(
      HistoryUsageDimension.allCases.map(\.label), ["Agent", "Model", "Project", "Machine"])
  }

  func testDailySummarySplitsThisMacFromOtherMachines() throws {
    let report = try usageReport(
      rows: [
        row("claude", model: "claude-opus-5-5", tokens: 1_200_000, cost: 4.2),
        row("claude", model: "claude-opus-5-5", machine: "desk", tokens: 300_000, cost: 0.9),
        row("codex", model: "gpt-5.5", tokens: 40_000, cost: 0.4),
        row("codex", model: "gpt-preview-x", tokens: 10_000, cost: 0, complete: false),
        row("muse", model: "muse-1", machine: "laptop", tokens: 2_000, cost: 0, complete: false),
        row("conductor", model: nil, tokens: 99, cost: 0),
        row("grok", model: "grok-5", tokens: 0, cost: 0, events: 0),
      ],
      unpriced: ["gpt-preview-x", "muse-1"])
    let summary = DailyUsageSummary(report)
    XCTAssertEqual(Set(summary.providers.keys), [.claudeCode, .codex, .muse])

    let claude = try XCTUnwrap(summary[.claudeCode])
    XCTAssertEqual(claude.caption, "Today: 1.2M tok · $4.20")
    XCTAssertEqual(claude.allMachinesCaption, "All machines: 1.5M tok · $5.10")
    XCTAssertEqual(claude.otherMachines.map(\.machine), ["desk"])
    XCTAssertTrue(claude.allMachinesHelpText.contains("desk: 300K tok · $0.90"))
    XCTAssertEqual(claude.unpricedModels, [])
    XCTAssertFalse(claude.helpText.contains("lower bound"))

    let codex = try XCTUnwrap(summary[.codex])
    XCTAssertEqual(codex.caption, "Today: 50K tok · ≥ $0.40")
    XCTAssertNil(codex.allMachinesCaption)
    XCTAssertEqual(codex.unpricedModels, ["gpt-preview-x"])
    XCTAssertTrue(
      codex.helpText.hasSuffix("No list price for gpt-preview-x, so the cost is a lower bound."))

    let muse = try XCTUnwrap(summary[.muse])
    XCTAssertNil(muse.caption)
    XCTAssertEqual(muse.allMachinesCaption, "All machines: 2K tok · —")
    XCTAssertTrue(muse.allMachinesHelpText.contains("muse-1"))
  }

  func testOtherMachinesSortByTokensThenName() throws {
    let report = try usageReport(
      rows: [
        row("claude", model: "m", machine: "b", tokens: 5, cost: 0),
        row("claude", model: "m", machine: "a", tokens: 5, cost: 0),
        row("claude", model: "m", machine: "c", tokens: 9, cost: 0),
      ],
      unpriced: [])
    let claude = try XCTUnwrap(DailyUsageSummary(report)[.claudeCode])
    XCTAssertEqual(claude.otherMachines.map(\.machine), ["c", "a", "b"])
    XCTAssertNil(claude.thisMac)
  }

  func testBlockCaptions() throws {
    let report: HistoryBlocksReport = try decode("blocks", path: "/v1/blocks")
    let active = report.blocks[1]
    XCTAssertEqual(active.menuCaption(at: report.now), "Block $2.20 · $1.10/h · 2h 20m left")
    XCTAssertEqual(
      active.timelineSummary(at: report.now),
      "Claude Code · $2.20 so far · $1.10/h · projected $4.77 · 314K tok · 2h 20m left")
    XCTAssertTrue(active.helpText.contains("314K tokens and $4.77 by its end"))
    XCTAssertTrue(active.helpText.hasSuffix("matches the provider's 5-hour quota window."))
    let unpriced = utf8Text(try sharedHistoryFixture("blocks")).replacingOccurrences(
      of: "\"costUsd\": 2.2,\n      \"costComplete\": true",
      with: "\"costUsd\": 0,\n      \"costComplete\": false")
    let free: HistoryBlocksReport = try HistoryClient.decode(
      jsonResponse(unpriced), path: "/v1/blocks")
    let unpricedBlock = free.blocks[1]
    XCTAssertEqual(unpricedBlock.menuCaption(at: free.now), "Block — · 2h 20m left")
    XCTAssertEqual(
      unpricedBlock.timelineSummary(at: free.now),
      "Claude Code · — so far · projected 314K tok · 2h 20m left")
    XCTAssertTrue(unpricedBlock.helpText.contains("314K tokens by its end"))
    let past = report.blocks[2]
    XCTAssertEqual(past.menuCaption(at: report.now), "Block ≥ $0.40 · now left")
    XCTAssertEqual(past.timelineSummary(at: report.now), "Codex · ≥ $0.40 so far · now left")
    XCTAssertTrue(past.helpText.hasSuffix("at API list prices so far."))
  }

  func testPeriodChartKeepsTheTopSeriesAndCombinesTheRest() throws {
    let agents = ["claude", "codex", "cursor", "antigravity", "grok", "kimi", "muse", "conductor"]
    var rows = agents.enumerated().map { index, agent in
      row(agent, model: "model-\(index)", tokens: 1_000 * (index + 1), cost: Double(10 - index))
    }
    rows.append(row("claude", model: nil, tokens: 1, cost: 0))
    let report = try usageReport(rows: rows, unpriced: [], breakdown: ["model"])
    let chart = UsagePeriodChart(report, dimension: .model)
    XCTAssertEqual(chart.series.count, UsagePeriodChart.maximumSeries)
    XCTAssertEqual(chart.series.first, "model-0")
    XCTAssertEqual(chart.series.last, UsagePeriodChart.otherSeries)
    let other = try XCTUnwrap(chart.points.first { $0.series == UsagePeriodChart.otherSeries })
    XCTAssertEqual(other.costUSD, 3)
    XCTAssertEqual(other.tokens, 8_001)
    XCTAssertEqual(chart.points.count, 8)
    XCTAssertEqual(chart.activePeriods, 1)
    XCTAssertNotEqual(chart.points[0].id, chart.points[1].id)
  }

  func testPeriodChartLabels() {
    XCTAssertEqual(UsagePeriodChart.label("kimi", dimension: .agent), "Kimi Code")
    XCTAssertEqual(UsagePeriodChart.label("future", dimension: .agent), "future")
    XCTAssertEqual(UsagePeriodChart.label(nil, dimension: .agent), "Unknown agent")
    XCTAssertEqual(UsagePeriodChart.label(nil, dimension: .model), "Unknown model")
    XCTAssertEqual(UsagePeriodChart.label("/w/monorepo", dimension: .project), "monorepo")
    XCTAssertEqual(UsagePeriodChart.label(nil, dimension: .project), "No project")
    XCTAssertEqual(UsagePeriodChart.label(nil, dimension: .machine), "This Mac")
    XCTAssertEqual(UsagePeriodChart.label("desk", dimension: .machine), "desk")
  }

  private func decode<Value: HistoryVersionedResponse>(_ fixture: String, path: String) throws
    -> Value
  {
    try HistoryClient.decode(jsonResponse(try sharedHistoryFixture(fixture)), path: path)
  }

  private func assertDecodingError<Value: HistoryVersionedResponse>(
    _ body: String, as _: Value.Type, file: StaticString = #filePath, line: UInt = #line
  ) {
    XCTAssertThrowsError(
      try HistoryClient.decode(jsonResponse(body), path: "/v1/x") as Value, file: file, line: line
    ) { error in
      guard case .decoding = error as? HistoryAPIError else {
        return XCTFail("Expected a decoding error, got \(error)", file: file, line: line)
      }
    }
  }
}

/// One breakdown row of a synthetic `/v1/usage?period=day` report.
func row(
  _ agent: String, model: String?, machine: String? = nil, tokens: Int, cost: Double,
  complete: Bool = true, events: Int = 1
) -> String {
  func json(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
  return """
    {"agent":\(json(agent)),"model":\(json(model)),"project":null,"machine":\(json(machine)),\
    "inputTokens":\(tokens),"outputTokens":0,"cacheReadTokens":0,"cacheCreationTokens":0,\
    "cachedInputTokens":0,"reasoningTokens":0,"totalTokens":\(tokens),"events":\(events),\
    "costUsd":\(cost),"costComplete":\(complete)}
    """
}

/// A one-day report with `rows` as its breakdown.
func usageReportBody(
  rows: [String], unpriced: [String], breakdown: [String] = ["agent", "model", "machine"]
) -> String {
  let totals = """
    "inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"cacheCreationTokens":0,\
    "cachedInputTokens":0,"reasoningTokens":0,"totalTokens":0,"events":\(rows.count),\
    "costUsd":0,"costComplete":true
    """
  let models = unpriced.map { "\"\($0)\"" }.joined(separator: ",")
  let dimensions = breakdown.map { "\"\($0)\"" }.joined(separator: ",")
  return """
    {"apiVersion":1,"period":"day","timezone":"UTC","startOfWeek":"monday",\
    "breakdown":[\(dimensions)],"since":"2026-11-14T00:00:00Z","until":null,\
    "filters":{"agent":null,"source":null,"machine":null,"project":null},\
    "total":{\(totals),"unpricedModels":[\(models)]},\
    "periods":[{"period":"2026-11-14","start":"2026-11-14T00:00:00Z",\
    "end":"2026-11-15T00:00:00Z",\(totals),"breakdown":[\(rows.joined(separator: ","))]}]}
    """
}

private func usageReport(
  rows: [String], unpriced: [String], breakdown: [String] = ["agent", "model", "machine"]
) throws -> HistoryPeriodUsageReport {
  try HistoryClient.decode(
    jsonResponse(usageReportBody(rows: rows, unpriced: unpriced, breakdown: breakdown)),
    path: "/v1/usage")
}
