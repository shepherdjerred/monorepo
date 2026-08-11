import Foundation
import QuotaBarCore
import SwiftUI

#Preview("Healthy, warning, critical") {
  OverviewPreview(
    states: PreviewData.states([
      .claudeCode: .available(PreviewData.snapshot(.claudeCode, remaining: 58)),
      .codex: .available(PreviewData.codexWithResets),
      .kimi: .available(PreviewData.snapshot(.kimi, remaining: 18)),
      .grok: .available(PreviewData.snapshot(.grok, remaining: 3)),
    ])
  )
}

#Preview("Loading, stale, unauthenticated, disabled") {
  OverviewPreview(
    states: PreviewData.states([
      .claudeCode: .loading,
      .codex: .available(
        PreviewData.snapshot(.codex, remaining: 50)
          .markedStale(reason: "Provider rate-limited the latest refresh.")
      ),
      .kimi: .unauthenticated(message: "Refresh Kimi through OpenCode."),
      .grok: .disabled,
    ])
  )
}

#Preview("Policy, partial, unknown, reset error") {
  OverviewPreview(
    states: PreviewData.states([
      .claudeCode: .available(PreviewData.claudePolicy),
      .codex: .available(PreviewData.resetError),
      .kimi: .available(PreviewData.unknownKimi),
      .grok: .available(PreviewData.partialGrok),
    ])
  )
}

#Preview("Long labels and many windows") {
  OverviewPreview(
    states: PreviewData.states([
      .claudeCode: .available(PreviewData.manyWindows),
      .codex: .available(PreviewData.snapshot(.codex, remaining: 71)),
      .kimi: .available(PreviewData.snapshot(.kimi, remaining: 88)),
      .grok: .available(PreviewData.snapshot(.grok, remaining: 93)),
    ])
  )
}

#Preview("Dark appearance") {
  OverviewPreview(
    states: PreviewData.states([
      .claudeCode: .available(PreviewData.snapshot(.claudeCode, remaining: 45)),
      .codex: .available(PreviewData.codexWithResets),
      .kimi: .available(PreviewData.snapshot(.kimi, remaining: 11)),
      .grok: .unavailable(message: "The provider response changed shape."),
    ])
  )
  .environment(\.colorScheme, .dark)
}

private struct OverviewPreview: View {
  let states: [ProviderID: ProviderDisplayState]

  var body: some View {
    let overview = QuotaOverview(states: states, at: PreviewData.now)
    VStack(spacing: 0) {
      QuotaSummaryView(summary: overview.summary, date: PreviewData.now)
        .padding(.bottom, 8)
      Divider()
      ForEach(overview.providers) { provider in
        ProviderSectionView(overview: provider, date: PreviewData.now)
        if provider.id != overview.providers.last?.id {
          Divider().padding(.leading, 25)
        }
      }
    }
    .padding(.horizontal, 12)
    .frame(width: 380)
  }
}

private enum PreviewData {
  static let now = Date(timeIntervalSince1970: 1_786_233_600)

  static func states(
    _ overrides: [ProviderID: ProviderDisplayState]
  ) -> [ProviderID: ProviderDisplayState] {
    var values = Dictionary(
      uniqueKeysWithValues: ProviderID.allCases.map { ($0, ProviderDisplayState.disabled) }
    )
    for (provider, state) in overrides { values[provider] = state }
    return values
  }

  static func snapshot(_ provider: ProviderID, remaining: Double) -> UsageSnapshot {
    UsageSnapshot(
      provider: provider,
      windows: [window(label: "Weekly", remaining: remaining)],
      sourceTimestamp: now
    )
  }

  static var codexWithResets: UsageSnapshot {
    UsageSnapshot(
      provider: .codex,
      windows: [
        window(label: "Weekly", remaining: 32),
        window(label: "Rolling", remaining: 66, kind: .rolling(durationSeconds: 18_000)),
      ],
      resets: [
        Reset(exp: now.addingTimeInterval(6 * 86_400)),
        Reset(exp: now.addingTimeInterval(13 * 86_400)),
      ],
      sourceTimestamp: now
    )
  }

  static var claudePolicy: UsageSnapshot {
    UsageSnapshot(
      provider: .claudeCode,
      windows: [
        window(label: "5-hour", remaining: 72, kind: .rolling(durationSeconds: 18_000)),
        window(label: "Weekly", remaining: 41),
        window(label: "Fable 5 policy", remaining: nil, kind: .entitlement),
      ],
      notes: ["Fable 5 may use up to 50% of the weekly allowance."],
      sourceTimestamp: now
    )
  }

  static var resetError: UsageSnapshot {
    UsageSnapshot(
      provider: .codex,
      windows: [window(label: "Weekly", remaining: 70)],
      resetErrorMessage: "The reset endpoint is unavailable.",
      sourceTimestamp: now
    )
  }

  static var unknownKimi: UsageSnapshot {
    UsageSnapshot(
      provider: .kimi,
      windows: [window(label: "Shared credits", remaining: nil, kind: .credits)],
      sourceTimestamp: now
    )
  }

  static var partialGrok: UsageSnapshot {
    UsageSnapshot(
      provider: .grok,
      windows: [window(label: "Weekly", remaining: 44)],
      notes: ["Monthly usage is unavailable."],
      sourceTimestamp: now
    )
  }

  static var manyWindows: UsageSnapshot {
    UsageSnapshot(
      provider: .claudeCode,
      windows: [
        window(label: "5-hour", remaining: 90, kind: .rolling(durationSeconds: 18_000)),
        window(label: "Weekly", remaining: 64),
        window(
          label: "Nimbus Quill extended model quota",
          remaining: 52,
          kind: .modelScoped(model: "Nimbus Quill")
        ),
        window(label: "Fable 5 policy", remaining: nil, kind: .entitlement),
      ],
      notes: ["Fable 5 may use up to 50% of the weekly allowance."],
      sourceTimestamp: now
    )
  }

  private static func window(
    label: String,
    remaining: Double?,
    kind: WindowKind = .weekly
  ) -> UsageWindow {
    do {
      return try UsageWindow.validated(
        id: label.lowercased().replacingOccurrences(of: " ", with: "-"),
        label: label,
        kind: kind,
        usedPercent: remaining.map { 100 - $0 },
        resetAt: kind == .entitlement ? nil : now.addingTimeInterval(86_400),
        sourceTimestamp: now
      )
    } catch {
      preconditionFailure("Invalid preview fixture")
    }
  }
}
