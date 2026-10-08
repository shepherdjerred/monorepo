import Foundation

internal struct VaultExchangeRequest: Codable, Equatable {
    let profileID: String
    let operationID: String
    let path: String
    let expectedRevision: String?
    let stageID: String?
}

internal struct VaultExchangePreparation: Codable, Equatable {
    let backupID: String
    let hadExisting: Bool
    var slotIdentity: VaultFileIdentity?
    var ready: Bool
}

internal struct VaultExchangeRecord: Codable {
    let schemaVersion: UInt32
    let engineIdentity: String
    let request: VaultExchangeRequest
    var preparation: VaultExchangePreparation?
    var outcome: VaultStagedOutcome?
}

private struct VaultBackupAcknowledgement: Codable {
    let schemaVersion: UInt32
    let engineIdentity: String
    let profileID: String
    let id: String
}

/// Metadata-only intent/outcome receipts are loaded lazily by immutable operation
/// identity. The user-writable exchange slot remains a separate recovery file.
internal final class VaultExchangeJournal {
    private let directory: VaultDirectory
    private let signer: VaultHandleSigner

    init(directory: VaultDirectory, signer: VaultHandleSigner) {
        self.directory = directory
        self.signer = signer
    }

    func begin(_ request: VaultExchangeRequest) throws -> VaultExchangeRecord {
        if let existing = try existing(request) { return existing }
        let folder = try directory.directory(
            VaultHandleSigner.digest(request.profileID), create: true)
        try directory.synchronize()
        let name = try name(request)
        let record = VaultExchangeRecord(
            schemaVersion: 1, engineIdentity: signer.engineIdentity, request: request)
        try folder.writeNewAtomic(name, bytes: JSONEncoder().encode(record))
        return record
    }

    func existing(_ request: VaultExchangeRequest) throws -> VaultExchangeRecord? {
        let filename = try name(request)
        let folder: VaultDirectory
        do {
            folder = try directory.directory(VaultHandleSigner.digest(request.profileID))
        } catch let error as POSIXError where error.code == .ENOENT { return nil }
        guard let file = try folder.openFile(filename) else { return nil }
        let size = try file.size()
        guard size <= 16_384 else { throw VaultStageError.corruptStage }
        let record = try decode(file.read(offset: 0, length: Int(size)))
        guard record.request == request else { throw VaultStageError.changedIntent }
        return record
    }

    func save(_ record: VaultExchangeRecord) throws {
        let folder = try directory.directory(VaultHandleSigner.digest(record.request.profileID))
        try folder.replaceMetadata(try name(record.request), bytes: JSONEncoder().encode(record))
    }

    func decode(_ bytes: Data) throws -> VaultExchangeRecord {
        guard bytes.count <= 16_384 else { throw VaultStageError.corruptStage }
        try validateShape(bytes)
        let record = try JSONDecoder().decode(VaultExchangeRecord.self, from: bytes)
        guard record.schemaVersion == 1, record.engineIdentity == signer.engineIdentity,
            !record.request.profileID.isEmpty
        else { throw VaultStageError.changedIntent }
        try VaultRelativePath.validate(record.request.path)
        _ = try name(record.request)
        if let prepared = record.preparation {
            try validateBackupID(prepared.backupID)
            guard
                !prepared.ready || (record.request.stageID == nil) == (prepared.slotIdentity == nil)
            else { throw VaultStageError.corruptStage }
        }
        if let captured = record.outcome?.displaced {
            guard record.outcome?.applied == true, captured.path == record.request.path,
                record.preparation?.backupID == captured.id,
                VaultRelativePath.isRevision(captured.revision), captured.size <= UInt64(Int64.max)
            else { throw VaultStageError.corruptStage }
        }
        return record
    }

    func isAcknowledged(profileID: String, id: String) throws -> Bool {
        try validateBackupID(id)
        let folder = try directory.directory(VaultHandleSigner.digest(profileID), create: true)
        guard let file = try folder.openFile(id + ".ack.json") else { return false }
        let size = try file.size()
        guard size <= 1_024 else { throw VaultStageError.corruptStage }
        let bytes = try file.read(offset: 0, length: Int(size))
        guard let fields = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            Set(fields.keys) == ["schemaVersion", "engineIdentity", "profileID", "id"]
        else { throw VaultStageError.corruptStage }
        let record = try JSONDecoder().decode(VaultBackupAcknowledgement.self, from: bytes)
        guard record.schemaVersion == 1, record.engineIdentity == signer.engineIdentity,
            record.profileID == profileID, record.id == id
        else { throw VaultStageError.changedIntent }
        return true
    }

    func acknowledge(profileID: String, id: String) throws {
        if try isAcknowledged(profileID: profileID, id: id) { return }
        let folder = try directory.directory(VaultHandleSigner.digest(profileID))
        try folder.writeNewAtomic(
            id + ".ack.json",
            bytes: JSONEncoder().encode(
                VaultBackupAcknowledgement(
                    schemaVersion: 1, engineIdentity: signer.engineIdentity,
                    profileID: profileID, id: id)))
    }

    private func validateBackupID(_ id: String) throws {
        guard UUID(uuidString: id)?.uuidString.lowercased() == id else {
            throw AppleVaultError.invalidPath
        }
    }

    private func name(_ request: VaultExchangeRequest) throws -> String {
        let token = try signer.stage(profileID: request.profileID, operationID: request.operationID)
        return try signer.stageName(profileID: request.profileID, id: token) + ".exchange.json"
    }

    private func validateShape(_ bytes: Data) throws {
        guard let fields = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            Set(fields.keys).isSubset(of: [
                "schemaVersion", "engineIdentity", "request", "preparation", "outcome",
            ]),
            let request = fields["request"] as? [String: Any],
            Set(request.keys).isSubset(of: [
                "profileID", "operationID", "path", "expectedRevision", "stageID",
            ])
        else { throw VaultStageError.corruptStage }
        try keys(
            fields["preparation"], allowed: ["backupID", "hadExisting", "slotIdentity", "ready"])
        if let prepared = fields["preparation"] as? [String: Any] {
            try keys(prepared["slotIdentity"], allowed: ["device", "inode"])
        }
        try keys(fields["outcome"], allowed: ["applied", "displaced"])
        if let outcome = fields["outcome"] as? [String: Any] {
            try keys(outcome["displaced"], allowed: ["id", "path", "size", "revision"])
        }
    }

    private func keys(_ value: Any?, allowed: Set<String>) throws {
        guard let value, !(value is NSNull) else { return }
        guard let fields = value as? [String: Any], Set(fields.keys).isSubset(of: allowed) else {
            throw VaultStageError.corruptStage
        }
    }
}
