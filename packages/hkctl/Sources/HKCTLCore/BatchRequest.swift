public import Foundation

public struct BatchRequest: Codable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case version
    case home
    case operations
  }

  public let version: Int
  public let home: String?
  public let operations: [Operation]

  public init(version: Int, home: String?, operations: [Operation]) {
    self.version = version
    self.home = home
    self.operations = operations
  }

  public init(from decoder: any Decoder) throws {
    try rejectUnknownKeys(
      from: decoder,
      allowed: ["version", "home", "operations"],
      context: "batch request"
    )
    let container = try decoder.container(keyedBy: CodingKeys.self)
    version = try container.decode(Int.self, forKey: .version)
    home = try container.decodeIfPresent(String.self, forKey: .home)
    operations = try container.decode([Operation].self, forKey: .operations)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(version, forKey: .version)
    try container.encodeIfPresent(home, forKey: .home)
    try container.encode(operations, forKey: .operations)
  }

  public static func decode(data: Data) throws -> BatchRequest {
    let request: BatchRequest
    do {
      request = try JSONDecoder().decode(BatchRequest.self, from: data)
    } catch {
      throw HKCTLError.invalidBatch(error.localizedDescription)
    }
    try request.validate()
    return request
  }

  public func validate() throws {
    guard version == 1 else {
      throw HKCTLError.invalidBatch("unsupported version \(version); expected version 1")
    }
    if let home, home.isEmpty {
      throw HKCTLError.invalidBatch("home must be omitted or contain a non-empty exact name")
    }
    guard !operations.isEmpty else {
      throw HKCTLError.invalidBatch("operations must contain at least one mutation")
    }
    for operation in operations {
      try operation.validateForBatch()
    }
  }
}

extension Operation {
  fileprivate func validateForBatch() throws {
    switch self {
    case let .renameRoom(from, to):
      try requireBatchValue(from, field: "rename-room.from")
      try requireBatchValue(to, field: "rename-room.to")
    case let .removeRoom(name):
      try requireBatchValue(name, field: "remove-room.name")
    case let .renameAccessory(selector, to):
      try selector.validateForBatch(operation: "rename-accessory", nameField: "from")
      try requireBatchValue(to, field: "rename-accessory.to")
    case let .assignAccessory(selector, room):
      try selector.validateForBatch(operation: "assign-accessory", nameField: "name")
      try requireBatchValue(room, field: "assign-accessory.room")
    case let .removeAccessory(selector):
      try selector.validateForBatch(operation: "remove-accessory", nameField: "name")
    }
  }

  private func requireBatchValue(_ value: String, field: String) throws {
    guard !value.isEmpty else {
      throw HKCTLError.invalidBatch("\(field) must be non-empty")
    }
  }
}

extension AccessorySelector {
  fileprivate func validateForBatch(operation: String, nameField: String) throws {
    switch self {
    case let .name(name, manufacturer):
      try requireBatchValue(name, field: "\(operation).\(nameField)")
      if let manufacturer {
        try requireBatchValue(manufacturer, field: "\(operation).manufacturer")
      }
    case let .id(id):
      guard UUID(uuidString: id) != nil else {
        throw HKCTLError.invalidBatch("\(operation).id must be a valid UUID")
      }
    }
  }

  private func requireBatchValue(_ value: String, field: String) throws {
    guard !value.isEmpty else {
      throw HKCTLError.invalidBatch("\(field) must be non-empty")
    }
  }
}
