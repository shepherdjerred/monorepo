import QuotaBarCore
import SwiftUI

/// The Requests tab: a session's captured API requests over time, and an
/// inspector for the selected one. A capture's detail loads only when it is
/// selected.
struct RequestsView: View {
  @Bindable var model: CapturesModel
  let sessionID: Int

  var body: some View {
    content
      .task(id: sessionID) { await model.load(session: sessionID) }
      .task(id: model.selectedCaptureID) { await model.loadSelectedDetail() }
  }

  @ViewBuilder private var content: some View {
    if let error = model.listPhase.error, model.captures.isEmpty {
      HistoryErrorView(error: error)
    } else if model.captures.isEmpty {
      if model.listPhase == .loaded {
        CapturesEmptyState()
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    } else {
      // The timeline is only as tall as its rows (up to five), so the
      // inspector keeps most of the column.
      VStack(spacing: 0) {
        CaptureTimeline(model: model)
          .frame(height: min(CGFloat(model.captures.count), 5) * 46 + 40)
        Divider()
        CaptureInspectorPane(model: model)
          .frame(maxHeight: .infinity)
      }
    }
  }
}

private struct CapturesEmptyState: View {
  var body: some View {
    ContentUnavailableView {
      Label("No captured requests", systemImage: "antenna.radiowaves.left.and.right.slash")
    } description: {
      VStack(spacing: 10) {
        Text(
          "Request capture is off, or this session was not run through the capture proxy. "
            + "Turn it on with the command below; the wiki's \u{201C}Capture raw agent "
            + "requests\u{201D} how-to has the setup."
        )
        FixCommandView(command: "brim capture install")
      }
    }
  }
}

/// The captures in request order, with tokens and context composition.
private struct CaptureTimeline: View {
  @Bindable var model: CapturesModel

  var body: some View {
    VStack(spacing: 0) {
      ContextLegend()
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
      Divider()
      List(selection: $model.selectedCaptureID) {
        ForEach(model.captures) { capture in
          CaptureRow(capture: capture, largestContext: largestContext).tag(capture.id)
        }
        if model.hasMore {
          Button("Load more requests") {
            Task { await model.loadMore() }
          }
        }
      }
      .listStyle(.inset)
    }
  }

  private var largestContext: Int {
    max(model.captures.map(\.context.totalBytes).max() ?? 0, 1)
  }
}

private struct CaptureRow: View {
  let capture: HistoryCapture
  let largestContext: Int

  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(capture.startedAt.formatted(date: .omitted, time: .standard))
          .monospacedDigit()
        Text(CaptureText.duration(capture.durationMs))
          .font(.caption)
          .foregroundStyle(.secondary)
          .monospacedDigit()
      }
      .frame(width: 84, alignment: .leading)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(capture.model ?? capture.cli).font(.body.weight(.medium))
          if let attention = CaptureText.attention(capture) {
            Text(attention)
              .font(.caption2.weight(.semibold))
              .padding(.horizontal, 5)
              .padding(.vertical, 1)
              .background(.red.opacity(0.18), in: Capsule())
              .help(capture.error ?? attention)
          }
          if !capture.contextComplete {
            Image(systemName: "exclamationmark.triangle.fill")
              .foregroundStyle(.orange)
              .help(CaptureText.incompleteContextNote)
              .accessibilityLabel("Context incomplete")
          }
        }
        Text(CaptureText.tokens(capture.usage))
          .font(.caption)
          .foregroundStyle(.secondary)
          .monospacedDigit()
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 2) {
        ContextBar(context: capture.context, scale: largestContext)
          .frame(width: 160, height: 8)
        Text(
          "\(CaptureText.bytes(capture.context.totalBytes)) · "
            + "\(capture.newBlockCount) new of \(capture.blockCount)"
        )
        .font(.caption2)
        .foregroundStyle(.secondary)
        .monospacedDigit()
      }
    }
    .padding(.vertical, 2)
  }
}

/// System, tools, history, and new bytes as one stacked bar, scaled to the
/// session's largest request.
struct ContextBar: View {
  let context: CaptureContext
  let scale: Int

  var body: some View {
    GeometryReader { proxy in
      HStack(spacing: 0) {
        ForEach(ContextPart.allCases) { part in
          Rectangle()
            .fill(part.color)
            .frame(width: proxy.size.width * Double(part.bytes(context)) / Double(max(scale, 1)))
        }
        Spacer(minLength: 0)
      }
      .clipShape(Capsule())
      .background(Color.secondary.opacity(0.12), in: Capsule())
    }
    .help(
      ContextPart.allCases.map { "\($0.label): \(CaptureText.bytes($0.bytes(context)))" }
        .joined(separator: "\n")
    )
    .accessibilityLabel("Context composition")
  }
}

private struct ContextLegend: View {
  var body: some View {
    HStack(spacing: 12) {
      ForEach(ContextPart.allCases) { part in
        Label {
          Text(part.label)
        } icon: {
          Circle().fill(part.color).frame(width: 7, height: 7)
        }
      }
      Spacer()
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}

enum ContextPart: CaseIterable, Identifiable {
  case system
  case tools
  case history
  case new

  var id: Self { self }

  var label: String {
    switch self {
    case .system: "System"
    case .tools: "Tools"
    case .history: "History"
    case .new: "New"
    }
  }

  var color: Color {
    switch self {
    case .system: .purple
    case .tools: .orange
    case .history: .gray
    case .new: .accentColor
    }
  }

  func bytes(_ context: CaptureContext) -> Int {
    switch self {
    case .system: context.systemBytes
    case .tools: context.toolsBytes
    case .history: context.historyBytes
    case .new: context.newBytes
    }
  }
}

private struct CaptureInspectorPane: View {
  let model: CapturesModel

  var body: some View {
    if let detail = model.detail {
      CaptureInspector(detail: detail)
    } else if let error = model.detailPhase.error {
      HistoryErrorView(error: error)
    } else if model.detailPhase == .loading {
      ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ContentUnavailableView(
        "No request selected", systemImage: "arrow.up.arrow.down",
        description: Text("Choose a request to inspect what it sent and received."))
    }
  }
}
