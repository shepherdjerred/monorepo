import Foundation
import XCTest

@testable import QuotaBarCore

final class QuotaOverviewTests: XCTestCase {
  func testProvidersSortByCurrentQuotaThenAvailability() {
    let states = allStates([
      .claudeCode: .available(snapshot(provider: .claudeCode, remaining: 50)),
      .codex: .available(
        snapshot(provider: .codex, remaining: 1).markedStale(reason: "offline")
      ),
      .kimi: .available(snapshot(provider: .kimi, remaining: 10)),
      .grok: .available(snapshot(provider: .grok, remaining: nil)),
    ])

    let overview = QuotaOverview(states: states, at: referenceDate)

    XCTAssertEqual(overview.providers.map(\.provider), [.kimi, .claudeCode, .grok, .codex])
    XCTAssertEqual(overview.providers[0].tightestWindow?.remainingPercent, 10)
    XCTAssertNil(overview.providers[2].tightestWindow)
    XCTAssertNil(overview.providers[3].tightestWindow)
  }

  func testPartialCurrentDataSortsAfterTrustedCurrentData() {
    let overview = QuotaOverview(
      states: allStates([
        .claudeCode: .available(snapshot(provider: .claudeCode, remaining: 50)),
        .codex: .available(snapshot(provider: .codex, remaining: 20)),
        .grok: .available(
          UsageSnapshot(
            provider: .grok,
            windows: [window(remaining: 1)],
            notes: ["Monthly usage is unavailable."],
            sourceTimestamp: referenceDate
          )
        ),
      ]),
      at: referenceDate
    )

    XCTAssertEqual(overview.providers.map(\.provider), [.codex, .claudeCode, .grok, .kimi])
    XCTAssertEqual(overview.providers[2].badges.map(\.kind), [.partial])
  }

  func testProviderBadgesDescribeFreshnessAndResetDetails() throws {
    let staleDate = referenceDate.addingTimeInterval(-5 * 86_400)
    let partialDate = referenceDate.addingTimeInterval(-4 * 86_400)
    let resetDate = referenceDate.addingTimeInterval(4_000)
    let overview = QuotaOverview(
      states: allStates([
        .codex: .available(
          UsageSnapshot(
            provider: .codex,
            windows: [window(remaining: 14)],
            resets: [Reset(exp: resetDate)],
            sourceTimestamp: referenceDate
          )
        ),
        .kimi: .available(
          snapshot(provider: .kimi, remaining: 40, sourceTimestamp: staleDate)
            .markedStale(reason: "offline")
        ),
        .grok: .available(
          UsageSnapshot(
            provider: .grok,
            windows: [window(remaining: 44)],
            notes: ["Monthly usage is unavailable."],
            sourceTimestamp: partialDate
          )
        ),
      ]),
      at: referenceDate
    )

    let codex = try XCTUnwrap(overview.providers.first { $0.provider == .codex })
    XCTAssertEqual(codex.badges.map(\.kind), [.resets])
    XCTAssertEqual(codex.badges.first?.expirations, [resetDate])
    XCTAssertNil(codex.badges.first?.detail)

    let kimi = try XCTUnwrap(overview.providers.first { $0.provider == .kimi })
    XCTAssertEqual(kimi.badges.map(\.kind), [.stale])
    XCTAssertEqual(kimi.badges.first?.age, "5D")
    XCTAssertEqual(kimi.badges.first?.detail, "offline")
    XCTAssertTrue(kimi.dimsContent)

    let grok = try XCTUnwrap(overview.providers.first { $0.provider == .grok })
    XCTAssertEqual(grok.badges.map(\.kind), [.partial])
    XCTAssertEqual(grok.badges.first?.age, "4D")
    XCTAssertEqual(grok.badges.first?.detail, "Monthly usage is unavailable.")
    XCTAssertFalse(grok.dimsContent)
  }

