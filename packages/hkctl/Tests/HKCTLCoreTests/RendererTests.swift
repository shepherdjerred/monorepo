import Foundation
import Testing

@testable import HKCTLCore

@Test
func rendersMachineReadableJSON() throws {
  let report = ExecutionReport(
    success: true,
    mode: .dryRun,
    home: renderingHome(),
    results: [
      OperationResult(
        operation: .removeAccessory(selector: .name("Old Bridge", manufacturer: nil)),
        status: .planned,
        summary: "Unpair accessory 'Old Bridge' (Acme Hub, unreachable)."
      )
    ]
  )

  let output = try Renderer.render(report: report, format: .json)
  let object = try #require(
    JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any]
  )

  #expect(object["success"] as? Bool == true)
  #expect(object["mode"] as? String == "dry-run")
}

@Test
func rendersHumanReadableStateAndMutationStatus() throws {
  let report = ExecutionReport(
    success: true,
    mode: .dryRun,
    home: renderingHome(),
    results: [
      OperationResult(
        operation: .removeAccessory(selector: .name("Old Bridge", manufacturer: nil)),
        status: .planned,
        summary: "Unpair accessory 'Old Bridge' (Acme Hub, unreachable)."
      )
    ]
  )

  let output = try Renderer.render(report: report, format: .text)

  #expect(output.contains("Home: Home (primary)"))
  #expect(output.contains("PLANNED: Unpair accessory 'Old Bridge'"))
  #expect(output.contains("Accessories (1):"))
  #expect(output.contains("id bridge"))
}

@Test
func rendersStructuredErrors() throws {
  let output = try Renderer.render(error: "No primary home", code: 1, format: .json)
  let object = try #require(
    JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any]
  )

  #expect(object["success"] as? Bool == false)
  #expect(object["code"] as? Int == 1)
  #expect(object["error"] as? String == "No primary home")
}

private func renderingHome() -> HomeSnapshot {
  HomeSnapshot(
    id: "home",
    name: "Home",
    isPrimary: true,
    rooms: [RoomSnapshot(id: "room", name: "Office")],
    accessories: [
      AccessorySnapshot(
        id: "bridge",
        name: "Old Bridge",
        roomID: nil,
        roomName: nil,
        manufacturer: "Acme",
        model: "Hub",
        reachable: false
      )
    ]
  )
}
