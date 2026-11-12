import QuotaBarCore
import SwiftUI

/// The inspector's views of one captured request.
enum CaptureInspectorMode: String, CaseIterable, Identifiable {
  case sections = "Request"
  case new = "New in this request"
  case raw = "As sent"
  case fields = "Fields"

  var id: Self { self }
}

/// One captured request: its sections, what it added, its raw bodies, and
/// a protobuf field dump when the body was protobuf.
struct CaptureInspector: View {
  let detail: HistoryCaptureDetail
  @State private var mode: CaptureInspectorMode = .sections

  var body: some View {
    VStack(spacing: 0) {
      header
      Picker("Inspector view", selection: $mode) {
        ForEach(modes) { mode in
          Text(mode.rawValue).tag(mode)
        }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .padding(.horizontal, 12)
      .padding(.bottom, 8)
      Divider()
      switch mode {
      case .sections: CaptureSectionsView(detail: detail)
      case .new: NewBlocksView(detail: detail)
      case .raw: RawJSONView(detail: detail)
      case .fields: FieldsView(fields: detail.fields ?? [])
      }
    }
    .onChange(of: detail.capture.id) { _, _ in
      if mode == .fields, detail.fields == nil { mode = .sections }
    }
  }

  private var modes: [CaptureInspectorMode] {
    CaptureInspectorMode.allCases.filter { $0 != .fields || detail.fields != nil }
  }

  private var header: some View {
    let capture = detail.capture
    return HStack(spacing: 6) {
      Text("#\(capture.id)").foregroundStyle(.secondary).monospacedDigit()
      Text(capture.model ?? capture.cli).font(.headline)
      Text("\(capture.transport.rawValue) \(capture.host)\(capture.path)")
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.middle)
        .textSelection(.enabled)
      Spacer()
      if let previous = capture.previousCaptureId {
        Text("continues #\(previous)").font(.caption).foregroundStyle(.secondary)
      }
    }
    .padding(12)
  }
}

private struct CaptureSectionsView: View {
  let detail: HistoryCaptureDetail

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        let system = detail.blocks(.system)
        let groups = detail.toolGroups
        let messages = detail.blocks(.conversation)
        InspectorSection(title: "System", blocks: system) {
          ForEach(system) { BlockView(block: $0) }
        }
        InspectorSection(
          title: "Tools", blocks: detail.blocks(.tools),
          count: groups.map(\.tools.count).reduce(0, +)
        ) {
          ForEach(groups) { group in
            ToolGroupView(group: group)
          }
        }
        InspectorSection(title: "Messages", blocks: messages) {
          ForEach(messages) { BlockView(block: $0) }
        }
        ResponseSection(response: detail.response)
        CaptureUsageSection(capture: detail.capture)
      }
      .padding(12)
    }
  }
}

private struct InspectorSection<Content: View>: View {
  let title: String
  let blocks: [CaptureBlock]
  let count: Int
  let content: Content

  init(
    title: String, blocks: [CaptureBlock], count: Int? = nil,
    @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.blocks = blocks
    self.count = count ?? blocks.count
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(title).font(.headline)
        Text("\(count) · \(CaptureText.bytes(blocks.map(\.bytes).reduce(0, +)))")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      if blocks.isEmpty {
        Text("None").font(.caption).foregroundStyle(.secondary)
      } else {
        content
      }
    }
  }
}

/// A block's role, category, flags, and parts, collapsed when it is long.
struct BlockView: View {
  let block: CaptureBlock
  @State private var expanded: Bool

  init(block: CaptureBlock) {
    self.block = block
    _expanded = State(initialValue: block.bytes <= 1_500)
  }

  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(block.parts.enumerated()), id: \.offset) { _, part in
          PartView(part: part)
        }
      }
      .padding(.top, 4)
    } label: {
      HStack(spacing: 6) {
        Text(block.role ?? block.section.rawValue).font(.caption.weight(.semibold))
        Text(block.category.rawValue).font(.caption).foregroundStyle(.secondary)
        if block.isNew { Badge(text: "new", color: .accentColor) }
        if block.inherited {
          Badge(text: "inherited", color: .gray)
            .help("Not sent in this request; rebuilt from the request it continues.")
        }
        Spacer(minLength: 4)
        Text(CaptureText.bytes(block.bytes)).font(.caption2).foregroundStyle(.tertiary)
      }
    }
    .padding(8)
    .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
  }
}

private struct PartView: View {
  let part: CapturePart

  var body: some View {
    switch part {
    case let .text(content):
      Text(content).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
    case let .reasoning(content):
      Text(content).italic().foregroundStyle(.secondary).textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    case .toolCall, .toolCallResponse, .toolDefinition, .other:
      VStack(alignment: .leading, spacing: 2) {
        Text(CaptureText.label(part)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        CodeBlock(text: CaptureText.text(part))
      }
    }
  }
}

/// A namespace's tools; top-level tools are listed without a heading.
private struct ToolGroupView: View {
  let group: CaptureToolGroup

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if let namespace = group.namespace {
        Text("\(namespace) · \(group.tools.count)")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .padding(.top, 2)
      }
      ForEach(group.tools) { tool in
        ToolDefinitionView(tool: tool)
      }
    }
  }
}

