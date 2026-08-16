import QuotaBarCore
import SwiftUI

struct APIPlatformSummaryView: View {
  let state: APIPlatformDisplayState
  let date: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
      content
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
  }

  private var header: some View {
    HStack(spacing: 7) {
      Image(systemName: "network")
        .foregroundStyle(.blue)
        .accessibilityHidden(true)
      Text("OpenRouter")
        .font(.subheadline.weight(.semibold))
      Spacer()
      Text("All workspaces")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private var content: some View {
    switch state {
    case .loading:
      HStack(spacing: 6) {
        ProgressView().controlSize(.mini)
        Text("Checking API usage…")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    case let .available(snapshot):
      snapshotContent(snapshot, staleReason: nil)
    case let .stale(snapshot, reason):
      snapshotContent(snapshot, staleReason: reason)
    case let .unauthenticated(message):
      statusRow(
        "Management API key required",
        symbol: "key",
        help: message
      )
    case let .unavailable(message):
      statusRow("API usage unavailable", symbol: "exclamationmark.triangle", help: message)
    }
  }

  private func snapshotContent(
    _ snapshot: APIPlatformSnapshot,
    staleReason: String?
  ) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(spacing: 6) {
        metric("Credits remaining", value: snapshot.creditsRemaining)
        metric("Monthly API spend", value: snapshot.monthlySpend)
        metric("Projected spend", value: snapshot.projectedSpend)
      }
      .opacity(staleReason == nil ? 1 : 0.62)

      Text(workspaceDetail(snapshot.workspaceNames))
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .help(snapshot.workspaceNames.joined(separator: ", "))

      HStack(spacing: 5) {
        if let staleReason {
          Label("STALE", systemImage: "clock.badge.exclamationmark")
            .foregroundStyle(.orange)
            .help(staleReason)
        }
        Text("Updated \(QuotaTimeFormatter.refreshAge(since: snapshot.sourceTimestamp, at: date))")
          .foregroundStyle(.secondary)
        Spacer()
      }
      .font(.caption2)

      Text(
        "Monthly spend is OpenRouter API-key usage and includes estimated BYOK spend. "
          + "Projection uses the current local calendar pace."
      )
      .font(.caption2)
      .foregroundStyle(.tertiary)
      .fixedSize(horizontal: false, vertical: true)
    }
  }

  private func metric(_ label: String, value: Decimal) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      Text(currency(value))
        .font(.subheadline.monospacedDigit().weight(.semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .accessibilityLabel("\(label), \(currency(value))")
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func workspaceDetail(_ names: [String]) -> String {
    switch names.count {
    case 0:
      return "No workspace names returned"
    case 1:
      return names[0]
    default:
      let visible = names.prefix(2).joined(separator: " · ")
      let remaining = names.count - min(names.count, 2)
      let suffix = remaining == 1 ? "" : "s"
      return remaining == 0
        ? visible
        : "\(visible) · +\(remaining) more workspace\(suffix)"
    }
  }

  private func currency(_ value: Decimal) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = "USD"
    formatter.locale = .current
    return value.formatted(.currency(code: "USD"))
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
