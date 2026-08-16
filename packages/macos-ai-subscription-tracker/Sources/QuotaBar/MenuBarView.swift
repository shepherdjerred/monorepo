import AppKit
import QuotaBarCore
import SwiftUI

struct MenuBarView: View {
  @Bindable var model: QuotaBarModel
  let startupError: String?
  @State private var measuredProviderHeight: CGFloat = 220

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { timeline in
      content(at: timeline.date)
    }
    .frame(width: 372)
  }

  private func content(at date: Date) -> some View {
    let overview = QuotaOverview(states: providerStates, at: date)
    return VStack(spacing: 0) {
      header(overview: overview, date: date)
      navigationSegments
      WindowColumnHeader()
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
      Divider()
      providerList(overview: overview, date: date)
      Divider()
      spendRow
      Divider()
      footer
    }
  }

  private var providerStates: [ProviderID: ProviderDisplayState] {
    Dictionary(
      uniqueKeysWithValues: ProviderID.allCases.map { provider in
        (provider, model.state(for: provider))
      }
    )
  }

  private func header(overview: QuotaOverview, date: Date) -> some View {
    HStack(spacing: 8) {
      BrimBrandMark()
      Text("Brim")
        .font(.headline)
      Spacer()
      Text(lastRefreshText(overview: overview, date: date))
        .font(.caption2)
        .foregroundStyle(.secondary)
        .monospacedDigit()
      Button {
        Task { await model.refresh() }
      } label: {
        if model.isRefreshing {
          ProgressView().controlSize(.small)
        } else {
          Image(systemName: "arrow.clockwise")
        }
      }
      .buttonStyle(.plain)
      .disabled(model.isRefreshing)
      .help(model.isRefreshing ? "Refreshing usage" : "Refresh usage")
      .accessibilityLabel(model.isRefreshing ? "Refreshing usage" : "Refresh usage")
    }
    .padding(.horizontal, 12)
    .padding(.top, 8)
    .padding(.bottom, 6)
  }

  private var navigationSegments: some View {
    HStack(spacing: 2) {
      Text("Subscriptions")
        .font(.caption.weight(.medium))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(.background, in: RoundedRectangle(cornerRadius: 5))
        .accessibilityAddTraits(.isSelected)
      Text("API & routers")
        .font(.caption)
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .help("API keys and routers are not supported yet.")
        .accessibilityLabel("API and routers, unavailable")
        .accessibilityHint("API keys and routers are not supported yet.")
    }
    .padding(2)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 7))
    .padding(.horizontal, 12)
    .padding(.bottom, 7)
  }

  private func providerList(overview: QuotaOverview, date: Date) -> some View {
    ScrollView {
      VStack(spacing: 0) {
        if let startupError {
          StatusMessage(symbol: "exclamationmark.triangle", text: startupError)
        }
        ForEach(overview.providers) { provider in
          ProviderSectionView(overview: provider, date: date)
          if provider.id != overview.providers.last?.id {
            Divider().padding(.leading, 25)
          }
        }
        if let cacheError = model.cacheErrorMessage {
          StatusMessage(symbol: "externaldrive.badge.exclamationmark", text: cacheError)
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 2)
      .background {
        GeometryReader { geometry in
          Color.clear.preference(
            key: ProviderListHeightPreference.self,
            value: geometry.size.height
          )
        }
      }
    }
    .scrollBounceBehavior(.basedOnSize)
    .frame(height: min(max(measuredProviderHeight, 220), 460))
    .onPreferenceChange(ProviderListHeightPreference.self) { height in
      guard height > 0 else { return }
      measuredProviderHeight = height
    }
  }

  private var spendRow: some View {
    HStack {
      Text("Subscriptions")
      Spacer()
      Text("$\(SubscriptionPlan.totalMonthlyCostUSD)/mo")
        .monospacedDigit()
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 12)
    .padding(.vertical, 7)
    .help("Claude Code $200, Codex $200, Kimi $40, Grok $30")
  }

  private var footer: some View {
    HStack {
      SettingsLink { Label("Settings…", systemImage: "gear") }
      Spacer()
      Button("Quit") { NSApplication.shared.terminate(nil) }
    }
    .font(.caption)
    .padding(.horizontal, 12)
    .padding(.vertical, 7)
  }

  private func lastRefreshText(overview: QuotaOverview, date: Date) -> String {
    guard let lastUpdatedAt = overview.lastUpdatedAt else { return "Not refreshed" }
    return QuotaTimeFormatter.refreshAge(since: lastUpdatedAt, at: date)
  }
}

private struct ProviderListHeightPreference: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

private struct StatusMessage: View {
  let symbol: String
  let text: String

  var body: some View {
    Label(text, systemImage: symbol)
      .font(.caption)
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 6)
      .help(text)
  }
}
