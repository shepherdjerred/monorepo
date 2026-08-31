import Foundation

enum PlannedOperation: Equatable, Sendable {
  case renameRoom(homeID: String, roomID: String, operation: Operation, summary: String)
  case removeRoom(homeID: String, roomID: String, operation: Operation, summary: String)
  case renameAccessory(
    homeID: String,
    accessoryID: String,
    operation: Operation,
    summary: String
  )
  case assignAccessory(
    homeID: String,
    accessoryID: String,
    roomID: String,
    operation: Operation,
    summary: String
  )
  case removeAccessory(
    homeID: String,
    accessoryID: String,
    operation: Operation,
    summary: String
  )
  case unchanged(operation: Operation, summary: String)

  var operation: Operation {
    switch self {
    case let .renameRoom(_, _, operation, _),
      let .removeRoom(_, _, operation, _),
      let .renameAccessory(_, _, operation, _),
      let .assignAccessory(_, _, _, operation, _),
      let .removeAccessory(_, _, operation, _),
      let .unchanged(operation, _):
      operation
    }
  }

  var summary: String {
    switch self {
    case let .renameRoom(_, _, _, summary),
      let .removeRoom(_, _, _, summary),
      let .renameAccessory(_, _, _, summary),
      let .assignAccessory(_, _, _, _, summary),
      let .removeAccessory(_, _, _, summary),
      let .unchanged(_, summary):
      summary
    }
  }

  var isUnchanged: Bool {
    if case .unchanged = self { return true }
    return false
  }
}

enum Planner {
  static func plan(home: HomeSnapshot, operations: [Operation]) throws -> [PlannedOperation] {
    var workingHome = home
    var planned: [PlannedOperation] = []
    for operation in operations {
      let next = try plan(operation: operation, home: &workingHome)
      planned.append(next)
    }
    return planned
  }

  private static func plan(
    operation: Operation,
    home: inout HomeSnapshot
  ) throws -> PlannedOperation {
    switch operation {
    case let .renameRoom(from, to):
      return try renameRoom(from: from, to: to, operation: operation, home: &home)
    case let .removeRoom(name):
      return try removeRoom(name: name, operation: operation, home: &home)
    case let .renameAccessory(selector, to):
      return try renameAccessory(
        selector: selector,
        to: to,
        operation: operation,
        home: &home
      )
    case let .assignAccessory(selector, room):
      return try assignAccessory(
        selector: selector,
        room: room,
        operation: operation,
        home: &home
      )
    case let .removeAccessory(selector):
      return try removeAccessory(selector: selector, operation: operation, home: &home)
    }
  }

  private static func renameRoom(
    from: String,
    to: String,
    operation: Operation,
    home: inout HomeSnapshot
  ) throws -> PlannedOperation {
    let roomIndex = try uniqueRoomIndex(named: from, home: home)
    let room = home.rooms[roomIndex]
    if from == to {
      return .unchanged(operation: operation, summary: "Room '\(from)' already has that name.")
    }
    guard !home.rooms.contains(where: { $0.id != room.id && $0.name == to }) else {
      throw HKCTLError.destinationConflict("A different room is already named '\(to)'.")
    }
    home.rooms[roomIndex].name = to
    for index in home.accessories.indices where home.accessories[index].roomID == room.id {
      home.accessories[index].roomName = to
    }
    return .renameRoom(
      homeID: home.id,
      roomID: room.id,
      operation: operation,
      summary: "Rename room '\(from)' to '\(to)'."
    )
  }

  private static func removeRoom(
    name: String,
    operation: Operation,
    home: inout HomeSnapshot
  ) throws -> PlannedOperation {
    let roomIndex = try uniqueRoomIndex(named: name, home: home)
    let room = home.rooms.remove(at: roomIndex)
    for index in home.accessories.indices where home.accessories[index].roomID == room.id {
      home.accessories[index].roomID = nil
      home.accessories[index].roomName = nil
    }
    return .removeRoom(
      homeID: home.id,
      roomID: room.id,
      operation: operation,
      summary: "Remove room '\(name)'."
    )
  }

  private static func renameAccessory(
    selector: AccessorySelector,
    to: String,
    operation: Operation,
    home: inout HomeSnapshot
  ) throws -> PlannedOperation {
    let accessoryIndex = try accessoryIndex(for: selector, home: home)
    let accessory = home.accessories[accessoryIndex]
    let label = accessoryLabel(accessory, selector: selector)
    if accessory.name == to {
      return .unchanged(
        operation: operation,
        summary: "Accessory \(label) already has that name."
      )
    }
    guard !home.accessories.contains(where: { $0.id != accessory.id && $0.name == to }) else {
      throw HKCTLError.destinationConflict("A different accessory is already named '\(to)'.")
    }
    home.accessories[accessoryIndex].name = to
    return .renameAccessory(
      homeID: home.id,
      accessoryID: accessory.id,
      operation: operation,
      summary: "Rename accessory \(label) to '\(to)'."
    )
  }

