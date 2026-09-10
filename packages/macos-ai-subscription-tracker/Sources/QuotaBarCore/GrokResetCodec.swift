import Foundation

/// gRPC-web framing for Grok's remaining-reset RPC. Brim only reads remaining
/// `ResetToken`s; it never calls `RedeemReset`.
enum GrokResetCodec {
  static let emptyUnaryRequest = Data([0x00, 0x00, 0x00, 0x00, 0x00])

  static let requestHeaders: [String: String] = [
    "Content-Type": "application/grpc-web+proto",
    "X-Grpc-Web": "1",
  ]

  static func parseTokens(from data: Data, now: Date) throws -> [Reset] {
    let message = try unaryMessage(from: data)
    return try decodeTokens(from: message, now: now)
  }

  private static func unaryMessage(from data: Data) throws -> Data {
    var offset = 0
    var payloads: [Data] = []
    var status: Int?
    while offset < data.count {
      guard offset + 5 <= data.count else { throw QuotaError.malformedResponse(.grok) }
      let flag = data[offset]
      let length =
        Int(data[offset + 1]) << 24
        | Int(data[offset + 2]) << 16
        | Int(data[offset + 3]) << 8
        | Int(data[offset + 4])
      offset += 5
      guard offset + length <= data.count else {
        throw QuotaError.malformedResponse(.grok)
      }
      let frame = data.subdata(in: offset..<(offset + length))
      offset += length
      if flag & 0x80 != 0 {
        if flag & 0x01 != 0 { throw QuotaError.malformedResponse(.grok) }
        status = try grpcStatus(from: frame)
        continue
      }
      if flag & 0x01 != 0 { throw QuotaError.malformedResponse(.grok) }
      payloads.append(frame)
    }
    guard payloads.count <= 1, let status else { throw QuotaError.malformedResponse(.grok) }
    if status == 16 { throw QuotaError.unauthorized(.grok) }
    if status != 0 { throw QuotaError.network(.grok) }
    return payloads.first ?? Data()
  }

  private static func grpcStatus(from trailer: Data) throws -> Int {
    guard let text = String(data: trailer, encoding: .utf8) else {
      throw QuotaError.malformedResponse(.grok)
    }
    let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
    for line in normalized.split(separator: "\n", omittingEmptySubsequences: true) {
      let parts = line.split(separator: ":", maxSplits: 1)
      guard parts.count == 2 else { continue }
      let name = parts[0].trimmingCharacters(in: .whitespaces).lowercased()
      guard name == "grpc-status" else { continue }
      let value = parts[1].trimmingCharacters(in: .whitespaces)
      guard let status = Int(value) else { throw QuotaError.malformedResponse(.grok) }
      return status
    }
    throw QuotaError.malformedResponse(.grok)
  }

  private static func decodeTokens(from message: Data, now: Date) throws -> [Reset] {
    var reader = ProtobufReader(data: message)
    var resets: [Reset] = []
    while let field = try reader.nextField() {
      guard field.number == 1 else { continue }
      guard field.wire == .lengthDelimited else { throw QuotaError.malformedResponse(.grok) }
      guard let reset = try decodeToken(field.payload, now: now) else { continue }
      resets.append(reset)
    }
    return resets.sorted { $0.exp < $1.exp }
  }

  private static func decodeToken(_ data: Data, now: Date) throws -> Reset? {
    var reader = ProtobufReader(data: data)
    var tokenID: String?
    var validityEnd: Date?
    while let field = try reader.nextField() {
      switch field.number {
      case 1:
        guard field.wire == .lengthDelimited,
          let value = String(data: field.payload, encoding: .utf8)
        else {
          throw QuotaError.malformedResponse(.grok)
        }
        tokenID = value
      case 2:
        guard field.wire == .lengthDelimited else { throw QuotaError.malformedResponse(.grok) }
        _ = try decodeTimestamp(field.payload)
      case 3:
        guard field.wire == .lengthDelimited else { throw QuotaError.malformedResponse(.grok) }
        validityEnd = try decodeTimestamp(field.payload)
      default:
        continue
      }
    }
    guard let tokenID, !tokenID.isEmpty, let validityEnd, validityEnd > now else { return nil }
    return Reset(exp: validityEnd)
  }

  private static func decodeTimestamp(_ data: Data) throws -> Date {
    var reader = ProtobufReader(data: data)
    var seconds: Int64 = 0
    var nanos: Int32 = 0
    while let field = try reader.nextField() {
      switch field.number {
      case 1:
        guard field.wire == .varint else { throw QuotaError.malformedResponse(.grok) }
        seconds = Int64(bitPattern: field.varint)
      case 2:
        guard field.wire == .varint else { throw QuotaError.malformedResponse(.grok) }
        let value = field.varint
        guard value <= UInt64(Int32.max) else { throw QuotaError.malformedResponse(.grok) }
        nanos = Int32(value)
      default:
        continue
      }
    }
    guard nanos >= 0, nanos < 1_000_000_000 else { throw QuotaError.malformedResponse(.grok) }
    let value = Double(seconds) + Double(nanos) / 1_000_000_000
    guard value.isFinite, abs(value) < 1e13 else { throw QuotaError.malformedResponse(.grok) }
    return Date(timeIntervalSince1970: value)
  }
}

private struct ProtobufReader {
  enum Wire: UInt8 {
    case varint = 0
    case bits64 = 1
    case lengthDelimited = 2
    case bits32 = 5
  }

  struct Field {
    let number: UInt32
    let wire: Wire
    let payload: Data
    let varint: UInt64
  }

  private let data: Data
  private var offset = 0

  init(data: Data) {
    self.data = data
  }

  mutating func nextField() throws -> Field? {
    guard offset < data.count else { return nil }
    let tag = try readVarint()
    let number = UInt32(tag >> 3)
    guard number != 0, let wire = Wire(rawValue: UInt8(tag & 0x07)) else {
      throw QuotaError.malformedResponse(.grok)
    }
    switch wire {
    case .varint:
      let value = try readVarint()
      return Field(number: number, wire: wire, payload: Data(), varint: value)
    case .lengthDelimited:
      let length = try readVarint()
      guard length <= UInt64(data.count - offset) else {
        throw QuotaError.malformedResponse(.grok)
      }
      let payload = data.subdata(in: offset..<(offset + Int(length)))
      offset += Int(length)
      return Field(number: number, wire: wire, payload: payload, varint: 0)
    case .bits64:
      let payload = try readExact(8)
      return Field(number: number, wire: wire, payload: payload, varint: 0)
    case .bits32:
      let payload = try readExact(4)
      return Field(number: number, wire: wire, payload: payload, varint: 0)
    }
  }

  private mutating func readVarint() throws -> UInt64 {
    var result: UInt64 = 0
    var shift = 0
    while true {
      guard offset < data.count, shift <= 63 else { throw QuotaError.malformedResponse(.grok) }
      let byte = data[offset]
      offset += 1
      let bits = UInt64(byte & 0x7F)
      if shift == 63, bits > 1 { throw QuotaError.malformedResponse(.grok) }
      result |= bits << shift
      if byte & 0x80 == 0 { return result }
      shift += 7
    }
  }

  private mutating func readExact(_ count: Int) throws -> Data {
    guard offset + count <= data.count else { throw QuotaError.malformedResponse(.grok) }
    let payload = data.subdata(in: offset..<(offset + count))
    offset += count
    return payload
  }
}
