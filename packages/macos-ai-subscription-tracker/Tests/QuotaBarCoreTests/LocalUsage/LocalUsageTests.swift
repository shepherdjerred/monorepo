import Foundation
import XCTest

@testable import QuotaBarCore

final class LocalUsageFormattingTests: XCTestCase {
  func testTokenTextUsesCompactUnits() {
    XCTAssertEqual(LocalDailyUsage.tokenText(999), "999")
    XCTAssertEqual(LocalDailyUsage.tokenText(1_000), "1K")
    XCTAssertEqual(LocalDailyUsage.tokenText(1_500), "1.5K")
    XCTAssertEqual(LocalDailyUsage.tokenText(2_000), "2K")
    XCTAssertEqual(LocalDailyUsage.tokenText(1_000_000), "1.0M")
    XCTAssertEqual(LocalDailyUsage.tokenText(1_200_000), "1.2M")
    XCTAssertEqual(LocalDailyUsage.tokenText(999_950), "1.0M")
  }

  func testCaptionOmitsDollarsWhenTheDayIsUnpriced() {
    let usage = LocalDailyUsage(
      provider: .claudeCode,
      totalTokens: 1_200_000,
      estimatedCostUSD: nil,
      unpricedModels: ["mystery-model"],
      unreadable: true,
      pricingUnavailable: false
    )
    XCTAssertEqual(usage.caption, "Today: 1.2M tok")
    XCTAssertTrue(usage.helpText.contains("mystery-model"))
    XCTAssertTrue(usage.helpText.contains("not the subscription quota"))
    XCTAssertNil(
      LocalDailyUsage(
        provider: .codex,
        totalTokens: 0,
        estimatedCostUSD: nil,
        unpricedModels: [],
        unreadable: true,
        pricingUnavailable: false
      ).caption
    )
  }
}

final class PricingCatalogTests: XCTestCase {
  func testBundledSnapshotUsesOfficialBaseRates() throws {
    let catalog = try PricingCatalog.bundled()
    XCTAssertEqual(catalog.fetchedOn, "2026-11-01")
    let sonnet = try XCTUnwrap(catalog.prices["claude-sonnet-5-5"])
    XCTAssertEqual(sonnet.input, decimal("2"))
    XCTAssertEqual(sonnet.output, decimal("10"))
    XCTAssertEqual(sonnet.cacheCreate, decimal("2.5"))
    XCTAssertEqual(sonnet.cacheRead, decimal("0.1"))
    let haiku = try XCTUnwrap(catalog.prices["claude-haiku-5-5"])
    XCTAssertEqual(haiku.input, decimal("0.1"))
    XCTAssertEqual(haiku.cacheCreate, decimal("0.125"))
    let terra = try XCTUnwrap(catalog.prices["gpt-6.1-terra"])
    XCTAssertEqual(terra.input, decimal("1"))
    XCTAssertEqual(terra.cacheCreate, decimal("1.25"))
    XCTAssertEqual(catalog.prices["gpt-6.1-sol"]?.input, decimal("2"))
    XCTAssertEqual(catalog.prices["claude-opus-5-5"]?.input, decimal("4"))
  }

  func testFormulaPinsCacheRatesAndPrefersRecordedCost() {
    let catalog = fixtureCatalog()
    var unsplit = UsageTurn()
    unsplit.cacheCreateUnsplit = 1_000_000
    unsplit.model = "claude-sonnet-5-5"
    XCTAssertEqual(catalog.cost(of: unsplit), decimal("2.5"))

    var oneHour = UsageTurn()
    oneHour.cacheCreate1h = 1_000_000
    oneHour.model = "claude-sonnet-5-5"
    XCTAssertEqual(catalog.cost(of: oneHour), decimal("4"))

    var recorded = UsageTurn()
    recorded.input = 1_000_000
    recorded.model = "mystery-model"
    recorded.recordedCostUSD = decimal("1.25")
    XCTAssertEqual(PricingCatalog.cost(of: recorded, using: catalog), decimal("1.25"))

    var unknown = UsageTurn()
    unknown.input = 10
    unknown.model = "mystery-model"
    XCTAssertNil(catalog.cost(of: unknown))
  }

  func testUnknownModelOmitsTheDayDollarsButKeepsTokens() {
    var known = UsageTurn()
    known.input = 1_000_000
    known.model = "claude-sonnet-5-5"
    var unknown = UsageTurn()
    unknown.output = 5
    unknown.model = "mystery-model"
    let summary = LocalUsageMath.summarize(
      provider: .claudeCode,
      turns: [known, unknown],
      unreadable: false,
      pricingUnavailable: false,
      catalog: fixtureCatalog()
    )
    XCTAssertEqual(summary?.totalTokens, 1_000_005)
    XCTAssertNil(summary?.estimatedCostUSD)
    XCTAssertEqual(summary?.unpricedModels, ["mystery-model"])
  }

