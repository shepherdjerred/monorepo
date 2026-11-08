import Darwin
import Foundation

internal enum VaultExchangeBoundary { case prepared, beforeExchange, exchanged, captured }

/// All methods run under the owning callback mutex. A prepared slot inode is
/// the crash phase proof, including swaps whose old and new hashes are equal.
internal final class VaultStagedExchanges {
    let stages: VaultReplacementStages
    let journal: VaultExchangeJournal
    private let fault: (VaultExchangeBoundary) throws -> Void

    init(
        stages: VaultReplacementStages, journal: VaultExchangeJournal,
        fault: @escaping (VaultExchangeBoundary) throws -> Void = { _ in }
    ) {
        self.stages = stages
        self.journal = journal
        self.fault = fault
    }

    func exchange(_ request: VaultExchangeRequest, root: VaultDirectory) throws
        -> VaultStagedOutcome
    {
        try validate(request)
        var record = try journal.begin(request)
        if let outcome = record.outcome { return try replay(outcome, request: request) }
        let (parent, name) = try root.parent(request.path, create: request.stageID != nil)
        let recovery = try root.directory(
            ".facet-recovery/" + VaultHandleSigner.digest(request.profileID) + "/bounded",
            create: true)
        try root.synchronize()
        if record.preparation == nil {
            let existing = try parent.openFile(name)?.fingerprint()
            guard existing?.revision == request.expectedRevision else {
                return try finish(
                    &record, outcome: VaultStagedOutcome(applied: false, displaced: nil))
            }
            if existing == nil && request.stageID == nil {
                return try finish(
                    &record, outcome: VaultStagedOutcome(applied: true, displaced: nil))
            }
            record.preparation = VaultExchangePreparation(
                backupID: UUID().uuidString.lowercased(), hadExisting: existing != nil,
                ready: false)
            try journal.save(record)
        }
        if record.preparation?.ready == false { try prepare(&record, recovery: recovery) }
        guard let prepared = record.preparation else { throw VaultStageError.corruptStage }
        // Publish the phase proof before effects even if a previous mirror
        // update failed after its private journal commit.
        try recovery.replaceMetadata(
            prepared.backupID + ".prepared", bytes: JSONEncoder().encode(record))
        if try exchanged(request, preparation: prepared, root: root, recovery: recovery) {
            try parent.synchronize()
            try recovery.synchronize()
            return try finishCaptured(&record, recovery: recovery)
        }
        guard try parent.openFile(name)?.fingerprint().revision == request.expectedRevision else {
            return try finish(&record, outcome: VaultStagedOutcome(applied: false, displaced: nil))
        }
        try fault(.beforeExchange)
        do {
            try perform(
                request, preparation: prepared, recovery: recovery, parent: parent, name: name)
        } catch let error as POSIXError where error.code == .EEXIST || error.code == .ENOENT {
            return try finish(&record, outcome: VaultStagedOutcome(applied: false, displaced: nil))
        }
        try recovery.synchronize()
        try parent.synchronize()
        try fault(.exchanged)
        return try finishCaptured(&record, recovery: recovery)
    }

    func persistedOutcome(_ request: VaultExchangeRequest) throws -> VaultStagedOutcome? {
        try validate(request)
        guard let outcome = try journal.existing(request)?.outcome else { return nil }
        return try replay(outcome, request: request)
    }

    private func validate(_ request: VaultExchangeRequest) throws {
        try VaultRelativePath.validate(request.path)
        guard !request.profileID.isEmpty,
            request.expectedRevision == nil
                || request.expectedRevision.map(VaultRelativePath.isRevision) == true
        else { throw AppleVaultError.invalidPath }
        if let id = request.stageID {
            let intent = try stages.intent(profileID: request.profileID, id: id)
            guard intent.profileID == request.profileID, intent.operationID == request.operationID,
                intent.path == request.path, intent.expectedRevision == request.expectedRevision
            else { throw VaultStageError.changedIntent }
        }
    }

