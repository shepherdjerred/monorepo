import QuotaBarCore
import SwiftUI

/// A session's messages, paged from the daemon. Tool calls are collapsed
/// and labelled with the tool's name.
struct ConversationView: View {
  let model: SessionsModel
  let conversation: SessionConversation

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10) {
        ForEach(conversation.entries) { entry in
          MessageView(message: entry.message)
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

private struct MessageView: View {
  let message: HistoryMessage
  @State private var expanded = false

  var body: some View {
    if message.role == .tool {
      DisclosureGroup(isExpanded: $expanded) {
        Text(message.text)
          .font(.system(.caption, design: .monospaced))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(8)
          .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "wrench.and.screwdriver")
          Text(message.toolName ?? "Tool").font(.caption.weight(.semibold))
          Text(firstLine).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      .padding(.horizontal, 10)
    } else {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Text(roleLabel).font(.caption.weight(.semibold)).foregroundStyle(roleColor)
          if let date = message.createdDate {
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
  }

  private var firstLine: String {
    String(message.text.prefix { !$0.isNewline }.prefix(160))
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
