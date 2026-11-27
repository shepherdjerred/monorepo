import Darwin
import Foundation

struct BrimCollectorHistory: Sendable {
  let legacy: any UsageHistoryPersisting
  let stateURL: URL

  private struct State: Codable {
    let importedLegacy: Bool
    let pending: [UsageHistorySample]
  }

  func lock() throws -> FileHandle {
    let directory = stateURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let lockPath = directory.appending(path: "collect.lock").path
    let descriptor = Darwin.open(lockPath, O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard descriptor >= 0 else { throw QuotaError.historyWriteFailed }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      Darwin.close(descriptor)
      throw CollectorLockError.busy
    }
    return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
  }

  func stage(_ collection: BrimCollection) throws -> [UsageHistorySample] {
    let state = try read()
    let legacySamples = try state.importedLegacy ? [] : legacy.load()
    let latest = collection.quotas.compactMap(\.snapshot).flatMap(UsageHistorySample.samples)
    let samples = UsageHistory.compact(
      state.pending + legacySamples + latest, at: collection.collectedAt)
    // The upload can fail after some chunks arrive. Keep state until the whole
    // collection is acknowledged so the next run can retry all pending samples.
    try save(State(importedLegacy: true, pending: samples))
    return samples
  }

  func acknowledge() throws {
    try save(State(importedLegacy: true, pending: []))
  }

  private func read() throws -> State {
    do {
      return try JSONDecoder().decode(State.self, from: Data(contentsOf: stateURL))
    } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
      return State(importedLegacy: false, pending: [])
    } catch {
      throw QuotaError.historyCorrupt
    }
  }

  private func save(_ state: State) throws {
    do {
      try FileManager.default.createDirectory(
        at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700])
      try JSONEncoder().encode(state).write(to: stateURL, options: .atomic)
    } catch {
      throw QuotaError.historyWriteFailed
    }
  }
}

private enum CollectorLockError: LocalizedError {
  case busy

  var errorDescription: String? { "A Brim collection is already in progress on this Mac." }
}