  func testCodexNoResetStateUsesCompactBadge() throws {
    let overview = QuotaOverview(
      states: allStates([
        .codex: .available(snapshot(provider: .codex, remaining: 14))
      ]),
      at: referenceDate
    )

    let codex = try XCTUnwrap(overview.providers.first { $0.provider == .codex })
    XCTAssertEqual(codex.badges.map(\.kind), [.noResets])
    XCTAssertEqual(codex.badges.first?.detail, "No reset windows are currently available.")
  }

  func testCriticalQuotaTakesPrecedenceOverStaleProvider() {
    let codex = snapshot(provider: .codex, remaining: 2)
    let overview = QuotaOverview(
      states: allStates([
        .claudeCode: .available(
          snapshot(provider: .claudeCode, remaining: 1).markedStale(reason: "offline")
        ),
        .codex: .available(codex),
      ]),
      at: referenceDate
    )

    XCTAssertEqual(
      overview.summary,
      .quota(provider: .codex, window: codex.windows[0])
    )
    XCTAssertEqual(overview.summary.status, .critical)
  }

  func testUnavailableStatesTakePrecedenceOverWarningAndHealthyQuotas() {
    let stale = QuotaOverview(
      states: allStates([
        .claudeCode: .available(
          snapshot(provider: .claudeCode, remaining: 80).markedStale(reason: "offline")
        ),
        .codex: .available(snapshot(provider: .codex, remaining: 10)),
      ]),
      at: referenceDate
    )
    XCTAssertEqual(stale.summary, .stale(provider: .claudeCode, reason: "offline"))

    let unauthenticated = QuotaOverview(
      states: allStates([
        .claudeCode: .unauthenticated(message: "Sign in again"),
        .codex: .available(snapshot(provider: .codex, remaining: 60)),
      ]),
      at: referenceDate
    )
    XCTAssertEqual(
      unauthenticated.summary,
      .unauthenticated(provider: .claudeCode, message: "Sign in again")
    )
  }

  func testTightestFreshQuotaProvidesWarningSummary() {
    let kimi = snapshot(provider: .kimi, remaining: 18)
    let overview = QuotaOverview(
      states: allStates([
        .claudeCode: .available(snapshot(provider: .claudeCode, remaining: 55)),
        .kimi: .available(kimi),
      ]),
      at: referenceDate
    )

    XCTAssertEqual(overview.summary, .quota(provider: .kimi, window: kimi.windows[0]))
    XCTAssertEqual(overview.summary.status, .warning)
  }

  func testUnknownLoadingAndAllDisabledSummariesRemainDistinct() {
    let unknown = QuotaOverview(
      states: allStates([.grok: .available(snapshot(provider: .grok, remaining: nil))]),
      at: referenceDate
    )
    XCTAssertEqual(unknown.summary, .unknown(provider: .grok))

    let loading = QuotaOverview(
      states: allStates([.kimi: .loading]),
      at: referenceDate
    )
    XCTAssertEqual(loading.summary, .loading(provider: .kimi))

    let disabled = QuotaOverview(states: allStates([:]), at: referenceDate)
    XCTAssertEqual(disabled.summary, .noProvidersEnabled)
  }

  func testResetOverviewFiltersExpirationsAndPreservesErrors() throws {
    let snapshot = UsageSnapshot(
      provider: .codex,
      windows: [window(remaining: 50)],
      resets: [
        Reset(exp: referenceDate.addingTimeInterval(-1)),
        Reset(exp: referenceDate.addingTimeInterval(4_000)),
        Reset(exp: referenceDate.addingTimeInterval(2_000)),
      ],
      sourceTimestamp: referenceDate
    )
    let overview = QuotaOverview(
      states: allStates([.codex: .available(snapshot)]),
      at: referenceDate
    )
    let codex = try XCTUnwrap(overview.providers.first { $0.provider == .codex })
    XCTAssertEqual(
      codex.resetOverview,
      .available([
        Reset(exp: referenceDate.addingTimeInterval(2_000)),
        Reset(exp: referenceDate.addingTimeInterval(4_000)),
      ])
    )

    let resetError = UsageSnapshot(
      provider: .codex,
      windows: [window(remaining: 50)],
      resetErrorMessage: "Reset surface unavailable",
      sourceTimestamp: referenceDate
    )
    let errorOverview = QuotaOverview(
      states: allStates([.codex: .available(resetError)]),
      at: referenceDate
    )
    XCTAssertEqual(
      errorOverview.providers.first { $0.provider == .codex }?.resetOverview,
      .unavailable(message: "Reset surface unavailable")
    )
  }

