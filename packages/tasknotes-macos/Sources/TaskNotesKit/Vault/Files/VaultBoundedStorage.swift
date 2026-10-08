import Foundation
import Synchronization

/// One callback owner serializes snapshots, stage manifests, and mutable file
/// descriptor positions. No file handle escapes the mutex-protected operation.
internal final class VaultBoundedStorage: Sendable {
    private struct State {
        let stages: VaultReplacementStages
        let snapshots: VaultSnapshots
        let exchanges: VaultStagedExchanges
        let legacy: VaultLegacyRecovery
        let signer: VaultHandleSigner
        let lease: VaultFile
        var closed = false
    }

    private let state: Mutex<State>

    init(directory: URL, secrets: any FacetSecureStore, engineIdentity: String) throws {
        let root = try VaultDirectory(url: directory)
        let lease: VaultFile
        if let existing = try root.openFile("payload-owner.lock", writable: true) {
            lease = existing
        } else {
            guard
                let created = try root.openFile(
                    "payload-owner.lock", writable: true, createNew: true)
            else { throw VaultStageError.corruptStage }
            lease = created
            try lease.synchronize()
            try root.synchronize()
        }
        try lease.acquireExclusiveLease()
        let signer = try VaultHandleSigner(
            directory: root, secrets: secrets, engineIdentity: engineIdentity)
        let snapshotsRoot = try root.directory("snapshots", create: true)
        let stages = VaultReplacementStages(directory: root, signer: signer)
        let value = State(
            stages: stages,
            snapshots: try VaultSnapshots(directory: snapshotsRoot, signer: signer),
            exchanges: VaultStagedExchanges(
                stages: stages,
                journal: VaultExchangeJournal(directory: root, signer: signer)),
            legacy: VaultLegacyRecovery(directory: root, engineIdentity: engineIdentity),
            signer: signer, lease: lease)
        state = Mutex(value)
    }

    func openSnapshot(profileID: String, directory: URL, name: String) throws
        -> VaultSnapshotReceipt?
    {
        try state.withLock { value in
            try requireOpen(value)
            guard let source = try VaultDirectory(url: directory).openFile(name) else { return nil }
            return try value.snapshots.open(profileID: profileID, source: source)
        }
    }

    func readSnapshot(profileID: String, id: String, offset: UInt64, length: Int) throws -> Data {
        try state.withLock { value in
            try requireOpen(value)
            return try value.snapshots.read(
                profileID: profileID, id: id, offset: offset, length: length)
        }
    }

    func openSnapshot(profileID: String, root: URL, path: String) throws -> VaultSnapshotReceipt? {
        try state.withLock { value in
            try requireOpen(value)
            try VaultRelativePath.validate(path)
            let capability = try VaultDirectory(url: root)
            do {
                let (parent, name) = try capability.parent(path)
                guard let source = try parent.openFile(name) else { return nil }
                return try value.snapshots.open(profileID: profileID, source: source)
            } catch let error as POSIXError where error.code == .ENOENT { return nil }
        }
    }

    func closeSnapshot(profileID: String, id: String) throws {
        try state.withLock { value in
            try requireOpen(value)
            try value.snapshots.close(profileID: profileID, id: id)
        }
    }

    func begin(_ intent: VaultStageIntent) throws -> VaultStageReceipt {
        try state.withLock { value in
            try requireOpen(value)
            return try value.stages.begin(intent)
        }
    }

    func write(profileID: String, id: String, offset: UInt64, bytes: Data) throws
        -> VaultStageReceipt
    {
        try state.withLock { value in
            try requireOpen(value)
            return try value.stages.write(
                profileID: profileID, id: id, offset: offset, bytes: bytes)
        }
    }

    func seal(profileID: String, id: String) throws -> VaultStageReceipt {
        try state.withLock { value in
            try requireOpen(value)
            return try value.stages.seal(profileID: profileID, id: id)
        }
    }

    func discard(profileID: String, id: String) throws {
        try state.withLock { value in
            try requireOpen(value)
            try value.stages.discard(profileID: profileID, id: id)
        }
    }

    func exchange(_ request: VaultExchangeRequest, root: URL) throws -> VaultStagedOutcome {
        try state.withLock { value in
            try requireOpen(value)
            return try value.exchanges.exchange(request, root: VaultDirectory(url: root))
        }
    }

    func persistedOutcome(_ request: VaultExchangeRequest) throws -> VaultStagedOutcome? {
        try state.withLock { value in
            try requireOpen(value)
            return try value.exchanges.persistedOutcome(request)
        }
    }

    func displacedMetadata(profileID: String, root: URL, afterID: String?, limit: UInt32) throws
        -> [VaultCapturedPredecessor]
    {
        try state.withLock { value in
            try requireOpen(value)
            let capability = try VaultDirectory(url: root)
            let legacy = try value.legacy.metadata(
                profileID: profileID, root: capability, afterID: afterID, limit: limit)
            let staged = try value.exchanges.displacedMetadata(
                profileID: profileID,
                root: capability, afterID: afterID, limit: limit)
            let merged = (legacy + staged).sorted { $0.id < $1.id }
            guard Set(merged.map(\.id)).count == merged.count else {
                throw VaultStageError.corruptStage
            }
            return Array(merged.prefix(Int(limit)))
        }
    }

    func openDisplacedSnapshot(profileID: String, root: URL, id: String) throws
        -> VaultSnapshotReceipt
    {
        try state.withLock { value in
            try requireOpen(value)
            let capability = try VaultDirectory(url: root)
            if try value.legacy.owns(profileID: profileID, id: id, root: capability) {
                return try value.legacy.snapshot(
                    profileID: profileID, id: id, root: capability, snapshots: value.snapshots)
            }
            return try value.exchanges.displacedSnapshot(
                profileID: profileID, id: id,
                root: capability, snapshots: value.snapshots)
        }
    }

    func acknowledgeDisplaced(profileID: String, root: URL, id: String) throws {
        try state.withLock { value in
            try requireOpen(value)
            let capability = try VaultDirectory(url: root)
            if try value.legacy.owns(profileID: profileID, id: id, root: capability) {
                try value.legacy.acknowledge(profileID: profileID, id: id, root: capability)
                return
            }
            try value.exchanges.acknowledgeDisplaced(
                profileID: profileID, id: id,
                root: capability)
        }
    }

    func discard(profileID: String, root: URL, id: String) throws {
        try state.withLock { value in
            try requireOpen(value)
            try value.exchanges.discard(
                profileID: profileID, id: id, root: VaultDirectory(url: root))
        }
    }

    func close() throws {
        try state.withLock { value in
            value.closed = true
            defer { value.signer.retire() }
            var first: (any Error)?
            do { try value.snapshots.retire() } catch { first = error }
            do { try value.lease.releaseLease() } catch { if first == nil { first = error } }
            if let first { throw first }
        }
    }

    private func requireOpen(_ value: borrowing State) throws {
        guard !value.closed else { throw VaultSnapshotError.invalidHandle }
    }
}
