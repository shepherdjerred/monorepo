import AppKit
import QuotaBarCore
import SwiftUI

struct WindowColumnHeader: View {
  var body: some View {
    HStack(spacing: 7) {
      Text("WINDOW")
        .frame(width: 96, alignment: .leading)
      Color.clear
        .frame(width: 82)
      Text("LEFT")
        .frame(width: 40, alignment: .trailing)
      Text("RESETS")
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .font(.caption2.monospaced().weight(.semibold))
    .foregroundStyle(.secondary)
    .accessibilityHidden(true)
  }
}

struct ProviderBadgeView: View {
  let badge: ProviderBadge

  var body: some View {
    Text(title)
      .font(.caption2.monospaced().weight(.semibold))
      .foregroundStyle(color)
      .padding(.horizontal, 4)
      .padding(.vertical, 2)
      .background(color.opacity(0.14), in: Capsule())
      .help(helpText)
      .accessibilityLabel(title)
      .accessibilityHint(helpText)
  }

  private var title: String {
    switch badge.kind {
    case .stale: return ageTitle(prefix: "STALE")
    case .partial: return ageTitle(prefix: "PARTIAL")
    case .noResets: return "NO RESETS"
    case .resets:
      let count = badge.expirations.count
      return "\(count) RESET\(count == 1 ? "" : "S")"
    case .resetsUnavailable: return "RESETS UNAVAILABLE"
    }
  }

  private var helpText: String {
    switch badge.kind {
    case .stale, .partial:
      return [badge.detail, badge.age.map { "Age \($0)" }]
        .compactMap { $0 }
        .joined(separator: " · ")
    case .noResets, .resetsUnavailable:
      return badge.detail ?? title
    case .resets:
      return badge.expirations
        .map { "Expires \($0.formatted(date: .abbreviated, time: .shortened))" }
        .joined(separator: "\n")
    }
  }

  private var color: Color {
    switch badge.kind {
    case .stale, .resetsUnavailable: return .secondary
    case .partial: return .orange
    case .noResets: return .secondary
    case .resets: return .blue
    }
  }

  private func ageTitle(prefix: String) -> String {
    guard let age = badge.age else { return prefix }
    return "\(prefix) \(age)"
  }
}

struct ProviderSectionView: View {
  let overview: ProviderOverview
  let date: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      header
      content
    }
    .padding(.vertical, 8)
    .opacity(overview.dimsContent ? 0.58 : 1)
    .accessibilityElement(children: .contain)
  }

  private var header: some View {
    HStack(spacing: 7) {
      ProviderLogo(provider: overview.provider)
      Text(overview.provider.displayName)
        .font(.subheadline.weight(.semibold))
      ForEach(overview.badges) { badge in
        ProviderBadgeView(badge: badge)
      }
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
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 7) {
        Text(window.compactDisplayLabel)
          .lineLimit(1)
          .help(window.label)
          .frame(width: 96, alignment: .leading)
        progress
          .frame(width: 82)
        Text(remainingText)
          .monospacedDigit()
          .frame(width: 40, alignment: .trailing)
        resetText
          .monospacedDigit()
          .frame(maxWidth: .infinity, alignment: .trailing)
      }
      if let pacing = WindowPacing.compute(window: window, at: pacingDate) {
        pacingCaption(pacing)
          .padding(.leading, 103)
      }
    }
    .font(.caption)
    .foregroundStyle(stale ? .secondary : .primary)
    .opacity(stale ? 0.65 : 1)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(window.compactDisplayLabel), raw label \(window.label)")
    .accessibilityValue(accessibilityValue)
  }

  private func pacingCaption(_ pacing: WindowPacing) -> some View {
    let label = pacingStatusLabel(pacing.status)
    let actual = WindowPacing.format(pacing.actualPacePerDay)
    let even = WindowPacing.format(pacing.evenPacePerDay)
    return Text("\(label) · pace \(actual) · even \(even)")
      .font(.caption2)
      .monospacedDigit()
      .foregroundStyle(stale ? .secondary : pacingColor(for: pacing.status))
      .help(pacingHelp(pacing))
      .accessibilityHidden(true)
  }

  private func pacingStatusLabel(_ status: WindowPacing.Status) -> String {
    switch status {
    case .ahead: return "ahead"
    case .onPace: return "on pace"
    case .behind: return "behind"
    }
  }

  private func pacingHelp(_ pacing: WindowPacing) -> String {
    let days = String(format: "%.1f", pacing.daysRemaining)
    return "You are \(pacingStatusLabel(pacing.status)) of an even split: "
      + "you have \(remainingText) left with \(days) days to go, or "
      + "\(WindowPacing.format(pacing.actualPacePerDay)) available per day vs "
      + "\(WindowPacing.format(pacing.evenPacePerDay)) at an even split."
  }

  private func pacingColor(for status: WindowPacing.Status) -> Color {
    switch status {
    case .ahead: return Color(red: 0.24, green: 0.55, blue: 0.36)
    case .onPace: return .secondary
    case .behind: return .orange
    }
  }

  private var entitlementRow: some View {
    HStack(spacing: 7) {
      Text(window.compactDisplayLabel)
        .lineLimit(1)
        .help(window.label)
        .frame(width: 96, alignment: .leading)
      Spacer(minLength: 8)
      Text(entitlementDetail ?? "Policy only")
        .lineLimit(1)
        .foregroundStyle(.secondary)
        .help(entitlementDetail ?? "No independent usage counter was returned.")
    }
    .font(.caption)
    .opacity(stale ? 0.65 : 1)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(window.compactDisplayLabel), raw label \(window.label)")
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

  private var pacingDate: Date {
    stale ? window.sourceTimestamp : date
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
    if let pacing = WindowPacing.compute(window: window, at: pacingDate) {
      let label = pacingStatusLabel(pacing.status)
      let actual = WindowPacing.format(pacing.actualPacePerDay)
      let even = WindowPacing.format(pacing.evenPacePerDay)
      values.append("\(label), pace \(actual), even split \(even)")
    }
    return values.joined(separator: ", ")
  }

  private func progressColor(for remaining: Double) -> Color {
    guard !stale else { return .secondary }
    switch QuotaStatus.forRemaining(remaining) {
    case .critical: return .red
    case .warning: return .orange
    case .healthy: return Color(red: 0.23, green: 0.45, blue: 0.62)
    case .unavailable: return .secondary
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
    PackagedResources.bundle
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