    private func prepare(_ record: inout VaultExchangeRecord, recovery: VaultDirectory) throws {
        guard var prepared = record.preparation, !prepared.ready else {
            throw VaultStageError.corruptStage
        }
        if let stage = record.request.stageID {
            // No exchange can occur before ready is durable, so this private
            // partial copy is safe to replace on a preparation retry.
            try recovery.remove(prepared.backupID + ".bytes")
            guard
                let slot = try recovery.openFile(
                    prepared.backupID + ".bytes", writable: true, createNew: true)
            else { throw VaultStageError.corruptStage }
            _ = try stages.copySealed(
                profileID: record.request.profileID, id: stage, destination: slot)
            prepared.slotIdentity = try slot.identity()
        }
        try recovery.synchronize()
        prepared.ready = true
        record.preparation = prepared
        try journal.save(record)
        try recovery.replaceMetadata(
            prepared.backupID + ".prepared", bytes: JSONEncoder().encode(record))
        try fault(.prepared)
    }

    func exchanged(
        _ request: VaultExchangeRequest, preparation: VaultExchangePreparation,
        root: VaultDirectory, recovery: VaultDirectory
    ) throws -> Bool {
        let slot = try recovery.openFile(preparation.backupID + ".bytes")
        if request.stageID == nil { return slot != nil }
        if !preparation.hadExisting {
            if slot != nil { return false }
            let (parent, name) = try root.parent(request.path)
            guard try parent.openFile(name)?.identity() == preparation.slotIdentity else {
                throw VaultStageError.corruptStage
            }
            return true
        }
        guard let slot else { throw VaultStageError.corruptStage }
        return try slot.identity() != preparation.slotIdentity
    }

    private func perform(
        _ request: VaultExchangeRequest, preparation: VaultExchangePreparation,
        recovery: VaultDirectory, parent: VaultDirectory, name: String
    ) throws {
        let slot = preparation.backupID + ".bytes"
        if request.stageID == nil {
            try parent.rename(name, to: recovery, name: slot, flags: UInt32(RENAME_EXCL))
        } else if let stage = request.stageID {
            guard let image = try recovery.openFile(slot) else {
                throw VaultStageError.corruptStage
            }
            let intent = try stages.intent(profileID: request.profileID, id: stage)
            let actual = try image.fingerprint()
            guard try image.identity() == preparation.slotIdentity,
                actual.size == intent.size, actual.revision == intent.revision
            else { throw VaultStageError.corruptStage }
            let flags = preparation.hadExisting ? UInt32(RENAME_SWAP) : UInt32(RENAME_EXCL)
            try recovery.rename(slot, to: parent, name: name, flags: flags)
        }
    }

    func finishCaptured(_ record: inout VaultExchangeRecord, recovery: VaultDirectory)
        throws
        -> VaultStagedOutcome
    {
        guard let prepared = record.preparation else { throw VaultStageError.corruptStage }
        let displaced: VaultCapturedPredecessor?
        if prepared.hadExisting {
            guard let file = try recovery.openFile(prepared.backupID + ".bytes") else {
                throw VaultStageError.corruptStage
            }
            try file.synchronize()
            let captured = try file.fingerprint()
            displaced = VaultCapturedPredecessor(
                id: prepared.backupID, path: record.request.path,
                size: captured.size, revision: captured.revision)
            try recovery.replaceMetadata(
                prepared.backupID + ".json", bytes: JSONEncoder().encode(displaced))
        } else {
            displaced = nil
        }
        try fault(.captured)
        return try finish(&record, outcome: VaultStagedOutcome(applied: true, displaced: displaced))
    }

    private func finish(_ record: inout VaultExchangeRecord, outcome: VaultStagedOutcome) throws
        -> VaultStagedOutcome
    {
        record.outcome = outcome
        try journal.save(record)
        return try replay(outcome, request: record.request)
    }

    private func replay(_ outcome: VaultStagedOutcome, request: VaultExchangeRequest) throws
        -> VaultStagedOutcome
    {
        if let stage = request.stageID {
            try stages.recordOutcome(profileID: request.profileID, id: stage, outcome: outcome)
        }
        return outcome
    }
}
