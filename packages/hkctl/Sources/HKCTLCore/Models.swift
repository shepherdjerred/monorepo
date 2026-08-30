import Foundation

struct AnyCodingKey: CodingKey {
  let stringValue: String
  let intValue: Int?

  init?(stringValue: String) {
    self.stringValue = stringValue
    intValue = nil
  }

  init?(intValue: Int) {
    stringValue = String(intValue)
    self.intValue = intValue
  }
}

func rejectUnknownKeys(
  from decoder: any Decoder,
  allowed: Set<String>,
  context: String
) throws {
  let container = try decoder.container(keyedBy: AnyCodingKey.self)
  let unknown = container.allKeys
    .map(\.stringValue)
    .filter { !allowed.contains($0) }
    .sorted()
  guard unknown.isEmpty else {
    throw DecodingError.dataCorrupted(
      DecodingError.Context(
        codingPath: decoder.codingPath,
        debugDescription:
          "Unknown field\(unknown.count == 1 ? "" : "s") in \(context): "
          + unknown.map { "'\($0)'" }.joined(separator: ", ")
      )
    )
  }
}

public struct RoomSnapshot: Codable, Equatable, Sendable {
  public let id: String
  public var name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

public struct AccessorySnapshot: Codable, Equatable, Sendable {
  public let id: String
  public var name: String
  public var roomID: String?
  public var roomName: String?
  public let manufacturer: String?
  public let model: String?
  public let reachable: Bool

  public init(
    id: String,
    name: String,
    roomID: String?,
    roomName: String?,
    manufacturer: String?,
    model: String?,
    reachable: Bool
  ) {
    self.id = id
    self.name = name
    self.roomID = roomID
    self.roomName = roomName
    self.manufacturer = manufacturer
    self.model = model
    self.reachable = reachable
  }
}

public struct HomeSnapshot: Codable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let isPrimary: Bool
  public var rooms: [RoomSnapshot]
  public var accessories: [AccessorySnapshot]

  public init(
    id: String,
    name: String,
    isPrimary: Bool,
    rooms: [RoomSnapshot],
    accessories: [AccessorySnapshot]
  ) {
    self.id = id
    self.name = name
    self.isPrimary = isPrimary
    self.rooms = rooms
    self.accessories = accessories
  }
}

public enum AccessorySelector: Equatable, Sendable {
  case name(String, manufacturer: String?)
  case id(String)
}

public enum Operation: Equatable, Sendable {
  case renameRoom(from: String, to: String)
  case removeRoom(name: String)
  case renameAccessory(selector: AccessorySelector, to: String)
  case assignAccessory(selector: AccessorySelector, room: String)
  case removeAccessory(selector: AccessorySelector)
}

extension Operation: Codable {
  private enum CodingKeys: String, CodingKey {
    case kind
    case from
    case to
    case name
    case room
    case manufacturer
    case id
  }

  private enum Kind: String, Codable {
    case renameRoom = "rename-room"
    case removeRoom = "remove-room"
    case renameAccessory = "rename-accessory"
    case assignAccessory = "assign-accessory"
    case removeAccessory = "remove-accessory"
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let kind = try container.decode(Kind.self, forKey: .kind)
    switch kind {
    case .renameRoom:
      try rejectUnknownKeys(
        from: decoder,
        allowed: ["kind", "from", "to"],
        context: kind.rawValue
      )
      self = .renameRoom(
        from: try container.decode(String.self, forKey: .from),
        to: try container.decode(String.self, forKey: .to)
      )
    case .removeRoom:
      try rejectUnknownKeys(
        from: decoder,
        allowed: ["kind", "name"],
        context: kind.rawValue
      )
      self = .removeRoom(name: try container.decode(String.self, forKey: .name))
    case .renameAccessory:
      try rejectUnknownKeys(
        from: decoder,
        allowed: ["kind", "from", "to", "manufacturer", "id"],
        context: kind.rawValue
      )
      self = .renameAccessory(
        selector: try Self.decodeAccessorySelector(container: container, nameKey: .from),
        to: try container.decode(String.self, forKey: .to)
      )
    case .assignAccessory:
      try rejectUnknownKeys(
        from: decoder,
        allowed: ["kind", "name", "room", "manufacturer", "id"],
        context: kind.rawValue
      )
      self = .assignAccessory(
        selector: try Self.decodeAccessorySelector(container: container, nameKey: .name),
        room: try container.decode(String.self, forKey: .room)
      )
    case .removeAccessory:
      try rejectUnknownKeys(
        from: decoder,
        allowed: ["kind", "name", "manufacturer", "id"],
        context: kind.rawValue
      )
      self = .removeAccessory(
        selector: try Self.decodeAccessorySelector(container: container, nameKey: .name)
      )
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case let .renameRoom(from, to):
      try container.encode(Kind.renameRoom, forKey: .kind)
      try container.encode(from, forKey: .from)
      try container.encode(to, forKey: .to)
    case let .removeRoom(name):
      try container.encode(Kind.removeRoom, forKey: .kind)
      try container.encode(name, forKey: .name)
    case let .renameAccessory(selector, to):
      try container.encode(Kind.renameAccessory, forKey: .kind)
      try Self.encodeAccessorySelector(selector, container: &container, nameKey: .from)
      try container.encode(to, forKey: .to)
    case let .assignAccessory(selector, room):
      try container.encode(Kind.assignAccessory, forKey: .kind)
      try Self.encodeAccessorySelector(selector, container: &container, nameKey: .name)
      try container.encode(room, forKey: .room)
    case let .removeAccessory(selector):
      try container.encode(Kind.removeAccessory, forKey: .kind)
      try Self.encodeAccessorySelector(selector, container: &container, nameKey: .name)
    }
  }