  func testZeroTokenUnknownModelDoesNotHideTheDayPrice() {
    var known = UsageTurn()
    known.input = 1_000_000
    known.model = "claude-sonnet-5-5"
    var placeholder = UsageTurn()
    placeholder.model = "<synthetic>"
    let summary = LocalUsageMath.summarize(
      provider: .claudeCode,
      turns: [known, placeholder],
      unreadable: false,
      pricingUnavailable: false,
      catalog: fixtureCatalog()
    )
    XCTAssertEqual(summary?.totalTokens, 1_000_000)
    XCTAssertEqual(summary?.estimatedCostUSD, decimal("2"))
    XCTAssertEqual(summary?.unpricedModels, [])
    XCTAssertEqual(summary?.caption, "Today: 1.0M tok · ~$2.00 API")
  }
}

final class ClaudeLocalUsageTests: XCTestCase {
  func testClaudeLogDedupesSidechainsAndSplitsCache() throws {
    let turns = try ClaudeSessionLog.turns(from: fixtureLines("claude-local-usage", ext: "jsonl"))
    let today = turns.filter { $0.timestamp >= date("2026-11-01T00:00:00Z") }
    XCTAssertEqual(turns.count, today.count + 1)
    XCTAssertEqual(
      today.map(\.model),
      [
        "claude-sonnet-5-5",
        "claude-opus-5-5",
        "claude-haiku-5-5",
        "mystery-model",
        "claude-sonnet-5-5",
      ])
    let sonnet = try XCTUnwrap(today.first)
    XCTAssertEqual(sonnet.input, 1000)
    XCTAssertEqual(sonnet.output, 500)
    XCTAssertEqual(sonnet.cacheCreateUnsplit, 100)
    XCTAssertEqual(sonnet.cacheRead, 50)
    XCTAssertEqual(sonnet.totalTokens, 1650)
    let opus = today[1]
    XCTAssertEqual(opus.cacheCreate5m, 5)
    XCTAssertEqual(opus.cacheCreate1h, 7)
    XCTAssertEqual(opus.cacheCreateUnsplit, 0)
    XCTAssertEqual(opus.totalTokens, 52)
    XCTAssertEqual(today[2].recordedCostUSD, decimal("1.25"))
    XCTAssertEqual(today[4].input, 3)
    XCTAssertEqual(
      turns.first { $0.model == "claude-haiku-5-5" && $0.input == 800 }?.timestamp,
      date("2026-10-31T23:00:00Z"))
  }

  func testMalformedUsageLineFailsTheFile() {
    let line = """
      {"type":"assistant","timestamp":"2026-11-01T00:00:00Z","requestId":"req",\
      "message":{"id":"msg","model":"claude-sonnet-5-5","usage":{"input_tokens":true}}}
      """
    XCTAssertThrowsError(try ClaudeSessionLog.turns(from: [line]))
  }

  func testMissingIdentityIsNotCollapsed() throws {
    let lines = [
      assistant(uuid: "one", messageID: nil, requestID: nil, input: 2),
      assistant(uuid: "two", messageID: nil, requestID: nil, input: 3),
    ]
    let turns = try ClaudeSessionLog.turns(from: lines)
    XCTAssertEqual(turns.map(\.input), [2, 3])
  }

