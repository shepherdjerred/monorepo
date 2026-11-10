import Foundation
public import Observation

/// State for a session's Requests tab: the captured-request timeline and
/// the selected capture's detail, which loads only when it is selected.
///
/// Loads are idempotent for the same session or capture, so a view that
/// re-runs its task does not refetch.
@MainActor @Observable
public final class CapturesModel {
  public static let pageSize = 100

  public private(set) var session: Int?
  public private(set) var captures: [HistoryCapture] = []
  public private(set) var hasMore = false
  public private(set) var listPhase: HistoryLoadPhase = .idle
  public var selectedCaptureID: Int?
  public private(set) var detail: HistoryCaptureDetail?
  public private(set) var detailPhase: HistoryLoadPhase = .idle

  private let client: HistoryClient
  private var listGeneration = 0
  private var detailGeneration = 0

  public init(client: HistoryClient = HistoryClient()) {
    self.client = client
  }

  /// The first page for a history session; a no-op when it is already
  /// loaded or loading, unless `force` is set.
  public func load(session id: Int, force: Bool = false) async {
    guard force || id != session || listPhase.error != nil else { return }
    session = id
    captures = []
    hasMore = false
    selectedCaptureID = nil
    detail = nil
    detailPhase = .idle
    await loadPage(offset: 0)
  }

  public func loadMore() async {
    guard hasMore, listPhase != .loading else { return }
    await loadPage(offset: captures.count)
  }

  /// The detail of `selectedCaptureID`, unless it is already shown.
  public func loadSelectedDetail() async {
    guard let id = selectedCaptureID else {
      detailGeneration += 1
      detail = nil
      detailPhase = .idle
      return
    }
    guard detail?.capture.id != id || detailPhase.error != nil else { return }
    detailGeneration += 1
    let generation = detailGeneration
    detail = nil
    detailPhase = .loading
    do {
      let loaded = try await client.capture(id: id)
      guard generation == detailGeneration else { return }
      detail = loaded
      detailPhase = .loaded
    } catch {
      guard generation == detailGeneration else { return }
      detailPhase = .failed(error)
    }
  }

  private func loadPage(offset: Int) async {
    guard let session else { return }
    listGeneration += 1
    let generation = listGeneration
    listPhase = .loading
    do {
      let page = try await client.captures(session: session, limit: Self.pageSize, offset: offset)
      guard generation == listGeneration else { return }
      captures += page.captures
      hasMore = page.hasMore
      listPhase = .loaded
    } catch {
      guard generation == listGeneration else { return }
      listPhase = .failed(error)
    }
  }
}
