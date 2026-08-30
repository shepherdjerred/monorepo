import Foundation
import Testing

@testable import HKCTLCore

@MainActor
@Test
func selectsPrimaryHomeByDefaultAndExactHomeByName() throws {
  let executor = CommandExecutor()
  let primary = sampleHome(id: "primary", name: "Home", isPrimary: true)
  let second = sampleHome(id: "second", name: "Cabin", isPrimary: false)

  #expect(try executor.selectHome(named: nil, from: [primary, second]) == primary)
  #expect(try executor.selectHome(named: "Cabin", from: [primary, second]) == second)
}

@MainActor
@Test
func rejectsAmbiguousNamedHome() {
  let homes = [
    sampleHome(id: "one", name: "Home", isPrimary: true),
    sampleHome(id: "two", name: "Home", isPrimary: false),
  ]

  #expect(throws: HKCTLError.self) {
    try CommandExecutor().selectHome(named: "Home", from: homes)
  }
}

@MainActor
@Test
func dryRunPlansWithoutCallingGatewayMutations() async throws {
  let gateway = FakeGateway(homes: [sampleHome()])
  let invocation = Invocation(
    action: .operations([.renameRoom(from: "Guest", to: "Guest Bedroom")]),
    homeName: nil,
    outputPath: "/tmp/hkctl.out",
    outputFormat: .text,
    applyChanges: false
  )

  let outcome = try await CommandExecutor().execute(
    invocation: invocation,
    operations: [.renameRoom(from: "Guest", to: "Guest Bedroom")],
    gateway: gateway
  )

  guard case let .success(report) = outcome else {
    Issue.record("Expected a successful dry-run report")
    return
  }
  #expect(report.mode == .dryRun)
  #expect(report.results.map(\.status) == [.planned])
  #expect(gateway.calls.isEmpty)
}

@MainActor
@Test
func applyMutatesAfterCompletePreflight() async throws {
  let gateway = FakeGateway(homes: [sampleHome()])
  let operations: [HKCTLCore.Operation] = [
    .renameRoom(from: "Guest", to: "Guest Bedroom"),
    .assignAccessory(
      selector: .name("Desk Lamp", manufacturer: nil),
      room: "Guest Bedroom"
    ),
  ]
  let invocation = Invocation(
    action: .operations(operations),
    homeName: nil,
    outputPath: "/tmp/hkctl.out",
    outputFormat: .json,
    applyChanges: true
  )

  let outcome = try await CommandExecutor().execute(
    invocation: invocation,
    operations: operations,
    gateway: gateway
  )

  guard case let .success(report) = outcome else {
    Issue.record("Expected applied operations to succeed")
    return
  }
  #expect(report.mode == .applied)
  #expect(report.results.map(\.status) == [.applied, .applied])
  #expect(gateway.calls == ["rename-room:room-guest:Guest Bedroom", "assign:lamp:room-guest"])
}

@MainActor
@Test
func reportsAppliedMutationsWhenPostApplyRefreshFails() async throws {
  let gateway = FakeGateway(homes: [sampleHome()], failHomesAfterFirstCall: true)
  let operation = Operation.renameRoom(from: "Guest", to: "Guest Bedroom")
  let invocation = Invocation(
    action: .operations([operation]),
    homeName: nil,
    outputPath: "/tmp/hkctl.out",
    outputFormat: .text,
    applyChanges: true
  )

  let outcome = try await CommandExecutor().execute(
    invocation: invocation,
    operations: [operation],
    gateway: gateway
  )

  guard case let .failure(report) = outcome else {
    Issue.record("Expected a failed report when HomeKit state cannot be refreshed")
    return
  }
  #expect(report.results.map(\.status) == [.applied])
  #expect(report.error?.contains("Mutations were applied") == true)
}

@MainActor
@Test
func ambiguousAccessoryFailsPreflightBeforeAnyMutation() async throws {
  var home = sampleHome()
  home.accessories.append(
    AccessorySnapshot(
      id: "second-lamp",
      name: "Desk Lamp",
      roomID: "room-office",
      roomName: "Office",
      manufacturer: "Other",
      model: "Bulb",
      reachable: true
    )
  )
  let gateway = FakeGateway(homes: [home])
  let operation = Operation.removeAccessory(
    selector: .name("Desk Lamp", manufacturer: nil)
  )
  let invocation = Invocation(
    action: .operations([operation]),
    homeName: nil,
    outputPath: "/tmp/hkctl.out",
    outputFormat: .text,
    applyChanges: true
  )

  await #expect(throws: HKCTLError.self) {
    try await CommandExecutor().execute(
      invocation: invocation,
      operations: [operation],
      gateway: gateway
    )
  }
  #expect(gateway.calls.isEmpty)
}

@MainActor
@Test
func accessoryIDSelectsOneOfSeveralIdenticallyNamedAccessories() async throws {
  let firstID = "DD8CADC8-4576-50B8-8F34-D10A73393C9B"
  let secondID = "6A3F2606-A906-5401-967D-D61D9E3465AF"
  var home = sampleHome()
  home.accessories = [
    AccessorySnapshot(
      id: firstID,
      name: "Light",
      roomID: "room-office",
      roomName: "Office",
      manufacturer: "Zooz",
      model: "ZEN76",
      reachable: true
    ),
    AccessorySnapshot(
      id: secondID,
      name: "Light",
      roomID: "room-office",
      roomName: "Office",
      manufacturer: "Zooz",
      model: "ZEN76",
      reachable: true
    ),
  ]
  let gateway = FakeGateway(homes: [home])
  let operation = Operation.assignAccessory(selector: .id(secondID), room: "Guest")
  let invocation = Invocation(
    action: .operations([operation]),
    homeName: nil,
    outputPath: "/tmp/hkctl.out",
    outputFormat: .text,
    applyChanges: true
  )

  let outcome = try await CommandExecutor().execute(
    invocation: invocation,
    operations: [operation],
    gateway: gateway
  )

  guard case let .success(report) = outcome else {
    Issue.record("Expected an ID-selected accessory mutation to succeed")
    return
  }
  #expect(report.results.map(\.status) == [.applied])
  #expect(gateway.calls == ["assign:\(secondID):room-guest"])
}

