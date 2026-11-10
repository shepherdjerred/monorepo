import Foundation

/// An arbitrary JSON value from a field the contract leaves open
/// (`z.unknown()`): tool arguments, tool results, and the raw request and
/// response bodies of a capture.
public enum HistoryJSON: Decodable, Equatable, Sendable {
  case null
  case bool(Bool)
  case integer(Int)
  case number(Double)
  case string(String)
  case array([Self])
  case object([String: Self])

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Int.self) {
      self = .integer(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([Self].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: Self].self))
    }
  }

  public subscript(key: String) -> Self? {
    guard case let .object(fields) = self else { return nil }
    return fields[key]
  }

  public var arrayValue: [Self]? {
    guard case let .array(items) = self else { return nil }
    return items
  }

  public var stringValue: String? {
    guard case let .string(value) = self else { return nil }
    return value
  }

  /// Two-space indented JSON with sorted keys, or the bare text of a
  /// top-level string.
  public var prettyPrinted: String {
    if case let .string(value) = self { return value }
    let options: JSONSerialization.WritingOptions = [
      .prettyPrinted, .sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: foundationValue, options: options),
      let text = String(bytes: data, encoding: .utf8)
    else {
      preconditionFailure("A decoded JSON value always serializes")
    }
    return text
  }

  private var foundationValue: Any {
    switch self {
    case .null: NSNull()
    case let .bool(value): value
    case let .integer(value): value
    case let .number(value): value
    case let .string(value): value
    case let .array(items): items.map(\.foundationValue)
    case let .object(fields): fields.mapValues(\.foundationValue)
    }
  }
}
