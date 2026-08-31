import Foundation
import Testing

@testable import HKCTLCore

@Test
func helpLaunchesEachCommandInANewAppInstance() {
  #expect(CLI.help.contains("open -n -W"))
  #expect(!CLI.help.contains("open -W"))
}

@Test
func parsesListWithGlobalOptionsInAnyPosition() throws {
  let invocation = try CLI.parse(arguments: [
    "list", "--json", "--home", "Lake House", "--output=/tmp/result.json",
  ])

  #expect(invocation.action == .list)
  #expect(invocation.homeName == "Lake House")
  #expect(invocation.outputPath == "/tmp/result.json")
  #expect(invocation.outputFormat == .json)
  #expect(!invocation.applyChanges)
}

@Test
func parsesEveryMutationSubcommand() throws {
  let roomRename = try CLI.parse(arguments: ["room", "rename", "Guest", "Guest Bedroom"])
  #expect(roomRename.action == .operations([.renameRoom(from: "Guest", to: "Guest Bedroom")]))

  let roomRemove = try CLI.parse(arguments: ["room", "remove", "Unused"])
  #expect(roomRemove.action == .operations([.removeRoom(name: "Unused")]))

  let accessoryRename = try CLI.parse(arguments: [
    "accessory", "rename", "Lamp", "Desk Lamp", "--manufacturer", "Hue",
  ])
  #expect(
    accessoryRename.action
      == .operations([
        .renameAccessory(selector: .name("Lamp", manufacturer: "Hue"), to: "Desk Lamp")
      ])
  )

  let assign = try CLI.parse(arguments: ["--apply", "accessory", "assign", "Lamp", "Office"])
  #expect(
    assign.action
      == .operations([
        .assignAccessory(selector: .name("Lamp", manufacturer: nil), room: "Office")
      ])
  )
  #expect(assign.applyChanges)

  let remove = try CLI.parse(arguments: ["accessory", "remove", "Stale Bridge"])
  #expect(
    remove.action
      == .operations([.removeAccessory(selector: .name("Stale Bridge", manufacturer: nil))])
  )
}

@Test
func parsesAccessoryIDsInSpacedAndAssignedForms() throws {
  let lowercaseID = "dd8cadc8-4576-50b8-8f34-d10a73393c9b"
  let normalizedID = "DD8CADC8-4576-50B8-8F34-D10A73393C9B"

  let rename = try CLI.parse(arguments: [
    "accessory", "rename", "--id", lowercaseID, "Laundry Light",
  ])
  #expect(
    rename.action
      == .operations([.renameAccessory(selector: .id(normalizedID), to: "Laundry Light")])
  )

  let assign = try CLI.parse(arguments: [
    "accessory", "assign", "--id=\(lowercaseID)", "Laundry",
  ])
  #expect(
    assign.action
      == .operations([.assignAccessory(selector: .id(normalizedID), room: "Laundry")])
  )

  let remove = try CLI.parse(arguments: ["accessory", "remove", "--id", lowercaseID])
  #expect(remove.action == .operations([.removeAccessory(selector: .id(normalizedID))]))
}

@Test
func rejectsMalformedOrConflictingAccessoryIDSelectors() {
  #expect(throws: HKCTLError.self) {
    try CLI.parse(arguments: ["accessory", "assign", "--id", "not-a-uuid", "Office"])
  }
  #expect(throws: HKCTLError.self) {
    try CLI.parse(arguments: [
      "accessory", "rename", "--id", "DD8CADC8-4576-50B8-8F34-D10A73393C9B",
      "Lamp", "--manufacturer", "Zooz",
    ])
  }
}

@Test
func parsesBatchFileAndDefaultsToDryRun() throws {
  let invocation = try CLI.parse(arguments: ["apply", "--file", "changes.json"])

  #expect(invocation.action == .batchFile("changes.json"))
  #expect(!invocation.applyChanges)
}

@Test
func rejectsConflictingSafetyFlags() {
  #expect(throws: HKCTLError.self) {
    try CLI.parse(arguments: ["--apply", "--dry-run", "room", "remove", "Guest"])
  }
}

@Test
func rejectsApplyForReadOnlyCommand() {
  #expect(throws: HKCTLError.self) {
    try CLI.parse(arguments: ["--apply", "list"])
  }
}

@Test
func extractsOutputPathFromMalformedInvocation() {
  #expect(
    CLI.requestedOutputPath(arguments: ["--output", "/tmp/error.json", "bogus"])
      == "/tmp/error.json"
  )
  #expect(
    CLI.requestedOutputPath(arguments: ["bogus", "--output=/tmp/error.json"])
      == "/tmp/error.json"
  )
}

@Test
func extractsOutputFormatFromMalformedInvocation() {
  #expect(CLI.requestedOutputFormat(arguments: ["--json", "bogus"]) == .json)
  #expect(CLI.requestedOutputFormat(arguments: ["--format", "json", "bogus"]) == .json)
  #expect(CLI.requestedOutputFormat(arguments: ["bogus", "--format=text"]) == .text)
}
