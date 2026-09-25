import Foundation

/// Memory-only cache for the Muse keychain token.
///
/// `muse` rewrites its keychain item on rotation, which resets the item ACL and drops any
/// Always Allow grant, so Brim cannot rely on a grant surviving. The auth file is rewritten
/// alongside the item, so its mtime is a silent rotation signal: the cached token is reused
/// while the file is unchanged, and a failed read backs off instead of prompting every poll.
/// Nothing here is ever persisted; a restart clears it all.
final class MuseKeychainCredentialCache: @unchecked Sendable {
  private struct Entry: Sendable {
    let credential: ProviderCredential
    let fileMTime: Date
  }

  private struct Failure: Sendable {
    let at: Date
    let fileMTime: Date?
  }

  static let failureCooldown: TimeInterval = 3_600

  private let lock = NSLock()
  private let dateProvider: @Sendable () -> Date
  private var entry: Entry?
  private var failure: Failure?

  init(dateProvider: @escaping @Sendable () -> Date = { Date.now }) {
    self.dateProvider = dateProvider
  }

  func credential(
    fileMTime: Date?,
    excluding excludedTokens: Set<String>
  ) -> ProviderCredential? {
    lock.withLock {
      guard let entry, let fileMTime, fileMTime == entry.fileMTime else { return nil }
      guard !excludedTokens.contains(entry.credential.accessToken) else { return nil }
      return entry.credential
    }
  }

  func isReadSuppressed(fileMTime: Date?) -> Bool {
    let now = dateProvider()
    return lock.withLock {
      guard let failure else { return false }
      guard now.timeIntervalSince(failure.at) < Self.failureCooldown else { return false }
      // A rotation invalidates the failure: the new item deserves one fresh attempt.
      return fileMTime == failure.fileMTime
    }
  }

  func store(_ credential: ProviderCredential, fileMTime: Date?) {
    lock.withLock {
      failure = nil
      guard let fileMTime else {
        entry = nil
        return
      }
      entry = Entry(credential: credential, fileMTime: fileMTime)
    }
  }

  func recordFailure(fileMTime: Date?) {
    let now = dateProvider()
    lock.withLock {
      failure = Failure(at: now, fileMTime: fileMTime)
    }
  }

  func clear() {
    lock.withLock { entry = nil }
  }
}
