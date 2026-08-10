public import Foundation

struct DynamicCodingKey: CodingKey, Hashable {
  let stringValue: String
  let intValue: Int?

  init(_ stringValue: String) {
    self.stringValue = stringValue
    self.intValue = nil
  }

  init?(stringValue: String) {
    self.init(stringValue)
  }

  init?(intValue: Int) {
    self.stringValue = String(intValue)
    self.intValue = intValue
  }
}

enum ProviderDecoder {
  static func decode<Value: Decodable>(
    _ type: Value.Type,
    from data: Data,
    provider: ProviderID
  ) throws -> Value {
    do {
      return try JSONDecoder().decode(type, from: data)
    } catch let error as QuotaError {
      throw error
    } catch {
      throw QuotaError.malformedResponse(provider)
    }
  }

  static func date<Key: CodingKey>(
    in container: KeyedDecodingContainer<Key>,
    forKey key: Key
  ) throws -> Date? {
    guard container.contains(key), try !container.decodeNil(forKey: key) else { return nil }
    if let string = try? container.decode(String.self, forKey: key) {
      guard let date = ISO8601.parse(string) else { throw QuotaValidationError.invalidDate }
      return date
    }
    if let value = try? container.decode(Double.self, forKey: key) {
      guard value.isFinite, value > 0 else { throw QuotaValidationError.invalidDate }
      let seconds = value > 10_000_000_000 ? value / 1_000 : value
      // Reject epoch values so large that a later `Int(timeIntervalSince(...))` countdown
      // conversion would trap; 1e13 seconds (~316,000 years) is far beyond any real reset date.
      guard abs(seconds) < 1e13 else { throw QuotaValidationError.invalidDate }
      return Date(timeIntervalSince1970: seconds)
    }
    throw QuotaValidationError.invalidDate
  }

  static func number<Key: CodingKey>(
    in container: KeyedDecodingContainer<Key>,
    forKey key: Key
  ) throws -> Double? {
    guard container.contains(key), try !container.decodeNil(forKey: key) else { return nil }
    if let value = try? container.decode(Double.self, forKey: key) {
      guard value.isFinite else { throw QuotaValidationError.invalidPercentage }
      return value
    }
    throw DecodingError.typeMismatch(
      Double.self,
      DecodingError.Context(
        codingPath: container.codingPath + [key],
        debugDescription: "Expected a finite numeric value."
      )
    )
  }

  static func percentage(_ value: Double?) throws -> Double? {
    guard let value else { return nil }
    guard value.isFinite, 0...100 ~= value else {
      throw QuotaValidationError.invalidPercentage
    }
    return value
  }
}

enum ISO8601 {
  static func parse(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions.insert(.withFractionalSeconds)
    return formatter.date(from: value)
  }
}

enum SurfaceResult: Sendable {
  case success(Data)
  case failure(String)
}

func captureSurface(_ operation: @Sendable () async throws -> Data) async -> SurfaceResult {
  do {
    return .success(try await operation())
  } catch let error as QuotaError {
    return .failure(error.localizedDescription)
  } catch {
    return .failure("Provider surface unavailable.")
  }
}

/// Like `SurfaceResult`, but distinguishes an unauthorized response so a caller pinning several
/// requests to one credential (Codex's usage/reset surfaces, Grok's identity/billing/credits
/// surfaces) can restart the whole batch instead of quietly degrading that one surface to a
/// warning and leaving the published snapshot combining data from two different credentials.
enum AuthAwareSurfaceOutcome: Sendable {
  case success(Data)
  case failure(String)
  case unauthorized

  var surfaceResult: SurfaceResult {
    switch self {
    case let .success(data): .success(data)
    case let .failure(message): .failure(message)
    case .unauthorized: .failure("Provider surface unavailable.")
    }
  }
}

func captureAuthAwareSurface(
  _ operation: @Sendable () async throws -> Data
) async -> AuthAwareSurfaceOutcome {
  do {
    return .success(try await operation())
  } catch QuotaError.unauthorized {
    return .unauthorized
  } catch let error as QuotaError {
    return .failure(error.localizedDescription)
  } catch {
    return .failure("Provider surface unavailable.")
  }
}

func slug(_ value: String) -> String {
  value.lowercased().map { character in
    character.isLetter || character.isNumber ? character : "-"
  }.reduce(into: "") { result, character in
    if character != "-" || result.last != "-" { result.append(character) }
  }.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
}

func title(_ value: String) -> String {
  value.replacingOccurrences(of: "_", with: " ").capitalized
}
