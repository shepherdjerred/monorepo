import AppKit
import QuotaBarCore
import SwiftUI

/// The Sessions window: an agent-session browser over the toolkit history
/// daemon. Sidebar | session list | detail, or sidebar | Analytics.
struct SessionsWindow: View {
  static let id = "sessions"

  @Bindable var model: SessionsModel

  var body: some View {
    NavigationSplitView {
      SessionsSidebar(model: model)
        .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
    } detail: {
      if model.selection == .analytics {
        SessionsAnalyticsView(model: model)
      } else {
        HSplitView {
          SessionListView(model: model)
            .frame(minWidth: 320, idealWidth: 420, maxWidth: 560, maxHeight: .infinity)
          SessionDetailView(model: model)
            .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
        }
      }
    }
    .searchable(text: $model.searchText, placement: .toolbar, prompt: "Search sessions")
    .onSubmit(of: .search) { model.submitSearch() }
    .onChange(of: model.searchText) { _, text in
      if text.isEmpty { model.clearSearch() }
    }
    .toolbar {
      ToolbarItem {
        Picker("Time range", selection: $model.range) {
          ForEach(HistoryTimeRange.allCases) { range in
            Text(range.label).tag(range)
          }
        }
        .pickerStyle(.menu)
        .help("Sessions updated, and usage that happened, within this range")
      }
      ToolbarItem {
        Button {
          Task { await refresh() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .help("Reload from the history daemon")
      }
    }
    .navigationTitle("Sessions")
    // Loads hang off the window, not the split view's children, which
    // AppKit may rebuild while their content changes.
    .task { await model.loadFacets() }
    .task(id: model.listQuery) {
      guard model.selection != .analytics else { return }
      await model.loadSessions()
    }
    .task(id: model.selectedSessionID) { await model.loadConversation() }
    .frame(minWidth: 960, minHeight: 560)
  }

  private func refresh() async {
    await model.loadFacets()
    if model.selection == .analytics {
      await model.loadAnalytics()
    } else {
      await model.loadSessions()
      if model.selectedSessionID != nil { await model.loadConversation() }
    }
  }
}

/// A daemon error with its message and the command that fixes it.
struct HistoryErrorView: View {
  let error: HistoryAPIError

  var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: symbol)
    } description: {
      VStack(spacing: 10) {
        Text(error.localizedDescription)
        if let suggestion = error.recoverySuggestion {
          Text(suggestion).foregroundStyle(.secondary)
        }
        if let command = error.fixCommand {
          FixCommandView(command: command)
        }
      }
    }
  }

  private var title: String {
    switch error {
    case .daemonNotRunning: "History daemon not running"
    case .server(status: 404, _): "Not found"
    case .decoding, .unsupportedAPIVersion, .malformedHTTP: "History daemon version mismatch"
    case .connectionFailed, .server: "History daemon unavailable"
    }
  }

  private var symbol: String {
    switch error {
    case .daemonNotRunning: "bolt.horizontal.circle"
    case .server(status: 404, _): "questionmark.folder"
    default: "exclamationmark.triangle"
    }
  }
}

struct FixCommandView: View {
  let command: String

  var body: some View {
    HStack(spacing: 6) {
      Text(command)
        .font(.system(.callout, design: .monospaced))
        .textSelection(.enabled)
      Button {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(command, forType: .string)
      } label: {
        Image(systemName: "doc.on.doc")
      }
      .buttonStyle(.borderless)
      .help("Copy command")
      .accessibilityLabel("Copy \(command)")
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
  }
}

/// A session's cost, or `—` when its agent recorded no usage.
struct SessionCostText: View {
  let session: HistorySession

  var body: some View {
    if session.hasUsage {
      CostText(usage: session.usage)
    } else {
      Text(HistoryFormat.noUsage)
        .foregroundStyle(.secondary)
        .help(HistoryFormat.noUsageNote)
        .accessibilityLabel("No usage data")
    }
  }
}

/// Cost text that marks a partial (lower-bound) amount.
struct CostText: View {
  let usage: HistoryUsage

  var body: some View {
    Text(HistoryFormat.cost(usage))
      .monospacedDigit()
      .foregroundStyle(usage.costComplete ? .primary : .secondary)
      .help(HistoryFormat.costNote(usage) ?? "Estimated at API list prices")
  }
}
