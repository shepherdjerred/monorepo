import Foundation

extension VaultStagedExchanges {
    func displacedMetadata(profileID: String, root: VaultDirectory, afterID: String?, limit: UInt32)
        throws -> [VaultCapturedPredecessor]
    {
        guard limit > 0, limit <= 128,
            afterID == nil || afterID.flatMap(UUID.init(uuidString:)) != nil
        else { throw AppleVaultError.invalidPath }
        guard let recovery = try recovery(root, profileID: profileID) else { return [] }
        var result: [VaultCapturedPredecessor] = []
        for name in try recovery.entries() where name.hasSuffix(".prepared") {
            let id = String(name.dropLast(9))
            guard id > (afterID ?? "") else { continue }
            if result.count == Int(limit) { break }
            if let retained = try retained(
                profileID: profileID, id: id, root: root, recovery: recovery)
            {
                result.append(retained)
            }
        }
        return result
    }

    func displacedSnapshot(
        profileID: String, id: String, root: VaultDirectory,
        snapshots: VaultSnapshots
    ) throws -> VaultSnapshotReceipt {
        guard let recovery = try recovery(root, profileID: profileID),
            let metadata = try retained(
                profileID: profileID, id: id, root: root, recovery: recovery),
            let source = try recovery.openFile(id + ".bytes")
        else { throw AppleVaultError.coordinationFailed }
        return try snapshots.open(
            profileID: profileID, source: source,
            expected: VaultFileFingerprint(size: metadata.size, revision: metadata.revision))
    }

    func acknowledgeDisplaced(profileID: String, id: String, root: VaultDirectory) throws {
        guard let recovery = try recovery(root, profileID: profileID) else {
            guard try journal.isAcknowledged(profileID: profileID, id: id) else {
                throw AppleVaultError.coordinationFailed
            }
            return
        }
        if try !journal.isAcknowledged(profileID: profileID, id: id) {
            guard try retained(profileID: profileID, id: id, root: root, recovery: recovery) != nil
            else {
                throw AppleVaultError.coordinationFailed
            }
            // The durable owned tombstone precedes every unlink so cleanup can
            // finish after any crash without reinterpreting a missing slot.
            try journal.acknowledge(profileID: profileID, id: id)
        }
        for suffix in [".bytes", ".json", ".prepared"] { try recovery.remove(id + suffix) }
        try recovery.synchronize()
    }

    func discard(profileID: String, id: String, root: VaultDirectory) throws {
        let intent = try stages.intent(profileID: profileID, id: id)
        let request = VaultExchangeRequest(
            profileID: profileID, operationID: intent.operationID,
            path: intent.path, expectedRevision: intent.expectedRevision, stageID: id)
        var record = try journal.begin(request)
        let recovery = try recovery(root, profileID: profileID)
        if let prepared = record.preparation, prepared.ready, record.outcome == nil,
            let recovery,
            try exchanged(request, preparation: prepared, root: root, recovery: recovery)
        {
            _ = try finishCaptured(&record, recovery: recovery)
        }
        try stages.discard(profileID: profileID, id: id)
        if let prepared = record.preparation, let recovery, record.outcome?.displaced == nil {
            // Only a proven prepared source may be removed. Captured user bytes
            // always remain until explicit acknowledgeDisplaced.
            if let slot = try recovery.openFile(prepared.backupID + ".bytes") {
                guard try slot.identity() == prepared.slotIdentity else {
                    throw VaultStageError.corruptStage
                }
                try recovery.remove(prepared.backupID + ".bytes")
            }
            try recovery.remove(prepared.backupID + ".prepared")
            try recovery.synchronize()
        }
    }

    private func retained(
        profileID: String, id: String, root: VaultDirectory, recovery: VaultDirectory
    ) throws
        -> VaultCapturedPredecessor?
    {
        if try journal.isAcknowledged(profileID: profileID, id: id) { return nil }
        guard let mirror = try recovery.openFile(id + ".prepared") else {
            throw AppleVaultError.coordinationFailed
        }
        let size = try mirror.size()
        guard size <= 16_384 else { throw VaultStageError.corruptStage }
        let original = try journal.decode(mirror.read(offset: 0, length: Int(size)))
        guard original.request.profileID == profileID, original.preparation?.backupID == id,
            original.preparation?.ready == true
        else { throw VaultStageError.corruptStage }
        guard var record = try journal.existing(original.request),
            record.preparation == original.preparation
        else { throw VaultStageError.corruptStage }
        if record.outcome == nil, let prepared = record.preparation,
            try exchanged(record.request, preparation: prepared, root: root, recovery: recovery)
        {
            let (parent, _) = try root.parent(record.request.path)
            try parent.synchronize()
            try recovery.synchronize()
            _ = try finishCaptured(&record, recovery: recovery)
        }
        guard let metadata = record.outcome?.displaced else { return nil }
        guard let file = try recovery.openFile(id + ".bytes"),
            try file.fingerprint()
                == VaultFileFingerprint(size: metadata.size, revision: metadata.revision)
        else { throw VaultStageError.corruptStage }
        return metadata
    }

    private func recovery(_ root: VaultDirectory, profileID: String) throws -> VaultDirectory? {
        do {
            return try root.directory(
                ".facet-recovery/" + VaultHandleSigner.digest(profileID) + "/bounded")
        } catch let error as POSIXError where error.code == .ENOENT { return nil }
    }
}
