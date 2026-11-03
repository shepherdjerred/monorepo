import Foundation

enum LocalLogError: Error {
  case malformedUsage
}

enum LocalLogJSON {
  static func object(from line: String) -> [String: Any]? {
    guard let data = line.data(using: .utf8),
      let value = try? JSONSerialization.jsonObject(with: data),
      let object = value as? [String: Any]
    else { return nil }
    return object
  }

  static func text(_ object: [String: Any], _ key: String) -> String? {
    guard let value = object[key], !isNull(value) else { return nil }
    return value as? String
  }

  static func flag(_ object: [String: Any], _ key: String) throws -> Bool {
    guard let value = object[key], !isNull(value) else { return false }
    guard let flag = value as? Bool else { throw LocalLogError.malformedUsage }
    return flag
  }

  static func wholeNumber(_ object: [String: Any], _ key: String) throws -> Int {
    guard let value = object[key], !isNull(value) else { return 0 }
    return try nonnegative(value)
  }

  static func requiredNumber(_ object: [String: Any], _ key: String) throws -> Int {
    guard let value = object[key], !isNull(value) else { throw LocalLogError.malformedUsage }
    return try nonnegative(value)
  }

  static func money(_ object: [String: Any], keys: [String]) throws -> Decimal? {
    for key in keys {
      guard let value = object[key], !isNull(value) else { continue }
      return try decimal(value)
    }
    return nil
  }

  static func decimal(_ value: Any) throws -> Decimal {
    if isJSONBoolean(value) { throw LocalLogError.malformedUsage }
    if let whole = value as? Int { return Decimal(whole) }
    if let number = value as? Double {
      guard let parsed = Decimal(string: String(number), locale: posix) else {
        throw LocalLogError.malformedUsage
      }
      return parsed
    }
    if let text = value as? String {
      guard let parsed = Decimal(string: text, locale: posix) else {
        throw LocalLogError.malformedUsage
      }
      return parsed
    }
    throw LocalLogError.malformedUsage
  }

  static func isNull(_ value: Any) -> Bool {
    value is NSNull
  }

  static func isJSONBoolean(_ value: Any) -> Bool {
    CFGetTypeID(value as AnyObject) == CFBooleanGetTypeID()
  }

  private static func nonnegative(_ value: Any) throws -> Int {
    let parsed = try integer(value)
    guard parsed >= 0 else { throw LocalLogError.malformedUsage }
    return parsed
  }

  private static func integer(_ value: Any) throws -> Int {
    if isJSONBoolean(value) { throw LocalLogError.malformedUsage }
    if let whole = value as? Int { return whole }
    if let number = value as? Double {
      guard number.rounded() == number, number <= Double(Int.max), number >= 0 else {
        throw LocalLogError.malformedUsage
      }
      return Int(number)
    }
    throw LocalLogError.malformedUsage
  }

  private static let posix = Locale(identifier: "en_US_POSIX")
}

struct LocalLogTime {
  private let fractional = ISO8601DateFormatter()
  private let plain = ISO8601DateFormatter()

  init() {
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    plain.formatOptions = [.withInternetDateTime]
  }

  func parse(_ value: String) -> Date? {
    fractional.date(from: value) ?? plain.date(from: value)
  }
}

enum LocalLogFile {
  static func forEachLine(in url: URL, _ consume: (String) throws -> Void) throws {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var pending = Data()
    while true {
      guard let chunk = try handle.read(upToCount: 65_536), !chunk.isEmpty else { break }
      pending.append(chunk)
      try emitLines(from: &pending, consume: consume, flush: false)
    }
    try emitLines(from: &pending, consume: consume, flush: true)
  }

  private static func emitLines(
    from pending: inout Data,
    consume: (String) throws -> Void,
    flush: Bool
  ) throws {
    let newline = UInt8(0x0A)
    while let index = pending.firstIndex(of: newline) {
      let line = pending.prefix(upTo: index)
      pending.removeSubrange(..<pending.index(after: index))
      try emit(Data(line), consume: consume)
    }
    guard flush, !pending.isEmpty else { return }
    try emit(pending, consume: consume)
    pending.removeAll()
  }

  private static func emit(_ data: Data, consume: (String) throws -> Void) throws {
    if data.isEmpty { return }
    let body = data.last == 0x0D ? Data(data.dropLast()) : data
    if body.isEmpty { return }
    guard let text = String(data: body, encoding: .utf8) else {
      throw LocalLogError.malformedUsage
    }
    if !text.isEmpty { try consume(text) }
  }
}
