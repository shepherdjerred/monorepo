import Foundation

enum CodexSessionLog {
  static func turns(from lines: [String]) throws -> [UsageTurn] {
    let accumulator = CodexAccumulator()
    for line in lines {
      try accumulator.consume(line)
    }
    return accumulator.turns
  }

  static func turns(in url: URL) throws -> [UsageTurn] {
    let accumulator = CodexAccumulator()
    try LocalLogFile.forEachLine(in: url) { try accumulator.consume($0) }
    return accumulator.turns
  }
}

private final class CodexAccumulator {
  private(set) var turns: [UsageTurn] = []
  private var model = "unknown"
  private var previousTotal: Int?
  private var seenOrdinals: [Int: [Int]] = [:]
  private let clock = LocalLogTime()

  func consume(_ line: String) throws {
    guard let object = LocalLogJSON.object(from: line),
      let type = LocalLogJSON.text(object, "type")
    else { return }
    switch type {
    case "turn_context":
      try updateModel(object)
    case "token_count":
      try consumeTokens(object, kind: .legacy)
    case "token_usage_record":
      try consumeTokens(object, kind: .current)
    default:
      break
    }
  }

  private func updateModel(_ object: [String: Any]) throws {
    guard let payload = object["payload"] as? [String: Any] else {
      model = "unknown"
      return
    }
    guard let raw = payload["model"], !LocalLogJSON.isNull(raw) else {
      model = "unknown"
      return
    }
    guard let name = raw as? String, !name.isEmpty else { throw LocalLogError.malformedUsage }
    model = name
  }

  private func consumeTokens(_ object: [String: Any], kind: CodexEventKind) throws {
    guard let payload = object["payload"] as? [String: Any] else {
      throw LocalLogError.malformedUsage
    }
    let pair = try tokenPair(payload, kind: kind)
    guard let increment = pair.increment else { throw LocalLogError.malformedUsage }
    if try ordinalDecision(object, increment: increment) == .duplicate { return }
    guard try shouldCount(cumulative: pair.cumulative?.total, incrementTotal: increment.total)
    else {
      return
    }
    guard let stamp = LocalLogJSON.text(object, "timestamp"), let timestamp = clock.parse(stamp)
    else {
      throw LocalLogError.malformedUsage
    }
    turns.append(try increment.billed(model: model, timestamp: timestamp))
  }

  private func tokenPair(
    _ payload: [String: Any],
    kind: CodexEventKind
  ) throws -> (increment: CodexUsageCounts?, cumulative: CodexUsageCounts?) {
    switch kind {
    case .legacy:
      guard let info = payload["info"] as? [String: Any] else { throw LocalLogError.malformedUsage }
      return (
        try optionalTokens(info, "last_token_usage"),
        try optionalTokens(info, "total_token_usage")
      )
    case .current:
      return (
        try optionalTokens(payload, "usage"),
        try optionalTokens(payload, "thread_token_usage")
      )
    }
  }

  private func optionalTokens(_ object: [String: Any], _ key: String) throws -> CodexUsageCounts? {
    guard let raw = object[key], !LocalLogJSON.isNull(raw) else { return nil }
    guard let body = raw as? [String: Any] else { throw LocalLogError.malformedUsage }
    return try CodexUsageCounts(body)
  }

  private func ordinalDecision(
    _ object: [String: Any],
    increment: CodexUsageCounts
  ) throws -> OrdinalDecision {
    guard let raw = object["ordinal"], !LocalLogJSON.isNull(raw) else { return .first }
    let ordinal = try LocalLogJSON.requiredOrdinal(raw)
    let fingerprint = increment.fingerprint
    if let seen = seenOrdinals[ordinal] {
      guard seen == fingerprint else { throw LocalLogError.malformedUsage }
      return .duplicate
    }
    seenOrdinals[ordinal] = fingerprint
    return .first
  }

  /// Count the per-event increment. The first event counts even when its cumulative
  /// total is already larger. A later event whose cumulative total did not advance is
  /// a duplicate snapshot and adds nothing.
  private func shouldCount(cumulative: Int?, incrementTotal: Int) throws -> Bool {
    guard let cumulative else { return true }
    if let previousTotal {
      if cumulative < previousTotal { throw LocalLogError.malformedUsage }
      if cumulative == previousTotal { return false }
      guard cumulative - previousTotal == incrementTotal else {
        throw LocalLogError.malformedUsage
      }
    }
    self.previousTotal = cumulative
    return true
  }
}

private enum CodexEventKind {
  case legacy
  case current
}

private enum OrdinalDecision {
  case first
  case duplicate
}

private struct CodexUsageCounts: Equatable {
  var input: Int
  var cached: Int
  var cacheWrite: Int
  var output: Int
  var reasoning: Int
  var total: Int

  init(_ object: [String: Any]) throws {
    input = try LocalLogJSON.requiredNumber(object, "input_tokens")
    cached = try LocalLogJSON.requiredNumber(object, "cached_input_tokens")
    cacheWrite = try LocalLogJSON.requiredNumber(object, "cache_write_input_tokens")
    output = try LocalLogJSON.requiredNumber(object, "output_tokens")
    reasoning = try LocalLogJSON.requiredNumber(object, "reasoning_output_tokens")
    total = try LocalLogJSON.requiredNumber(object, "total_tokens")
  }

  var fingerprint: [Int] {
    [input, cached, cacheWrite, output, reasoning, total]
  }

  func billed(model: String, timestamp: Date) throws -> UsageTurn {
    let uncached = input - cached - cacheWrite
    guard uncached >= 0 else { throw LocalLogError.malformedUsage }
    var turn = UsageTurn()
    turn.input = uncached
    turn.output = output
    turn.cacheCreateUnsplit = cacheWrite
    turn.cacheRead = cached
    turn.model = model
    turn.timestamp = timestamp
    return turn
  }
}

extension LocalLogJSON {
  static func requiredOrdinal(_ value: Any) throws -> Int {
    if isJSONBoolean(value) { throw LocalLogError.malformedUsage }
    if let whole = value as? Int { return whole }
    if let number = value as? Double, number.rounded() == number, number >= 0,
      number <= Double(Int.max)
    {
      return Int(number)
    }
    throw LocalLogError.malformedUsage
  }
}
