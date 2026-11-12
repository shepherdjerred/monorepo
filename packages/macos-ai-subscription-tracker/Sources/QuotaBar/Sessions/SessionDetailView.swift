import Charts
import QuotaBarCore
import SwiftUI

/// The detail column's tabs. A future Requests tab (raw captured API
/// requests for the session) is added here as another case with its view
/// in `body`'s switch; nothing else in the window changes.
enum SessionDetailTab: String, CaseIterable, Identifiable {
  case conversation = "Conversation"
  case usage = "Usage"

  var id: Self { self }
}

/// The right column: one session's header and its tabs.
struct SessionDetailView: View {
  @Bindable var model: SessionsModel
  @State private var tab: SessionDetailTab = .conversation

  var body: some View {
    Group {
      if model.selectedSessionID == nil {
        ContentUnavailableView(
          "No session selected", systemImage: "text.bubble",
          description: Text("Choose a session to read its conversation and usage."))
      } else if let conversation = model.conversation {
        VStack(spacing: 0) {
          SessionHeader(session: conversation.session)
          Picker("View", selection: $tab) {
            ForEach(SessionDetailTab.allCases) { tab in
              Text(tab.rawValue).tag(tab)
            }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .padding(.horizontal, 16)
          .padding(.bottom, 8)
          Divider()
          switch tab {
          case .conversation:
            ConversationView(model: model, conversation: conversation)
          case .usage:
            if conversation.session.hasUsage {
              SessionUsageView(usage: conversation.session.usage)
            } else {
              ContentUnavailableView(
                "No usage data", systemImage: "gauge.with.dots.needle.0percent",
                description: Text(HistoryFormat.noUsageNote))
            }
          }
        }
      } else if let error = model.detailPhase.error {
        HistoryErrorView(error: error)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }
}

private struct SessionHeader: View {
  let session: HistorySession

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(session.title)
        .font(.title3.weight(.semibold))
        .lineLimit(3)
        .textSelection(.enabled)
      Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 3) {
        row("Agent", session.agent ?? session.source.displayName)
        row("Machine", HistoryFormat.machine(session.machine))
        row("Project", session.workspace)
        row("Branch", session.gitBranch)
        row("Model", session.primaryModel)
        row("Started", session.createdAt.formatted(date: .abbreviated, time: .shortened))
        row("Updated", session.updatedAt.formatted(date: .abbreviated, time: .shortened))
        row("Activity", "\(session.messageCount) messages · \(session.toolCallCount) tool calls")
      }
      .font(.caption)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
  }

  @ViewBuilder
  private func row(_ label: String, _ value: String?) -> some View {
    if let value {
      GridRow {
        Text(label).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
        Text(value).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
      }
    }
  }
}

/// Session totals by token type, with the estimated cost.
private struct SessionUsageView: View {
  let usage: HistoryUsage

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 24) {
          SessionsStat(title: "Estimated cost") { CostText(usage: usage) }
          SessionsStat(title: "Total tokens") {
            Text(HistoryFormat.tokens(usage.totalTokens)).monospacedDigit()
          }
        }
        if let note = HistoryFormat.costNote(usage) {
          Label(note, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary)
        }
        Chart(parts) { part in
          BarMark(x: .value("Tokens", part.count), y: .value("Type", part.label))
            .foregroundStyle(Color.accentColor.gradient)
            .annotation(position: .trailing) {
              Text(HistoryFormat.tokens(part.count))
                .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .chartXAxis(.hidden)
        .chartPlotStyle { $0.brimPlotArea() }
        .frame(height: CGFloat(parts.count) * 30)
        .accessibilityLabel("Tokens by type")
        Text(
          "Cached input is the part of input a provider served from cache (Codex); "
            + "reasoning is part of output. Neither is added to the total again."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      .padding(16)
    }
  }

  private var parts: [TokenPart] {
    [
      TokenPart(label: "Input", count: usage.inputTokens),
      TokenPart(label: "Output", count: usage.outputTokens),
      TokenPart(label: "Cache read", count: usage.cacheReadTokens),
      TokenPart(label: "Cache write", count: usage.cacheCreationTokens),
      TokenPart(label: "Cached input", count: usage.cachedInputTokens),
      TokenPart(label: "Reasoning", count: usage.reasoningTokens),
    ]
  }
}

private struct TokenPart: Identifiable {
  let label: String
  let count: Int

  var id: String { label }
}

/// A caption over a large value.
struct SessionsStat<Value: View>: View {
  let title: String
  @ViewBuilder let value: Value

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title).font(.caption).foregroundStyle(.secondary)
      value.font(.title2.weight(.semibold))
    }
  }
}