  private static func decodeAccessorySelector(
    container: KeyedDecodingContainer<CodingKeys>,
    nameKey: CodingKeys
  ) throws -> AccessorySelector {
    let name = try container.decodeIfPresent(String.self, forKey: nameKey)
    let id = try container.decodeIfPresent(String.self, forKey: .id)
    let manufacturer = try container.decodeIfPresent(String.self, forKey: .manufacturer)

    guard (name == nil) != (id == nil) else {
      throw DecodingError.dataCorruptedError(
        forKey: .id,
        in: container,
        debugDescription:
          "Specify exactly one accessory selector: '\(nameKey.stringValue)' or 'id'."
      )
    }
    if let id {
      guard manufacturer == nil else {
        throw DecodingError.dataCorruptedError(
          forKey: .manufacturer,
          in: container,
          debugDescription: "'manufacturer' cannot be combined with an accessory 'id'."
        )
      }
      guard let normalized = UUID(uuidString: id)?.uuidString else {
        throw DecodingError.dataCorruptedError(
          forKey: .id,
          in: container,
          debugDescription: "Accessory 'id' must be a valid UUID."
        )
      }
      return .id(normalized)
    }
    guard let name else {
      throw DecodingError.dataCorruptedError(
        forKey: nameKey,
        in: container,
        debugDescription: "Missing accessory selector."
      )
    }
    return .name(name, manufacturer: manufacturer)
  }

  private static func encodeAccessorySelector(
    _ selector: AccessorySelector,
    container: inout KeyedEncodingContainer<CodingKeys>,
    nameKey: CodingKeys
  ) throws {
    switch selector {
    case let .name(name, manufacturer):
      try container.encode(name, forKey: nameKey)
      try container.encodeIfPresent(manufacturer, forKey: .manufacturer)
    case let .id(id):
      try container.encode(id, forKey: .id)
    }
  }
}

public enum OutputFormat: String, Codable, Equatable, Sendable {
  case text
  case json
}

public enum InvocationAction: Equatable, Sendable {
  case help
  case version
  case list
  case operations([Operation])
  case batchFile(String)
}

public struct Invocation: Equatable, Sendable {
  public let action: InvocationAction
  public let homeName: String?
  public let outputPath: String
  public let outputFormat: OutputFormat
  public let applyChanges: Bool

  public init(
    action: InvocationAction,
    homeName: String?,
    outputPath: String,
    outputFormat: OutputFormat,
    applyChanges: Bool
  ) {
    self.action = action
    self.homeName = homeName
    self.outputPath = outputPath
    self.outputFormat = outputFormat
    self.applyChanges = applyChanges
  }
}

public enum ExecutionMode: String, Codable, Equatable, Sendable {
  case readOnly = "read-only"
  case dryRun = "dry-run"
  case applied
}

public enum OperationStatus: String, Codable, Equatable, Sendable {
  case planned
  case applied
  case unchanged
  case failed
  case notRun = "not-run"
}

public struct OperationResult: Codable, Equatable, Sendable {
  public let operation: Operation
  public let status: OperationStatus
  public let summary: String

  public init(operation: Operation, status: OperationStatus, summary: String) {
    self.operation = operation
    self.status = status
    self.summary = summary
  }
}

public struct ExecutionReport: Codable, Equatable, Sendable {
  public let version: Int
  public let success: Bool
  public let mode: ExecutionMode
  public let home: HomeSnapshot
  public let results: [OperationResult]
  public let error: String?

  public init(
    success: Bool,
    mode: ExecutionMode,
    home: HomeSnapshot,
    results: [OperationResult],
    error: String? = nil
  ) {
    version = 1
    self.success = success
    self.mode = mode
    self.home = home
    self.results = results
    self.error = error
  }
}

public struct ErrorReport: Codable, Equatable, Sendable {
  public let version: Int
  public let success: Bool
  public let code: Int
  public let error: String

  public init(code: Int, error: String) {
    version = 1
    success = false
    self.code = code
    self.error = error
  }
}