  func testCountdownAndAgeFormattersToleranteExtremeDates() {
    // A malformed or already-persisted date with an out-of-Int64-range epoch must not trap when
    // converted to a countdown; it should degrade to a large-but-finite duration instead.
    let farFuture = Date(timeIntervalSince1970: 1e20)
    let farPast = Date(timeIntervalSince1970: -1e20)
    XCTAssertTrue(
      QuotaTimeFormatter.compactCountdown(to: farFuture, from: referenceDate).contains("d"))
    XCTAssertTrue(
      QuotaTimeFormatter.refreshAge(since: farPast, at: referenceDate).hasSuffix("d ago"))
    XCTAssertNotNil(QuotaTimeFormatter.compactAge(since: farPast, at: referenceDate))
    XCTAssertTrue(
      QuotaTimeFormatter.compactAge(since: farPast, at: referenceDate)?.hasSuffix("D") == true
    )
  }

  func testCompactTimeFormattingAndLatestSourceTimestamp() {
    XCTAssertEqual(
      QuotaTimeFormatter.compactCountdown(
        to: referenceDate.addingTimeInterval(30),
        from: referenceDate
      ),
      "<1m"
    )
    XCTAssertEqual(
      QuotaTimeFormatter.compactCountdown(
        to: referenceDate.addingTimeInterval(3_661),
        from: referenceDate
      ),
      "1h 1m"
    )
    XCTAssertEqual(
      QuotaTimeFormatter.compactCountdown(
        to: referenceDate.addingTimeInterval(90_000),
        from: referenceDate
      ),
      "1d 1h"
    )
    XCTAssertEqual(
      QuotaTimeFormatter.refreshAge(
        since: referenceDate.addingTimeInterval(-40),
        at: referenceDate
      ),
      "40s ago"
    )
    XCTAssertEqual(
      QuotaTimeFormatter.refreshAge(
        since: referenceDate.addingTimeInterval(-7_200),
        at: referenceDate
      ),
      "2h ago"
    )
    XCTAssertNil(
      QuotaTimeFormatter.compactAge(
        since: referenceDate.addingTimeInterval(-3_600),
        at: referenceDate
      )
    )
    XCTAssertEqual(
      QuotaTimeFormatter.compactAge(
        since: referenceDate.addingTimeInterval(-5 * 86_400),
        at: referenceDate
      ),
      "5D"
    )

    let newerTimestamp = referenceDate.addingTimeInterval(60)
    let overview = QuotaOverview(
      states: allStates([
        .claudeCode: .available(snapshot(provider: .claudeCode, remaining: 50)),
        .codex: .available(
          snapshot(provider: .codex, remaining: 60, sourceTimestamp: newerTimestamp)
        ),
      ]),
      at: newerTimestamp
    )
    XCTAssertEqual(overview.lastUpdatedAt, newerTimestamp)
  }

  private let referenceDate = Date(timeIntervalSince1970: 1_786_233_600)

  private func allStates(
    _ overrides: [ProviderID: ProviderDisplayState]
  ) -> [ProviderID: ProviderDisplayState] {
    var states = Dictionary(
      uniqueKeysWithValues: ProviderID.allCases.map { ($0, ProviderDisplayState.disabled) }
    )
    for (provider, state) in overrides { states[provider] = state }
    return states
  }

  private func snapshot(
    provider: ProviderID,
    remaining: Double?,
    sourceTimestamp: Date? = nil
  ) -> UsageSnapshot {
    UsageSnapshot(
      provider: provider,
      windows: [
        window(
          remaining: remaining,
          sourceTimestamp: sourceTimestamp ?? referenceDate
        )
      ],
      sourceTimestamp: sourceTimestamp ?? referenceDate
    )
  }
}
