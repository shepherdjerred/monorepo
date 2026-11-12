import QuotaBarCore
import SwiftUI

/// The middle column: a page of sessions or search results for the sidebar
/// selection and time range.
struct SessionListView: View {
  @Bindable var model: SessionsModel

  var body: some View {
    content
  }

  @ViewBuilder private var content: some View {
    if let error = model.listPhase.error, model.sessions.isEmpty {
      HistoryErrorView(error: error)
    } else if model.sessions.isEmpty {
      if model.listPhase == .loaded {
        emptyState
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    } else {
      list
    }
  }

  @ViewBuilder private var emptyState: some View {
    if let search = model.activeSearch {
      ContentUnavailableView.search(text: search)
    } else {
      ContentUnavailableView(
        "No sessions",
        systemImage: "text.bubble",
        description: Text("No session was updated in the last \(model.range.label.lowercased()).")
      )
    }
  }

  private var list: some View {
    TimelineView(.periodic(from: .now, by: 60)) { timeline in
      List(selection: $model.selectedSessionID) {
        ForEach(model.sessions) { session in
          SessionRow(session: session, now: timeline.date).tag(session.id)
        }
        if model.hasMoreSessions || model.listPhase.error != nil {
          footer
        }
      }
      .listStyle(.inset)
    }
  }

  @ViewBuilder private var footer: some View {
    if let error = model.listPhase.error {
      Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
        .font(.caption)
        .foregroundStyle(.secondary)
    } else {
      HStack {
        Spacer()
        if model.listPhase == .loading {
          ProgressView().controlSize(.small)
        } else {
          Button("Load more") {
            Task { await model.loadMoreSessions() }
          }
        }
        Spacer()
      }
      .onAppear {
        Task { await model.loadMoreSessions() }
      }
    }
  }
}

private struct SessionRow: View {
  let session: HistorySession
  let now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline) {
        Text(session.title)
          .font(.body.weight(.medium))
          .lineLimit(2)
        Spacer(minLength: 8)
        Text(HistoryFormat.updated(session.updatedAt, relativeTo: now))
          .font(.caption)
          .foregroundStyle(.secondary)
          .monospacedDigit()
          .fixedSize()
      }
      HStack(spacing: 6) {
        Text(metadata)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 8)
        Text(HistoryFormat.tokens(of: session))
          .monospacedDigit()
          .fixedSize()
        SessionCostText(session: session).fixedSize()
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 3)
    .help(session.workspace ?? session.title)
  }

  /// Mirrored agents already name their machine ("Claude Code · Jerreds-MacBook-Pro").
  private var metadata: String {
    let agent = session.agent ?? session.source.displayName
    let machine = HistoryFormat.machine(session.machine)
    return [
      agent,
      agent.localizedCaseInsensitiveContains(machine) ? nil : machine,
      session.workspace.map(HistoryFormat.workspaceName),
      session.gitBranch,
    ]
    .compactMap(\.self)
    .joined(separator: " · ")
  }
}
