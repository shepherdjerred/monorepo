import QuotaBarCore
import SwiftUI

/// A session's messages, paged from the daemon. Each tool invocation is
/// collapsed under its tool name, with its outputs collapsed inside it.
struct ConversationView: View {
  let model: SessionsModel
  let conversation: SessionConversation

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10) {
        ForEach(conversation.items) { item in
          switch item {
          case let .message(entry):
            MessageView(message: entry.message)
          case let .tool(call, outputs):
            ToolCallView(call: call.message, outputs: outputs)
          case let .output(entry):
            OutputView(message: entry.message).padding(.horizontal, 10)
          }
        }
        footer
      }
      .padding(16)
    }
  }

  @ViewBuilder private var footer: some View {
    if let error = model.detailPhase.error {
      Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
        .font(.caption)
        .foregroundStyle(.secondary)
    } else if conversation.hasMore {
      HStack {
        Spacer()
        if model.detailPhase == .loading {
          ProgressView().controlSize(.small)
        } else {
          Button("Load more messages") {
            Task { await model.loadMoreMessages() }
          }
        }
        Spacer()
      }
      Text("Showing \(conversation.entries.count) of \(conversation.totalMessages) messages")
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
    } else if conversation.entries.isEmpty {
      Text("This session has no readable messages.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }
}

private struct ToolCallView: View {
  let call: HistoryMessage
  let outputs: [SessionConversationEntry]
  @State private var expanded = false

  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      VStack(alignment: .leading, spacing: 6) {
        MonospacedBlock(text: call.text)
        ForEach(outputs) { output in
          OutputView(message: output.message)
        }
      }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "wrench.and.screwdriver")
        Text(call.toolName ?? "Tool").font(.caption.weight(.semibold))
        Text(firstLine(call.text)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        if !outputs.isEmpty {
          Spacer(minLength: 4)
          Text(outputs.count == 1 ? "1 output" : "\(outputs.count) outputs")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .fixedSize()
        }
      }
    }
    .padding(.horizontal, 10)
  }
}

/// A tool invocation's output, collapsed by default.
private struct OutputView: View {
  let message: HistoryMessage
  @State private var expanded = false

  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      MonospacedBlock(text: message.text)
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "text.alignleft")
        Text("Output").font(.caption.weight(.semibold))
        Text(firstLine(message.text)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
    }
  }
}

private struct MonospacedBlock: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(.caption, design: .monospaced))
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(8)
      .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
  }
}

private func firstLine(_ text: String) -> String {
  String(text.prefix { !$0.isNewline }.prefix(160))
}

private struct MessageView: View {
  let message: HistoryMessage

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text(roleLabel).font(.caption.weight(.semibold)).foregroundStyle(roleColor)
        if let date = message.createdAt {
          Text(date.formatted(date: .omitted, time: .shortened))
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      Text(message.text)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(background, in: RoundedRectangle(cornerRadius: 8))
  }

  private var roleLabel: String {
    switch message.role {
    case .user: "You"
    case .assistant: "Assistant"
    case .tool: "Tool"
    case .unknown: "Other"
    }
  }

  private var roleColor: Color {
    switch message.role {
    case .user: .accentColor
    case .assistant: .primary
    case .tool, .unknown: .secondary
    }
  }

  private var background: Color {
    switch message.role {
    case .user: Color.accentColor.opacity(0.1)
    case .assistant: Color.secondary.opacity(0.07)
    case .tool, .unknown: Color.secondary.opacity(0.03)
    }
  }
}