  private static func assignAccessory(
    selector: AccessorySelector,
    room: String,
    operation: Operation,
    home: inout HomeSnapshot
  ) throws -> PlannedOperation {
    let accessoryIndex = try accessoryIndex(for: selector, home: home)
    let roomIndex = try uniqueRoomIndex(named: room, home: home)
    let accessory = home.accessories[accessoryIndex]
    let label = accessoryLabel(accessory, selector: selector)
    let destination = home.rooms[roomIndex]
    if accessory.roomID == destination.id {
      return .unchanged(
        operation: operation,
        summary: "Accessory \(label) is already assigned to room '\(room)'."
      )
    }
    home.accessories[accessoryIndex].roomID = destination.id
    home.accessories[accessoryIndex].roomName = destination.name
    return .assignAccessory(
      homeID: home.id,
      accessoryID: accessory.id,
      roomID: destination.id,
      operation: operation,
      summary: "Assign accessory \(label) to room '\(room)'."
    )
  }

  private static func removeAccessory(
    selector: AccessorySelector,
    operation: Operation,
    home: inout HomeSnapshot
  ) throws -> PlannedOperation {
    let accessoryIndex = try accessoryIndex(for: selector, home: home)
    let accessory = home.accessories.remove(at: accessoryIndex)
    let label = accessoryLabel(accessory, selector: selector)
    let reachability = accessory.reachable ? "reachable" : "unreachable"
    let detail = [accessory.manufacturer, accessory.model].compactMap { $0 }.joined(separator: " ")
    let suffix = detail.isEmpty ? reachability : "\(detail), \(reachability)"
    return .removeAccessory(
      homeID: home.id,
      accessoryID: accessory.id,
      operation: operation,
      summary: "Unpair accessory \(label) (\(suffix))."
    )
  }

  private static func uniqueRoomIndex(named name: String, home: HomeSnapshot) throws -> Int {
    let matches = home.rooms.indices.filter { home.rooms[$0].name == name }
    guard !matches.isEmpty else {
      throw HKCTLError.targetNotFound("No room is named '\(name)' in home '\(home.name)'.")
    }
    guard matches.count == 1, let index = matches.first else {
      throw HKCTLError.targetAmbiguous(
        "More than one room is named '\(name)' in home '\(home.name)'."
      )
    }
    return index
  }

  private static func accessoryIndex(
    for selector: AccessorySelector,
    home: HomeSnapshot
  ) throws -> Int {
    switch selector {
    case let .name(name, manufacturer):
      return try uniqueAccessoryIndex(named: name, manufacturer: manufacturer, home: home)
    case let .id(id):
      guard
        let index = home.accessories.firstIndex(where: {
          $0.id.caseInsensitiveCompare(id) == .orderedSame
        })
      else {
        throw HKCTLError.targetNotFound(
          "No accessory has id '\(id)' in home '\(home.name)'. Run 'hkctl list --json' to refresh IDs."
        )
      }
      return index
    }
  }

  private static func uniqueAccessoryIndex(
    named name: String,
    manufacturer: String?,
    home: HomeSnapshot
  ) throws -> Int {
    let matches = home.accessories.indices.filter { index in
      let accessory = home.accessories[index]
      return accessory.name == name
        && (manufacturer == nil || accessory.manufacturer == manufacturer)
    }
    guard !matches.isEmpty else {
      let suffix = manufacturer.map { " from manufacturer '\($0)'" } ?? ""
      throw HKCTLError.targetNotFound(
        "No accessory is named '\(name)'\(suffix) in home '\(home.name)'."
      )
    }
    guard matches.count == 1, let index = matches.first else {
      throw HKCTLError.targetAmbiguous(
        "More than one accessory is named '\(name)'; select one with --id <uuid> from 'hkctl list --json'."
      )
    }
    return index
  }

  private static func accessoryLabel(
    _ accessory: AccessorySnapshot,
    selector: AccessorySelector
  ) -> String {
    switch selector {
    case .name:
      return "'\(accessory.name)'"
    case .id:
      return "'\(accessory.name)' [\(accessory.id)]"
    }
  }
}
