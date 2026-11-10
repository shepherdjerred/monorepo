import QuotaBarCore
import SwiftUI

struct SessionsSidebar: View {
  @Bindable var model: SessionsModel

  var body: some View {
    List(selection: selection) {
      Section {
        Label("All sessions", systemImage: "tray.full").tag(SessionsSidebarItem.all)
        Label("Analytics", systemImage: "chart.bar.xaxis").tag(SessionsSidebarItem.analytics)
      }
      facetSection("Machines", facets: model.facets.machines, symbol: "desktopcomputer")
      facetSection("Agents", facets: model.facets.sources, symbol: "sparkles")
      facetSection("Projects", facets: model.facets.workspaces, symbol: "folder")
      if let error = model.facetsPhase.error {
        Section {
          Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(3)
            .help(error.localizedDescription)
        }
      }
    }
    .listStyle(.sidebar)
  }

  private var selection: Binding<SessionsSidebarItem?> {
    Binding(
      get: { model.selection },
      set: { item in
        if let item { model.selection = item }
      })
  }

  @ViewBuilder
  private func facetSection(_ title: String, facets: [SessionsFacet], symbol: String)
    -> some View
  {
    if !facets.isEmpty {
      Section(title) {
        ForEach(facets) { facet in
          FacetRow(facet: facet, symbol: symbol).tag(facet.item)
        }
      }
    }
  }
}

private struct FacetRow: View {
  let facet: SessionsFacet
  let symbol: String

  var body: some View {
    HStack(spacing: 6) {
      Label(facet.title, systemImage: symbol)
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer(minLength: 4)
      if let usage = facet.usage {
        Text(HistoryFormat.cost(usage))
          .font(.caption)
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
    }
    .help(help)
  }

  private var help: String {
    var lines = [facet.detail ?? facet.title]
    if let count = facet.sessionCount {
      lines.append("\(count) session\(count == 1 ? "" : "s") with usage, all time")
    }
    if let usage = facet.usage {
      lines.append(
        "\(HistoryFormat.tokens(usage.totalTokens)) tokens · \(HistoryFormat.cost(usage))")
    }
    return lines.joined(separator: "\n")
  }
}
