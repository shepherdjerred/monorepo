import AppKit
import QuotaBarCore
import SwiftUI

struct ProviderSectionView: View {
  let overview: ProviderOverview
  let date: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      header
      content
    }
    .padding(.vertical, 9)
    .accessibilityElement(children: .contain)
  }

  private var header: some View {
    HStack(spacing: 7) {
      ProviderLogo(provider: overview.provider)
      Text(overview.provider.displayName)
        .font(.subheadline.weight(.semibold))
      Spacer()
      Text("$\(SubscriptionPlan.plan(for: overview.provider).monthlyCostUSD)/mo")
        .font(.caption)
        .foregroundStyle(.secondary)
        .monospacedDigit()
      if let url = overview.provider.usageURL {
        Link(destination: url) {
          Image(systemName: "arrow.up.right.square")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .help("Open \(overview.provider.displayName) usage")
        .accessibilityLabel("Open \(overview.provider.displayName) usage")
      }
    }
  }

  @ViewBuilder private var content: some View {
    switch overview.state {
    case .disabled:
      statusRow("Disabled", symbol: "pause.circle", help: "Enable this provider in Settings.")
    case .loading:
      HStack(spacing: 6) {
        ProgressView().controlSize(.mini)
        Text("Checking usage…")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .accessibilityElement(children: .combine)
    case let .unavailable(message):
      statusRow("Usage unavailable", symbol: "exclamationmark.triangle", help: message)
    case let .unauthenticated(message):
      statusRow(
        "Sign in required",
        symbol: "person.crop.circle.badge.exclamationmark",
        help: message
      )
    case let .available(snapshot):
      snapshotContent(snapshot)
    }
  }

  @ViewBuilder private func snapshotContent(_ snapshot: UsageSnapshot) -> some View {
    let isStale = snapshot.freshness != .current
    let entitlementDetail =
      snapshot.windows.contains { $0.kind == .entitlement }
      ? snapshot.notes.first
      : nil
    let remainingNotes =
      entitlementDetail == nil ? snapshot.notes : Array(snapshot.notes.dropFirst())

    if case let .stale(reason) = snapshot.freshness {
      statusRow(
        "Stale · \(QuotaTimeFormatter.refreshAge(since: snapshot.sourceTimestamp, at: date))",
        symbol: "clock.badge.exclamationmark",
        help: reason
      )
    }
    if snapshot.windows.isEmpty {
      statusRow(
        "No quota windows returned",
        symbol: "gauge.with.dots.needle.50percent",
        help: "The provider returned no displayable subscription windows."
      )
    } else {
      ForEach(snapshot.windows) { window in
        WindowRow(
          window: window,
          date: date,
          stale: isStale,
          entitlementDetail: window.kind == .entitlement ? entitlementDetail : nil
        )
      }
    }
    if let resetOverview = overview.resetOverview {
      CodexResetRow(resetOverview: resetOverview, date: date, stale: isStale)
    }
    if overview.provider == .grok, !remainingNotes.isEmpty {
      statusRow(
        "Partial data",
        symbol: "exclamationmark.circle",
        help: remainingNotes.joined(separator: "\n")
      )
    }
  }

  private func statusRow(_ text: String, symbol: String, help: String) -> some View {
    Label(text, systemImage: symbol)
      .font(.caption)
      .foregroundStyle(.secondary)
      .help(help)
      .accessibilityLabel(text)
      .accessibilityHint(help)
  }
}

struct WindowRow: View {
  let window: UsageWindow
  let date: Date
  let stale: Bool
  let entitlementDetail: String?

  var body: some View {
    if window.kind == .entitlement {
      entitlementRow
    } else {
      quotaRow
    }
  }

  private var quotaRow: some View {
    HStack(spacing: 7) {
      Text(window.label)
        .lineLimit(1)
        .help(window.label)
        .frame(width: 91, alignment: .leading)
      progress
        .frame(width: 82)
      Text(remainingText)
        .monospacedDigit()
        .frame(width: 40, alignment: .trailing)
      resetText
        .monospacedDigit()
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .font(.caption)
    .foregroundStyle(stale ? .secondary : .primary)
    .opacity(stale ? 0.65 : 1)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(window.label)
    .accessibilityValue(accessibilityValue)
  }

  private var entitlementRow: some View {
    HStack(spacing: 7) {
      Text(window.label)
        .lineLimit(1)
        .help(window.label)
      Spacer(minLength: 8)
      Text(entitlementDetail ?? "Policy only")
        .lineLimit(1)
        .foregroundStyle(.secondary)
        .help(entitlementDetail ?? "No independent usage counter was returned.")
    }
    .font(.caption)
    .opacity(stale ? 0.65 : 1)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var progress: some View {
    if let remaining = window.remainingPercent {
      ProgressView(value: remaining, total: 100)
        .progressViewStyle(.linear)
        .tint(progressColor(for: remaining))
        .accessibilityHidden(true)
    } else {
      Text("—")
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
  }

  @ViewBuilder private var resetText: some View {
    if let resetAt = window.resetAt {
      Text(QuotaTimeFormatter.compactCountdown(to: resetAt, from: date))
        .foregroundStyle(.secondary)
        .help("Resets \(resetAt.formatted(date: .abbreviated, time: .shortened))")
    } else {
      Text("—")
        .foregroundStyle(.tertiary)
    }
  }

  private var remainingText: String {
    guard let remaining = window.remainingPercent else { return "—" }
    return "\(Int(remaining.rounded()))%"
  }

  private var accessibilityValue: String {
    var values: [String] = []
    if let remaining = window.remainingPercent {
      values.append("\(Int(remaining.rounded())) percent remaining")
    } else {
      values.append("usage unknown")
    }
    if stale { values.append("stale") }
    if let resetAt = window.resetAt {
      values.append("resets \(resetAt.formatted(date: .abbreviated, time: .shortened))")
    }
    return values.joined(separator: ", ")
  }

  private func progressColor(for remaining: Double) -> Color {
    guard !stale else { return .secondary }
    switch QuotaStatus.forRemaining(remaining) {
    case .critical: return .red
    case .warning: return .orange
    case .healthy, .unavailable: return .secondary
    }
  }
}

struct CodexResetRow: View {
  let resetOverview: ResetOverview
  let date: Date
  let stale: Bool

  var body: some View {
    Group {
      switch resetOverview {
      case .none:
        Label("No resets available", systemImage: "arrow.counterclockwise.circle")
      case .available(let resets):
        HStack(spacing: 7) {
          Label(
            "\(resets.count) reset\(resets.count == 1 ? "" : "s")",
            systemImage: "arrow.counterclockwise.circle.fill"
          )
          Spacer()
          Text(expirationText(resets))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .help(absoluteExpirations(resets))
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(absoluteExpirations(resets))
      case .unavailable(let message):
        Label("Resets unavailable", systemImage: "arrow.counterclockwise.circle")
          .help(message)
          .accessibilityHint(message)
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .opacity(stale ? 0.65 : 1)
  }

  private func expirationText(_ resets: [Reset]) -> String {
    resets
      .map { QuotaTimeFormatter.compactCountdown(to: $0.exp, from: date) }
      .joined(separator: ", ")
  }

  private func absoluteExpirations(_ resets: [Reset]) -> String {
    resets
      .map { "Expires \($0.exp.formatted(date: .abbreviated, time: .shortened))" }
      .joined(separator: "\n")
  }
}

struct QuotaSummaryView: View {
  let summary: QuotaOverviewSummary
  let date: Date

  var body: some View {
    HStack(spacing: 7) {
      Image(systemName: symbolName)
        .foregroundStyle(color)
      Text(text)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .font(.caption)
    .frame(maxWidth: .infinity, alignment: .leading)
    .help(helpText)
    .accessibilityElement(children: .combine)
    .accessibilityValue(helpText)
  }

  private var text: String {
    switch summary {
    case let .quota(provider, window):
      guard let remaining = window.remainingPercent else {
        preconditionFailure("Summary window requires a remaining percentage")
      }
      var value =
        "\(provider.displayName) \(window.label) is tightest — "
        + "\(Int(remaining.rounded()))% left"
      if let resetAt = window.resetAt {
        value += " · \(QuotaTimeFormatter.compactCountdown(to: resetAt, from: date)) to reset"
      }
      return value
    case .stale(let provider, _):
      return "\(provider.displayName) usage is stale"
    case .unavailable(let provider, _):
      return "\(provider.displayName) usage is unavailable"
    case .unauthenticated(let provider, _):
      return "\(provider.displayName) needs sign-in"
    case .loading(let provider):
      return "Checking \(provider.displayName) usage…"
    case .unknown(let provider):
      return "\(provider.displayName) usage percentage is unknown"
    case .noProvidersEnabled:
      return "No subscription providers are enabled"
    }
  }

  private var helpText: String {
    switch summary {
    case .quota(_, let window):
      guard let resetAt = window.resetAt else { return "Tightest current subscription quota." }
      return "Resets \(resetAt.formatted(date: .abbreviated, time: .shortened))"
    case .stale(_, let reason): return reason
    case .unavailable(_, let message): return message
    case .unauthenticated(_, let message): return message
    case .loading: return "QuotaBar is waiting for the provider response."
    case .unknown: return "The provider returned no usage percentage."
    case .noProvidersEnabled: return "Enable a provider in Settings."
    }
  }

  private var symbolName: String {
    switch summary.status {
    case .critical: "exclamationmark.circle.fill"
    case .warning: "exclamationmark.triangle.fill"
    case .healthy: "circle.fill"
    case .unavailable: "circle.dashed"
    }
  }

  private var color: Color {
    switch summary.status {
    case .critical: .red
    case .warning: .orange
    case .healthy, .unavailable: .secondary
    }
  }
}

struct ProviderLogo: View {
  let provider: ProviderID

  var body: some View {
    Image(nsImage: image)
      .resizable()
      .scaledToFit()
      .frame(width: 18, height: 18)
      .accessibilityHidden(true)
  }

  private var image: NSImage {
    guard let url = resourceBundle.url(forResource: provider.logoName, withExtension: "svg"),
      let image = NSImage(contentsOf: url)
    else {
      preconditionFailure("Missing bundled logo for \(provider.rawValue)")
    }
    return image
  }

  private var resourceBundle: Bundle {
    #if SWIFT_PACKAGE
      Bundle.module
    #else
      Bundle.main
    #endif
  }
}

extension ProviderID {
  fileprivate var logoName: String {
    switch self {
    case .claudeCode: "claude"
    case .codex: "codex"
    case .kimi: "kimi"
    case .grok: "grok"
    }
  }
}

extension QuotaStatus {
  var symbolName: String {
    switch self {
    case .healthy: "gauge.with.dots.needle.67percent"
    case .warning: "gauge.with.dots.needle.33percent"
    case .critical: "gauge.with.dots.needle.0percent"
    case .unavailable: "gauge.with.dots.needle.50percent"
    }
  }

  var color: Color {
    switch self {
    case .warning: .orange
    case .critical: .red
    case .healthy, .unavailable: .secondary
    }
  }
}
