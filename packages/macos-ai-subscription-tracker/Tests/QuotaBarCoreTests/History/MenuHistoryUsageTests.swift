import Foundation
import XCTest

@testable import QuotaBarCore

/// The menu bar's daily usage and active blocks, read from the history daemon
/// on each refresh.
@MainActor
final class MenuHistoryUsageTests: XCTestCase {
  func testRefreshReadsTodaysUsageAndActiveBlocksFromTheDaemon() async throws {
    let transport = FakeHistoryTransport { path, _ in
      switch path {
      case "/v1/usage":
        return jsonResponse(
          usageReportBody(
            rows: [
              row("claude", model: "claude-opus-5-5", tokens: 1_200_000, cost: 4.2),
              row("kimi", model: "kimi-k3", machine: "desk", tokens: 900, cost: 0.01),
            ],
            unpriced: []))
      case "/v1/blocks":
        return jsonResponse(try sharedHistoryFixture("blocks"))
      default:
        return jsonResponse(#"{"error":"Not found"}"#, status: 404)
      }
    }
    let codex = FakeProvider(
      id: .codex, results: [.success(snapshot(provider: .codex, remaining: 60))])
    let store = MemorySnapshotStore()
    let model = makeModel(
      providers: [codex], store: store, history: HistoryClient(transport: transport))
    XCTAssertNil(model.historyUsage)

    await model.refresh()

    let usage = try XCTUnwrap(try model.historyUsage?.get())
    XCTAssertEqual(usage.today[.claudeCode]?.caption, "Today: 1.2M tok · $4.20")
    XCTAssertEqual(usage.today[.kimi]?.allMachinesCaption, "All machines: 900 tok · $0.01")
    XCTAssertEqual(usage.activeBlocks[.claudeCode]?.measured.usage.costUSD, 2.2)
    XCTAssertNil(usage.activeBlocks[.codex])
    XCTAssertEqual(store.savedSnapshots[.codex]?.provider, .codex)
    let targets = await transport.log.targets
    XCTAssertEqual(targets.count, 2)
    XCTAssertTrue(targets.contains("/v1/blocks?active=true&machine=all"))
    XCTAssertTrue(
      targets.contains { $0.hasPrefix("/v1/usage?period=day&breakdown=agent%2Cmodel%2Cmachine") })
  }

  func testAStoppedDaemonIsAnExplicitUsageFailure() async {
    let model = makeModel(providers: [])
    await model.refresh()
    guard case let .failure(error) = model.historyUsage else {
      XCTFail("Expected a daemon failure")
      return
    }
    XCTAssertEqual(error, .daemonNotRunning(socketPath: "/nonexistent/daemon.sock"))
  }

  func testABlocksFailureFailsTheWholeUsageRead() async {
    let transport = FakeHistoryTransport { path, _ in
      path == "/v1/usage"
        ? jsonResponse(usageReportBody(rows: [], unpriced: []))
        : jsonResponse(#"{"apiVersion":2}"#)
    }
    let model = makeModel(providers: [], history: HistoryClient(transport: transport))
    await model.refresh()
    guard case .failure(.unsupportedAPIVersion(2)) = model.historyUsage else {
      XCTFail("Expected the blocks version mismatch, got \(String(describing: model.historyUsage))")
      return
    }
  }

  private func makeModel(
    providers: [any UsageProvider],
    store: MemorySnapshotStore = MemorySnapshotStore(),
    history: HistoryClient = offlineHistory
  ) -> QuotaBarModel {
    QuotaBarModel(
      providers: providers,
      settings: AppSettings(
        store: MemoryModelSettingsStore(enabled: Set(providers.map(\.id))),
        minimumPollingInterval: 60
      ),
      store: store,
      historyStore: MemoryHistoryStore(),
      refresh: QuotaBarRefresh(timeout: .seconds(1), history: history)
    )
  }

  private func snapshot(provider: ProviderID, remaining: Double) -> UsageSnapshot {
    UsageSnapshot(
      provider: provider, windows: [window(remaining: remaining)], sourceTimestamp: .now)
  }
}
