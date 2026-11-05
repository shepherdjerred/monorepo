import Foundation
import XCTest

@testable import QuotaBarCore

final class MirrorIndexTests: XCTestCase {
  /// The fixture toolkit's writer is also tested against
  /// (`packages/toolkit/schemas/fixtures/brim-sync-mirror-index.json`).
  private var sharedFixture: URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    return url.appendingPathComponent("toolkit/schemas/fixtures/brim-sync-mirror-index.json")
  }

  func testDecodesTheSharedToolkitFixture() throws {
    let index = try MirrorIndex.decode(Data(contentsOf: sharedFixture))
    XCTAssertEqual(index.machines.map(\.machineId), ["jerred-pc", "studio"])
    XCTAssertEqual(index.machines.first?.platform, "win32")
    XCTAssertEqual(
      index.machines.first?.claudeProjectsDirs,
      ["/Users/tester/.toolkit/brim-sync/mirror/jerred-pc/claude/projects"]
    )
    XCTAssertEqual(index.machines.last?.codexSessionsDirs, [])
  }

  func testRejectsAnUnsupportedSchemaVersion() {
    XCTAssertThrowsError(
      try MirrorIndex.decode(Data(#"{"schemaVersion":2,"machines":[]}"#.utf8))
    ) { error in
      XCTAssertEqual(error as? MirrorIndexError, .unsupportedSchemaVersion(2))
    }
  }

  func testAMissingIndexIsNotAnError() throws {
    let home = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: home) }
    XCTAssertNil(try MirrorIndex.load(home: home, fileManager: .default))
  }
}

final class MirrorUsageScannerTests: XCTestCase {
  private let now = date("2026-11-01T18:00:00Z")

  func testAddsOtherMachinesToTodaysUsage() throws {
    let home = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: home) }
    try log(assistant(input: 100), at: home.appendingPathComponent(".claude/projects/p/a.jsonl"))
    let remote = home.appendingPathComponent(".toolkit/brim-sync/mirror/pc/claude/projects")
    try log(assistant(input: 400), at: remote.appendingPathComponent("p/b.jsonl"))
    try writeIndex(home: home, claudeDirs: [remote.path])

    let usage = try XCTUnwrap(scan(home: home)[.claudeCode])
    XCTAssertEqual(usage.totalTokens, 100)
    XCTAssertEqual(usage.otherMachines.map(\.machineName), ["JERRED-PC"])
    XCTAssertEqual(usage.otherMachines.first?.totalTokens, 400)
    XCTAssertEqual(usage.allMachinesCaption, "All machines: 500 tok · ~$5.00 API")
    XCTAssertTrue(usage.allMachinesHelpText.contains("JERRED-PC: 400 tok · ~$4.00 API"))
    XCTAssertFalse(usage.otherMachinesUnreadable)
  }

  func testShowsRemoteUsageWithoutLocalLogs() throws {
    let home = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: home) }
    let remote = home.appendingPathComponent(".toolkit/brim-sync/mirror/pc/claude/projects")
    try log(assistant(input: 2_000), at: remote.appendingPathComponent("p/b.jsonl"))
    try writeIndex(home: home, claudeDirs: [remote.path])

    let usage = try XCTUnwrap(scan(home: home)[.claudeCode])
    XCTAssertNil(usage.caption)
    XCTAssertEqual(usage.allMachinesCaption, "All machines: 2K tok · ~$20.00 API")
    XCTAssertNil(scan(home: home)[.codex])
  }

  func testReportsAnUnreadableIndex() throws {
    let home = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: home) }
    try write("{not json", to: MirrorIndex.location(home: home))

    let usage = scan(home: home)
    XCTAssertEqual(usage[.claudeCode]?.otherMachinesUnreadable, true)
    XCTAssertEqual(usage[.codex]?.otherMachinesUnreadable, true)
    XCTAssertNil(usage[.claudeCode]?.allMachinesCaption)
  }

  func testAnUnpricedMachineDropsTheCombinedAmount() {
    let usage = LocalDailyUsage(
      provider: .codex,
      totalTokens: 10,
      estimatedCostUSD: Decimal(1),
      unpricedModels: [],
      unreadable: false,
      pricingUnavailable: false,
      otherMachines: [
        MachineDailyUsage(machineName: "pc", totalTokens: 5, estimatedCostUSD: nil)
      ]
    )
    XCTAssertEqual(usage.allMachinesCaption, "All machines: 15 tok")
  }

  private func scan(home: URL) -> [ProviderID: LocalDailyUsage] {
    LocalUsageScanner.scan(
      now: now,
      timeZone: utcTimeZone(),
      environment: [:],
      home: home,
      catalog: PricingCatalog(
        fetchedOn: "2026-11-01",
        prices: [
          "priced-model": ModelTokenPrice(
            input: decimal("10000"), output: decimal("0"), cacheCreate: decimal("0"),
            cacheRead: decimal("0"))
        ]
      )
    )
  }

  private func log(_ text: String, at url: URL) throws {
    try write(text, to: url)
    try FileManager.default.setAttributes([.modificationDate: now], ofItemAtPath: url.path)
  }

  private func writeIndex(home: URL, claudeDirs: [String]) throws {
    let machine: [String: Any] = [
      "machineId": "pc",
      "displayName": "JERRED-PC",
      "platform": "win32",
      "claudeProjectsDirs": claudeDirs,
      "codexSessionsDirs": [String](),
    ]
    let index: [String: Any] = ["schemaVersion": 1, "machines": [machine]]
    let data = try JSONSerialization.data(withJSONObject: index)
    let text = try XCTUnwrap(String(bytes: data, encoding: .utf8))
    try write(text, to: MirrorIndex.location(home: home))
  }

  private func assistant(input: Int) -> String {
    """
    {"type":"assistant","uuid":"\(UUID().uuidString)","timestamp":"2026-11-01T08:00:00Z",\
    "requestId":"req-\(input)","message":{"id":"msg-\(input)","model":"priced-model",\
    "usage":{"input_tokens":\(input),"output_tokens":0}}}
    """
  }
}