private struct ToolDefinitionView: View {
  let tool: CaptureToolDefinition

  var body: some View {
    DisclosureGroup {
      VStack(alignment: .leading, spacing: 4) {
        if let description = tool.description, !description.isEmpty {
          Text(description)
            .font(.caption)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if tool.parameters == .null {
          Text("Declares no parameters.").font(.caption).foregroundStyle(.secondary)
        } else {
          CodeBlock(text: tool.parameters.prettyPrinted)
        }
      }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "wrench.and.screwdriver")
        Text(tool.name).font(.caption.weight(.semibold))
        if let description = tool.description, !description.isEmpty {
          Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        if tool.block.isNew { Badge(text: "new", color: .accentColor) }
        if tool.block.inherited { Badge(text: "inherited", color: .gray) }
        Spacer(minLength: 4)
      }
    }
    .padding(.horizontal, 8)
  }
}

private struct ResponseSection: View {
  let response: CaptureResponse?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Response").font(.headline)
      if let response {
        if !response.text.isEmpty {
          Text(response.text).textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
        }
        if !response.reasoning.isEmpty {
          Text("Reasoning").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
          Text(response.reasoning).italic().foregroundStyle(.secondary).textSelection(.enabled)
        }
        ForEach(Array(response.toolCalls.enumerated()), id: \.offset) { _, call in
          Text("tool call \(call.name)").font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
          CodeBlock(text: call.arguments.prettyPrinted)
        }
        Text("Stop reason: \(response.stopReason ?? "none")")
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        Text("No response was recorded for this request.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

private struct CaptureUsageSection: View {
  let capture: HistoryCapture

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Usage").font(.headline)
      Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 3) {
        if let usage = capture.usage {
          row("Input", HistoryFormat.tokens(usage.inputTokens))
          row("Output", HistoryFormat.tokens(usage.outputTokens))
          row("Cache read", HistoryFormat.tokens(usage.cacheReadTokens))
          row("Cache write", HistoryFormat.tokens(usage.cacheCreationTokens))
          row("Cached input", HistoryFormat.tokens(usage.cachedInputTokens))
          row("Reasoning", HistoryFormat.tokens(usage.reasoningTokens))
        } else {
          row("Tokens", "not reported")
        }
        row("Duration", CaptureText.duration(capture.durationMs))
        row(
          "Status",
          capture.httpStatus.map { "\(capture.status.rawValue) (\($0))" }
            ?? capture.status.rawValue)
        if let error = capture.error { row("Error", error) }
        row("Context", capture.contextComplete ? "complete" : "incomplete")
      }
      .font(.caption)
    }
  }

  private func row(_ label: String, _ value: String) -> some View {
    GridRow {
      Text(label).foregroundStyle(.secondary)
      Text(value).monospacedDigit().textSelection(.enabled)
    }
  }
}

private struct NewBlocksView: View {
  let detail: HistoryCaptureDetail

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 8) {
        if !detail.capture.contextComplete {
          Label(CaptureText.incompleteContextNote, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.orange)
        }
        Text(summary).font(.caption).foregroundStyle(.secondary)
        ForEach(detail.newBlocks) { BlockView(block: $0) }
      }
      .padding(12)
    }
  }

  private var summary: String {
    let count = detail.newBlocks.count
    guard count > 0 else { return "Nothing new: this request repeats the one before it." }
    let bytes = CaptureText.bytes(detail.newBlocks.map(\.bytes).reduce(0, +))
    let base = detail.capture.previousCaptureId.map { "over #\($0)" } ?? "(first request)"
    return "\(count) block\(count == 1 ? "" : "s"), \(bytes), new \(base)"
  }
}

private struct RawJSONView: View {
  let detail: HistoryCaptureDetail
  @State private var showsResponse = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if !showsResponse, detail.omitsInheritedContext {
        Label(
          CaptureText.inheritedNote(previous: detail.capture.previousCaptureId),
          systemImage: "info.circle"
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Picker("Body", selection: $showsResponse) {
        Text("Request as sent").tag(false)
        Text("Response").tag(true)
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .frame(maxWidth: 300)
      MonospacedTextView(
        text: (showsResponse ? detail.rawResponse : detail.rawRequest).prettyPrinted
      )
      .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
    }
    .padding(12)
  }
}

private struct FieldsView: View {
  let fields: [CaptureProtoField]

  var body: some View {
    ScrollView {
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 3) {
        GridRow {
          Text("Path")
          Text("Wire")
          Text("Value")
        }
        .font(.caption.weight(.semibold))
        ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
          GridRow {
            Text(field.path)
            Text(field.wire.rawValue).foregroundStyle(.secondary)
            Text(field.value).lineLimit(4)
          }
          .font(.system(.caption, design: .monospaced))
          .textSelection(.enabled)
        }
      }
      .padding(12)
    }
  }
}

private struct CodeBlock: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(.caption, design: .monospaced))
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(6)
      .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 5))
  }
}

private struct Badge: View {
  let text: String
  let color: Color

  var body: some View {
    Text(text)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 5)
      .padding(.vertical, 1)
      .background(color.opacity(0.18), in: Capsule())
  }
}