@MainActor
@Test
func missingAccessoryIDFailsPreflightBeforeAnyMutation() async throws {
  let gateway = FakeGateway(homes: [sampleHome()])
  let operation = Operation.removeAccessory(
    selector: .id("DD8CADC8-4576-50B8-8F34-D10A73393C9B")
  )
  let invocation = Invocation(
    action: .operations([operation]),
    homeName: nil,
    outputPath: "/tmp/hkctl.out",
    outputFormat: .text,
    applyChanges: true
  )

  await #expect(throws: HKCTLError.self) {
    try await CommandExecutor().execute(
      invocation: invocation,
      operations: [operation],
      gateway: gateway
    )
  }
  #expect(gateway.calls.isEmpty)
}

@MainActor
private final class FakeGateway: HomeGateway {
  var storedHomes: [HomeSnapshot]
  var calls: [String] = []
  private let failHomesAfterFirstCall: Bool
  private var homesCallCount = 0

  init(homes: [HomeSnapshot], failHomesAfterFirstCall: Bool = false) {
    storedHomes = homes
    self.failHomesAfterFirstCall = failHomesAfterFirstCall
  }

  func homes() async throws -> [HomeSnapshot] {
    homesCallCount += 1
    if failHomesAfterFirstCall && homesCallCount > 1 {
      throw FakeError.refreshFailed
    }
    return storedHomes
  }

  func renameRoom(homeID: String, roomID: String, to name: String) async throws {
    calls.append("rename-room:\(roomID):\(name)")
    let homeIndex = try homeIndexFor(id: homeID)
    let roomIndex = try roomIndexFor(id: roomID, homeIndex: homeIndex)
    storedHomes[homeIndex].rooms[roomIndex].name = name
    for index in storedHomes[homeIndex].accessories.indices
    where storedHomes[homeIndex].accessories[index].roomID == roomID {
      storedHomes[homeIndex].accessories[index].roomName = name
    }
  }

  func removeRoom(homeID: String, roomID: String) async throws {
    calls.append("remove-room:\(roomID)")
    let homeIndex = try homeIndexFor(id: homeID)
    let roomIndex = try roomIndexFor(id: roomID, homeIndex: homeIndex)
    storedHomes[homeIndex].rooms.remove(at: roomIndex)
  }

  func renameAccessory(homeID: String, accessoryID: String, to name: String) async throws {
    calls.append("rename-accessory:\(accessoryID):\(name)")
    let homeIndex = try homeIndexFor(id: homeID)
    let accessoryIndex = try accessoryIndexFor(id: accessoryID, homeIndex: homeIndex)
    storedHomes[homeIndex].accessories[accessoryIndex].name = name
  }

  func assignAccessory(homeID: String, accessoryID: String, roomID: String) async throws {
    calls.append("assign:\(accessoryID):\(roomID)")
    let homeIndex = try homeIndexFor(id: homeID)
    let accessoryIndex = try accessoryIndexFor(id: accessoryID, homeIndex: homeIndex)
    let roomIndex = try roomIndexFor(id: roomID, homeIndex: homeIndex)
    storedHomes[homeIndex].accessories[accessoryIndex].roomID = roomID
    storedHomes[homeIndex].accessories[accessoryIndex].roomName =
      storedHomes[homeIndex].rooms[roomIndex].name
  }

  func removeAccessory(homeID: String, accessoryID: String) async throws {
    calls.append("remove-accessory:\(accessoryID)")
    let homeIndex = try homeIndexFor(id: homeID)
    let accessoryIndex = try accessoryIndexFor(id: accessoryID, homeIndex: homeIndex)
    storedHomes[homeIndex].accessories.remove(at: accessoryIndex)
  }

  private func homeIndexFor(id: String) throws -> Int {
    guard let index = storedHomes.firstIndex(where: { $0.id == id }) else {
      throw FakeError.missing
    }
    return index
  }

  private func roomIndexFor(id: String, homeIndex: Int) throws -> Int {
    guard let index = storedHomes[homeIndex].rooms.firstIndex(where: { $0.id == id }) else {
      throw FakeError.missing
    }
    return index
  }

  private func accessoryIndexFor(id: String, homeIndex: Int) throws -> Int {
    guard let index = storedHomes[homeIndex].accessories.firstIndex(where: { $0.id == id }) else {
      throw FakeError.missing
    }
    return index
  }
}

private enum FakeError: Error {
  case missing
  case refreshFailed
}

private func sampleHome(
  id: String = "home",
  name: String = "Home",
  isPrimary: Bool = true
) -> HomeSnapshot {
  HomeSnapshot(
    id: id,
    name: name,
    isPrimary: isPrimary,
    rooms: [
      RoomSnapshot(id: "room-guest", name: "Guest"),
      RoomSnapshot(id: "room-office", name: "Office"),
    ],
    accessories: [
      AccessorySnapshot(
        id: "lamp",
        name: "Desk Lamp",
        roomID: "room-office",
        roomName: "Office",
        manufacturer: "Hue",
        model: "Bulb",
        reachable: true
      )
    ]
  )
}
