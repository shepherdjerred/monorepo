import Foundation
import HKCTLCore
import HomeKit

@MainActor
final class HomeKitGateway: HomeGateway {
  private let manager: HMHomeManager

  init(manager: HMHomeManager) {
    self.manager = manager
  }

  func homes() async throws -> [HomeSnapshot] {
    manager.homes.map { home in
      HomeSnapshot(
        id: home.uniqueIdentifier.uuidString,
        name: home.name,
        isPrimary: home.isPrimary,
        rooms: home.rooms.map { room in
          RoomSnapshot(id: room.uniqueIdentifier.uuidString, name: room.name)
        },
        accessories: home.accessories.map { accessory in
          AccessorySnapshot(
            id: accessory.uniqueIdentifier.uuidString,
            name: accessory.name,
            roomID: accessory.room?.uniqueIdentifier.uuidString,
            roomName: accessory.room?.name,
            manufacturer: accessory.manufacturer,
            model: accessory.model,
            reachable: accessory.isReachable
          )
        }
      )
    }
  }

  func renameRoom(homeID: String, roomID: String, to name: String) async throws {
    let home = try findHome(id: homeID)
    let room = try findRoom(id: roomID, home: home)
    try await room.updateName(name)
  }

  func removeRoom(homeID: String, roomID: String) async throws {
    let home = try findHome(id: homeID)
    let room = try findRoom(id: roomID, home: home)
    try await home.removeRoom(room)
  }

  func renameAccessory(homeID: String, accessoryID: String, to name: String) async throws {
    let home = try findHome(id: homeID)
    let accessory = try findAccessory(id: accessoryID, home: home)
    try await accessory.updateName(name)
  }

  func assignAccessory(homeID: String, accessoryID: String, roomID: String) async throws {
    let home = try findHome(id: homeID)
    let accessory = try findAccessory(id: accessoryID, home: home)
    let room = try findRoom(id: roomID, home: home)
    try await home.assignAccessory(accessory, to: room)
  }

  func removeAccessory(homeID: String, accessoryID: String) async throws {
    let home = try findHome(id: homeID)
    let accessory = try findAccessory(id: accessoryID, home: home)
    try await home.removeAccessory(accessory)
  }

  private func findHome(id: String) throws -> HMHome {
    guard let home = manager.homes.first(where: { $0.uniqueIdentifier.uuidString == id }) else {
      throw HKCTLError.operationFailed("HomeKit no longer contains the selected home.")
    }
    return home
  }

  private func findRoom(id: String, home: HMHome) throws -> HMRoom {
    guard let room = home.rooms.first(where: { $0.uniqueIdentifier.uuidString == id }) else {
      throw HKCTLError.operationFailed("HomeKit no longer contains the selected room.")
    }
    return room
  }

  private func findAccessory(id: String, home: HMHome) throws -> HMAccessory {
    guard let accessory = home.accessories.first(where: { $0.uniqueIdentifier.uuidString == id })
    else {
      throw HKCTLError.operationFailed("HomeKit no longer contains the selected accessory.")
    }
    return accessory
  }
}
