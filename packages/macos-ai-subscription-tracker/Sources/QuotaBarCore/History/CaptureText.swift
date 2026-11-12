import Foundation

/// Display text and grouping for captured requests.
public enum CaptureText {
  public static let incompleteContextNote =
    "Context incomplete: the request this one continues was never captured, "
    + "so its inherited history is missing."
  /// `12 KB`, `840 bytes`, `0 bytes`.
  public static func bytes(_ count: Int) -> String {
    count == 0 ? "0 bytes" : Int64(count).formatted(.byteCount(style: .file))
  }

  /// `2.0 s`, `850 ms`, or `—` while a request is still open.
  public static func duration(_ milliseconds: Int?) -> String {
    guard let milliseconds else { return "—" }
    guard milliseconds >= 1_000 else { return "\(milliseconds) ms" }
    return String(format: "%.1f s", Double(milliseconds) / 1_000)
  }

  /// `in 26.3K · out 7 · cache r 34K w 92`, naming only what the API sent.
  public static func tokens(_ usage: CaptureUsage?) -> String {
    guard let usage else { return "no usage" }
    var parts = [
      "in \(HistoryFormat.tokens(usage.inputTokens))",
      "out \(HistoryFormat.tokens(usage.outputTokens))",
    ]
    if usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0 {
      parts.append(
        "cache r \(HistoryFormat.tokens(usage.cacheReadTokens)) "
          + "w \(HistoryFormat.tokens(usage.cacheCreationTokens))")
    }
    if usage.cachedInputTokens > 0 {
      parts.append("cached \(HistoryFormat.tokens(usage.cachedInputTokens))")
    }
    if usage.reasoningTokens > 0 {
      parts.append("reasoning \(HistoryFormat.tokens(usage.reasoningTokens))")
    }
    return parts.joined(separator: " · ")
  }

  /// The status label for a capture that did not finish normally.
  public static func attention(_ capture: HistoryCapture) -> String? {
    switch capture.status {
    case .ok: nil
    case .pending: "Pending"
    case .incomplete: "Incomplete"
    case .error: capture.httpStatus.map { "Error \($0)" } ?? "Error"
    }
  }

  /// A block's parts as readable text.
  public static func text(_ part: CapturePart) -> String {
    switch part {
    case let .text(content), let .reasoning(content):
      content
    case let .toolCall(_, name, arguments):
      "\(name) \(arguments.prettyPrinted)"
    case let .toolCallResponse(_, response):
      response.prettyPrinted
    case let .toolDefinition(name, namespace, description, _):
      [namespace.map { "\($0).\(name)" } ?? name, description].compactMap(\.self)
        .joined(separator: ": ")
    case let .other(content):
      content.prettyPrinted
    }
  }

  /// A short label for a part, such as `tool call Bash`.
  public static func label(_ part: CapturePart) -> String {
    switch part {
    case .text: "text"
    case .reasoning: "reasoning"
    case let .toolCall(_, name, _): "tool call \(name)"
    case .toolCallResponse: "tool result"
    case let .toolDefinition(name, _, _, _): "tool \(name)"
    case .other: "other"
    }
  }

  /// Explains why the as-sent body is shorter than the rebuilt request.
  public static func inheritedNote(previous: Int?) -> String {
    let parent = previous.map { "#\($0)" } ?? "an earlier request"
    return "This request continues \(parent). Blocks it inherited were not sent, so they are "
      + "not in this body; the Request view shows the full rebuilt context."
  }
}