  private func assistant(uuid: String, messageID: String?, requestID: String?, input: Int) -> String
  {
    let message = messageID.map { #""id":"\#($0)","# } ?? ""
    let request = requestID.map { #""requestId":"\#($0)","# } ?? ""
    return """
      {"type":"assistant","uuid":"\(uuid)","timestamp":"2026-11-01T00:00:00Z",\(request)\
      "message":{\(message)"model":"claude-sonnet-5-5","usage":{"input_tokens":\(input)}}}
      """
  }
}

final class CodexLocalUsageTests: XCTestCase {
  func testCodexCountsTheIncrementAndSkipsAnUnchangedTotal() throws {
    let turns = try CodexSessionLog.turns(from: fixtureLines("codex-local-usage", ext: "jsonl"))
    XCTAssertEqual(turns.map(\.totalTokens), [35, 48, 11])
    XCTAssertEqual(turns[0].output, 5)
    XCTAssertEqual(turns[0].input, 20)
    XCTAssertEqual(turns[0].cacheRead, 10)
    XCTAssertEqual(turns[1].input, 26)
    XCTAssertEqual(turns[1].cacheCreateUnsplit, 4)
    XCTAssertEqual(turns[1].cacheRead, 10)
    XCTAssertEqual(turns.map(\.model), ["gpt-6.1-sol", "gpt-6.1-sol", "gpt-6.1-sol"])
  }

  func testInheritedCumulativeTotalCountsOnlyTheIncrement() throws {
    let lines = [
      context("gpt-6.1-terra"),
      tokenCount(ordinal: 1, lastTotal: 33, lastInput: 30, cumulative: 900_000),
      tokenCount(ordinal: 2, lastTotal: 22, lastInput: 20, cached: 5, cumulative: 900_022),
    ]
    let turns = try CodexSessionLog.turns(from: lines)
    XCTAssertEqual(turns.map(\.totalTokens), [33, 22])
    XCTAssertEqual(turns.map(\.model), ["gpt-6.1-terra", "gpt-6.1-terra"])
  }

  func testCurrentUsageRecordIgnoresTheTurnCumulative() throws {
    let line = """
      {"type":"token_usage_record","timestamp":"2026-11-01T01:01:00Z","ordinal":2,\
      "payload":{"usage":{"input_tokens":10,"cached_input_tokens":4,\
      "cache_write_input_tokens":1,"output_tokens":3,"reasoning_output_tokens":1,"total_tokens":13},\
      "thread_token_usage":{"input_tokens":10,"cached_input_tokens":4,\
      "cache_write_input_tokens":1,"output_tokens":3,"reasoning_output_tokens":1,"total_tokens":13},\
      "turn_token_usage":{"input_tokens":100000,"cached_input_tokens":0,\
      "cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":100000}}}
      """
    let turns = try CodexSessionLog.turns(from: [line])
    XCTAssertEqual(turns.map(\.totalTokens), [13])
    XCTAssertEqual(turns[0].model, "unknown")
    XCTAssertEqual(turns[0].input, 5)
  }

  func testCumulativeOnlyAndConflictingOrdinalFailTheFile() {
    let cumulativeOnly = """
      {"type":"token_count","timestamp":"2026-11-01T01:00:00Z","ordinal":1,\
      "payload":{"info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,\
      "cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":11}}}}
      """
    XCTAssertThrowsError(try CodexSessionLog.turns(from: [cumulativeOnly]))

    let conflict = [
      tokenCount(ordinal: 1, lastTotal: 10, lastInput: 10, cumulative: 10),
      tokenCount(ordinal: 1, lastTotal: 12, lastInput: 12, cumulative: 22),
    ]
    XCTAssertThrowsError(try CodexSessionLog.turns(from: conflict))
  }

  func testNegativeUncachedInputFailsTheFile() {
    let line = tokenCount(ordinal: 1, lastTotal: 5, lastInput: 5, cached: 10, cumulative: 5)
    XCTAssertThrowsError(try CodexSessionLog.turns(from: [line]))
  }

  private func context(_ model: String) -> String {
    #"{"type":"turn_context","timestamp":"2026-11-01T00:00:00Z","ordinal":0,"payload":{"model":"\#(model)"}}"#
  }

  private func tokenCount(
    ordinal: Int,
    lastTotal: Int,
    lastInput: Int,
    cached: Int = 0,
    cumulative: Int
  ) -> String {
    let output = lastTotal - lastInput
    return """
      {"type":"token_count","timestamp":"2026-11-01T01:00:00Z","ordinal":\(ordinal),\
      "payload":{"info":{"last_token_usage":{"input_tokens":\(lastInput),\
      "cached_input_tokens":\(cached),"cache_write_input_tokens":0,"output_tokens":\(output),\
      "reasoning_output_tokens":0,"total_tokens":\(lastTotal)},\
      "total_token_usage":{"input_tokens":\(lastInput),"cached_input_tokens":\(cached),\
      "cache_write_input_tokens":0,"output_tokens":\(output),"reasoning_output_tokens":0,\
      "total_tokens":\(cumulative)}}}}
      """
  }
}

private func fixtureCatalog() -> PricingCatalog {
  PricingCatalog(
    fetchedOn: "2026-11-01",
    prices: [
      "claude-sonnet-5-5": ModelTokenPrice(
        input: decimal("2"),
        output: decimal("10"),
        cacheCreate: decimal("2.5"),
        cacheRead: decimal("0.1")
      )
    ]
  )
}
