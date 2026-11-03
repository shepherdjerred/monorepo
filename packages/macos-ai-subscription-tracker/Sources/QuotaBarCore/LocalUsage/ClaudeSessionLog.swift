import Foundation

enum ClaudeSessionLog {
  static func turns(from lines: [String]) throws -> [UsageTurn] {
    let deduper = ClaudeDeduper()
    for line in lines {
      try deduper.consume(line)
    }
    return deduper.turns
  }

  static func turns(in url: URL) throws -> [UsageTurn] {
    let deduper = ClaudeDeduper()
    try LocalLogFile.forEachLine(in: url) { try deduper.consume($0) }
    return deduper.turns
  }
}

private final class ClaudeDeduper {
  private var records: [String: ClaudeCandidate] = [:]
  private var order: [String] = []
  private var index = 0
  private let clock = LocalLogTime()

  var turns: [UsageTurn] {
    order.compactMap { records[$0]?.turn }
  }

  func consume(_ line: String) throws {
    index += 1
    guard let candidate = try candidate(from: line, index: index) else { return }
    if records[candidate.key] == nil {
      order.append(candidate.key)
      records[candidate.key] = candidate
      return
    }
    guard let existing = records[candidate.key], candidate.replaces(existing) else { return }
    records[candidate.key] = candidate
  }

  private func candidate(from line: String, index: Int) throws -> ClaudeCandidate? {
    guard let object = LocalLogJSON.object(from: line) else { return nil }
    guard LocalLogJSON.text(object, "type") == "assistant" else { return nil }
    guard let message = object["message"] as? [String: Any] else { return nil }
    guard let usage = try usageObject(message) else { return nil }
    return ClaudeCandidate(
      key: identity(object, message: message, index: index),
      sidechain: try LocalLogJSON.flag(object, "isSidechain"),
      turn: try turn(usage, message: message, line: object)
    )
  }

  private func usageObject(_ message: [String: Any]) throws -> [String: Any]? {
    guard let raw = message["usage"] else { return nil }
    if LocalLogJSON.isNull(raw) { return nil }
    guard let usage = raw as? [String: Any] else { throw LocalLogError.malformedUsage }
    return usage
  }

  private func identity(_ object: [String: Any], message: [String: Any], index: Int) -> String {
    if let messageID = LocalLogJSON.text(message, "id"),
      let requestID = LocalLogJSON.text(object, "requestId"),
      !messageID.isEmpty, !requestID.isEmpty
    {
      return "\(messageID)\u{1f}\(requestID)"
    }
    if let uuid = LocalLogJSON.text(object, "uuid"), !uuid.isEmpty {
      return "uuid:\(uuid)"
    }
    return "line:\(index)"
  }

  private func turn(
    _ usage: [String: Any],
    message: [String: Any],
    line: [String: Any]
  ) throws -> UsageTurn {
    guard let stamp = LocalLogJSON.text(line, "timestamp"), let timestamp = clock.parse(stamp)
    else {
      throw LocalLogError.malformedUsage
    }
    let cache = try cacheCounts(usage)
    var turn = UsageTurn()
    turn.input = try LocalLogJSON.wholeNumber(usage, "input_tokens")
    turn.output = try LocalLogJSON.wholeNumber(usage, "output_tokens")
    turn.cacheRead = try LocalLogJSON.wholeNumber(usage, "cache_read_input_tokens")
    turn.cacheCreate5m = cache.fiveMinute
    turn.cacheCreate1h = cache.oneHour
    turn.cacheCreateUnsplit = cache.unsplit
    turn.model = modelName(message)
    turn.timestamp = timestamp
    turn.recordedCostUSD = try recordedCost(line: line, message: message)
    if let cost = turn.recordedCostUSD, cost < 0 { throw LocalLogError.malformedUsage }
    return turn
  }

  private func modelName(_ message: [String: Any]) -> String {
    guard let model = LocalLogJSON.text(message, "model"), !model.isEmpty else { return "unknown" }
    return model
  }

  private func cacheCounts(_ usage: [String: Any]) throws -> CacheCounts {
    if let raw = usage["cache_creation"], !LocalLogJSON.isNull(raw) {
      guard let split = raw as? [String: Any] else { throw LocalLogError.malformedUsage }
      let fiveMinute = try LocalLogJSON.wholeNumber(split, "ephemeral_5m_input_tokens")
      let oneHour = try LocalLogJSON.wholeNumber(split, "ephemeral_1h_input_tokens")
      if fiveMinute + oneHour > 0 {
        return CacheCounts(fiveMinute: fiveMinute, oneHour: oneHour, unsplit: 0)
      }
    }
    let unsplit = try LocalLogJSON.wholeNumber(usage, "cache_creation_input_tokens")
    return CacheCounts(fiveMinute: 0, oneHour: 0, unsplit: unsplit)
  }

  private func recordedCost(line: [String: Any], message: [String: Any]) throws -> Decimal? {
    if let cost = try LocalLogJSON.money(line, keys: ["costUSD", "cost_usd"]) { return cost }
    return try LocalLogJSON.money(message, keys: ["costUSD", "cost_usd"])
  }
}

private struct ClaudeCandidate {
  let key: String
  let sidechain: Bool
  let turn: UsageTurn

  func replaces(_ existing: ClaudeCandidate) -> Bool {
    if sidechain != existing.sidechain { return !sidechain }
    return turn.totalTokens > existing.turn.totalTokens
  }
}

private struct CacheCounts {
  let fiveMinute: Int
  let oneHour: Int
  let unsplit: Int
}
