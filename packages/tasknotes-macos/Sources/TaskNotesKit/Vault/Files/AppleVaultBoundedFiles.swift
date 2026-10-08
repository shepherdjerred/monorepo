import Foundation
import Synchronization

extension AppleVaultFiles {
    /// Bind immediately after the engine exposes its durable SQLite identity,
    /// before profile/file calls. A single host namespace lease fences writers.
    internal func bindEngine(identity: String, secrets: any FacetSecureStore) throws {
        try bounded.withLock { storage in
            guard storage == nil else { throw VaultStageError.changedIntent }
            storage = try VaultBoundedStorage(
                directory: boundedDirectory, secrets: secrets, engineIdentity: identity)
        }
    }

    internal func closeBoundedFiles() throws {
        try bounded.withLock { storage in
            defer { storage = nil }
            try storage?.close()
        }
    }

    internal func openFileSnapshot(profileID: String, path: String) throws -> VaultSnapshotReceipt?
    {
        let storage = try boundedStorage()
        return try withRoot(profileID) { root in
            let target = try checkedURL(root: root, path: path)
            var failure: NSError?
            var result: Result<VaultSnapshotReceipt?, any Error> = .failure(
                AppleVaultError.coordinationFailed)
            unsafe NSFileCoordinator().coordinate(
                readingItemAt: target, options: [], error: &failure
            ) { url in
                result = Result {
                    guard url.standardizedFileURL == target.standardizedFileURL else {
                        throw AppleVaultError.coordinationFailed
                    }
                    return try storage.openSnapshot(profileID: profileID, root: root, path: path)
                }
            }
            if let failure {
                if failure.domain == NSCocoaErrorDomain && failure.code == NSFileReadNoSuchFileError
                {
                    return nil
                }
                throw failure
            }
            return try result.get()
        }
    }

    internal func openDisplacedSnapshot(profileID: String, id: String) throws
        -> VaultSnapshotReceipt
    {
        let storage = try boundedStorage()
        return try withRoot(profileID) { root in
            try storage.openDisplacedSnapshot(profileID: profileID, root: root, id: id)
        }
    }

    internal func readSnapshotChunk(profileID: String, id: String, offset: UInt64, length: UInt32)
        throws -> Data
    {
        guard length <= VaultFile.maximumChunk else { throw AppleVaultError.invalidPath }
        return try boundedStorage().readSnapshot(
            profileID: profileID, id: id, offset: offset, length: Int(length))
    }

    internal func closeSnapshot(profileID: String, id: String) throws {
        try boundedStorage().closeSnapshot(profileID: profileID, id: id)
    }

    internal func beginReplacement(_ intent: VaultStageIntent) throws -> VaultStageReceipt {
        try boundedStorage().begin(intent)
    }

    internal func writeReplacementChunk(profileID: String, id: String, offset: UInt64, bytes: Data)
        throws -> VaultStageReceipt
    {
        try boundedStorage().write(profileID: profileID, id: id, offset: offset, bytes: bytes)
    }

    internal func sealReplacement(profileID: String, id: String) throws -> VaultStageReceipt {
        try boundedStorage().seal(profileID: profileID, id: id)
    }

    internal func compareExchangeStaged(_ request: VaultExchangeRequest) throws
        -> VaultStagedOutcome
    {
        let storage = try boundedStorage()
        if let outcome = try storage.persistedOutcome(request) { return outcome }
        return try withRoot(request.profileID) { root in
            let target = try checkedURL(root: root, path: request.path)
            var failure: NSError?
            var result: Result<VaultStagedOutcome, any Error> = .failure(
                AppleVaultError.coordinationFailed)
            unsafe NSFileCoordinator().coordinate(
                writingItemAt: target, options: .forReplacing, error: &failure
            ) { url in
                result = Result {
                    guard url.standardizedFileURL == target.standardizedFileURL else {
                        throw AppleVaultError.coordinationFailed
                    }
                    return try storage.exchange(request, root: root)
                }
            }
            if let failure { throw failure }
            return try result.get()
        }
    }

    internal func discardReplacement(profileID: String, id: String) throws {
        let storage = try boundedStorage()
        try withRoot(profileID) { root in
            try storage.discard(profileID: profileID, root: root, id: id)
        }
    }

    internal func boundedDisplacedMetadata(profileID: String, afterID: String?, limit: UInt32)
        throws
        -> [VaultCapturedPredecessor]
    {
        let storage = try boundedStorage()
        return try withRoot(profileID) { root in
            try storage.displacedMetadata(
                profileID: profileID, root: root, afterID: afterID, limit: limit)
        }
    }

    internal func acknowledgeBoundedDisplaced(profileID: String, id: String) throws {
        let storage = try boundedStorage()
        try withRoot(profileID) { root in
            try storage.acknowledgeDisplaced(profileID: profileID, root: root, id: id)
        }
    }

    private func boundedStorage() throws -> VaultBoundedStorage {
        guard let storage = bounded.withLock({ $0 }) else { throw VaultSnapshotError.invalidHandle }
        return storage
    }
}
