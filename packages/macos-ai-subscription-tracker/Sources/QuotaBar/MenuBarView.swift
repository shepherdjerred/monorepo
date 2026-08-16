import AppKit
import QuotaBarCore
import SwiftUI

struct MenuBarView: View {
  @Bindable var model: QuotaBarModel
  @Bindable var apiModel: APIPlatformModel
  let startupError: String?
  @State private var measuredProviderHeight: CGFloat = 220
  @State private var selectedSegment: DashboardSegment = .subscriptions
  // MenuBarExtra centers short window-style content vertically. Keep both
  // segments in the same top-anchored menu-bar surface.
  private let menuBarWindowMinimumHeight: CGFloat = 500

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { timeline in
      content(at: timeline.date)
    }
    .frame(width: 372)
    .frame(minHeight: menuBarWindowMinimumHeight, alignment: .top)
    .background(Color(nsColor: .windowBackgroundColor))
  }

  private func content(at date: Date) -> some View {
    switch selectedSegment {
    case .subscriptions:
      let overview = QuotaOverview(states: providerStates, at: date)
      return AnyView(
        VStack(spacing: 0) {
          header(
            lastUpdatedAt: overview.lastUpdatedAt,
            isRefreshing: model.isRefreshing,
            date: date
          ) {
            Task { await model.refresh() }
          }
          navigationSegments
          WindowColumnHeader()
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
          Divider()
          providerList(overview: overview, date: date)
          Divider()
          spendRow
          Spacer(minLength: 0)
          Divider()
          footer
        }
        .frame(minHeight: menuBarWindowMinimumHeight, alignment: .top)
      )
    case .api:
      return AnyView(
        VStack(spacing: 0) {
          header(
            lastUpdatedAt: apiLastUpdatedAt,
            isRefreshing: apiModel.isRefreshing,
            date: date
          ) {
            Task { await apiModel.refresh() }
          }
          navigationSegments
          Divider()
          APIPlatformSummaryView(state: apiModel.state, date: date)
            .frame(minHeight: 220)
          if let cacheError = apiModel.cacheErrorMessage {
            Divider()
            StatusMessage(symbol: "externaldrive.badge.exclamationmark", text: cacheError)
              .padding(.horizontal, 12)
          }
          Spacer(minLength: 0)
          Divider()
          footer
        }
        .frame(minHeight: menuBarWindowMinimumHeight, alignment: .top)
      )
    }
  }

  private var providerStates: [ProviderID: ProviderDisplayState] {
    Dictionary(
      uniqueKeysWithValues: ProviderID.allCases.map { provider in
        (provider, model.state(for: provider))
      }
    )
  }

  private func header(
    lastUpdatedAt: Date?,
    isRefreshing: Bool,
    date: Date,
    refreshAction: @escaping () -> Void
  ) -> some View {
    HStack(spacing: 8) {
      BrimBrandMark()
      Text("Brim")
        .font(.headline)
      Spacer()
      Text(lastRefreshText(lastUpdatedAt: lastUpdatedAt, date: date))
        .font(.caption2)
        .foregroundStyle(.secondary)
        .monospacedDigit()
      Button(action: refreshAction) {
        if isRefreshing {
          ProgressView().controlSize(.small)
        } else {
          Image(systemName: "arrow.clockwise")
        }
      }
      .buttonStyle(.plain)
      .disabled(isRefreshing)
      .help(isRefreshing ? "Refreshing usage" : "Refresh usage")
      .accessibilityLabel(isRefreshing ? "Refreshing usage" : "Refresh usage")
    }
    .padding(.horizontal, 12)
    .padding(.top, 8)
    .padding(.bottom, 6)
  }

  private var navigationSegments: some View {
    HStack(spacing: 2) {
      segmentButton(.subscriptions, title: "Subscriptions")
      segmentButton(.api, title: "API & routers")
    }
    .padding(2)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 7))
    .padding(.horizontal, 12)
    .padding(.bottom, 7)
  }

  private func segmentButton(_ segment: DashboardSegment, title: String) -> some View {
    Button {
      selectedSegment = segment
    } label: {
      Text(title)
        .font(.caption.weight(selectedSegment == segment ? .medium : .regular))
        .foregroundStyle(selectedSegment == segment ? .primary : .secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(
          selectedSegment == segment ? Color.primary.opacity(0.08) : Color.clear,
          in: RoundedRectangle(cornerRadius: 5)
        )
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selectedSegment == segment ? .isSelected : [])
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

  private func lastRefreshText(lastUpdatedAt: Date?, date: Date) -> String {
    guard let lastUpdatedAt else { return "Not refreshed" }
    return QuotaTimeFormatter.refreshAge(since: lastUpdatedAt, at: date)
  }

  private var apiLastUpdatedAt: Date? {
    switch apiModel.state {
    case let .available(snapshot), let .stale(snapshot, _):
      snapshot.sourceTimestamp
    case .loading, .unavailable, .unauthenticated:
      nil
    }
  }
}

private enum DashboardSegment {
  case subscriptions
  case api
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
