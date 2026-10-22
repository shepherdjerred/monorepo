import Foundation

private struct VaultLegacyAcknowledgment: Codable {
    let schemaVersion: UInt32
    let engineIdentity: String
    let profileID: String
    let id: String
}

/// Preserve the original 61-era capture IDs and bytes. Legacy metadata is
/// never promoted into a staged-exchange outcome or an invented inode proof.
internal final class VaultLegacyRecovery {
    private let directory: VaultDirectory
    private let engineIdentity: String
    private let afterAcknowledgment: () throws -> Void

    init(
        directory: VaultDirectory, engineIdentity: String,
        afterAcknowledgment: @escaping () throws -> Void = {}
    ) {
        self.directory = directory
        self.engineIdentity = engineIdentity
        self.afterAcknowledgment = afterAcknowledgment
    }

    func metadata(profileID: String, root: VaultDirectory, afterID: String?, limit: UInt32) throws
        -> [VaultCapturedPredecessor]
    {
        try validatePage(afterID: afterID, limit: limit)
        guard let recovery = try recovery(root, profileID: profileID) else { return [] }
        var result: [VaultCapturedPredecessor] = []
        for filename in try recovery.entries() where filename.hasSuffix(".json") {
            let id = String(filename.dropLast(5))
            try validateID(id)
            guard id > (afterID ?? "") else { continue }
            if result.count == Int(limit) { break }
            if try acknowledged(profileID: profileID, id: id) { continue }
            result.append(
                try retained(profileID: profileID, id: id, root: root, recovery: recovery))
        }
        return result
    }

    func owns(profileID: String, id: String, root: VaultDirectory) throws -> Bool {
        try validateID(id)
        if try acknowledged(profileID: profileID, id: id) { return true }
        return try recovery(root, profileID: profileID)?.openFile(id + ".json") != nil
    }

    func snapshot(profileID: String, id: String, root: VaultDirectory, snapshots: VaultSnapshots)
        throws -> VaultSnapshotReceipt
    {
        guard try !acknowledged(profileID: profileID, id: id),
            let recovery = try recovery(root, profileID: profileID)
        else { throw AppleVaultError.coordinationFailed }
        let capture = try retained(profileID: profileID, id: id, root: root, recovery: recovery)
        guard let source = try recovery.openFile(id + ".bytes") else {
            throw AppleVaultError.coordinationFailed
        }
        return try snapshots.open(
            profileID: profileID, source: source,
            expected: VaultFileFingerprint(size: capture.size, revision: capture.revision))
    }

    func acknowledge(profileID: String, id: String, root: VaultDirectory) throws {
        try validateID(id)
        if try !acknowledged(profileID: profileID, id: id) {
            guard let recovery = try recovery(root, profileID: profileID) else {
                throw AppleVaultError.coordinationFailed
            }
            _ = try retained(profileID: profileID, id: id, root: root, recovery: recovery)
            let folder = try acknowledgments(profileID: profileID, create: true)
            guard let folder else { throw AppleVaultError.coordinationFailed }
            try folder.writeNewAtomic(
                id + ".json",
                bytes: JSONEncoder().encode(
                    VaultLegacyAcknowledgment(
                        schemaVersion: 1, engineIdentity: engineIdentity,
                        profileID: profileID, id: id)))
        }
        // The owned disposition is durable before every unlink. Reopening can
        // finish either cleanup edge without reinterpreting absent user bytes.
        try afterAcknowledgment()
        if let recovery = try recovery(root, profileID: profileID) {
            for suffix in [".bytes", ".json"] { try recovery.remove(id + suffix) }
            try recovery.synchronize()
        }
    }

    private func retained(
        profileID: String, id: String, root: VaultDirectory, recovery: VaultDirectory
    ) throws -> VaultCapturedPredecessor {
        try validateID(id)
        let record = try record(recovery: recovery, id: id)
        guard record.id == id else { throw VaultStageError.corruptStage }
        try VaultRelativePath.validate(record.path)
        if let bounded = try optionalDirectory(recovery, path: "bounded"),
            try bounded.openFile(id + ".prepared") != nil
        {
            throw VaultStageError.corruptStage
        }
        guard let capture = try recovery.openFile(id + ".bytes")?.fingerprint() else {
            throw AppleVaultError.coordinationFailed
        }
        if let revision = record.capturedRevision {
            guard revision == capture.revision, record.capturedSize == capture.size else {
                throw VaultStageError.corruptStage
            }
        } else {
            guard record.capturedSize == nil, capture.revision != record.replacementRevision else {
                throw AppleVaultError.coordinationFailed
            }
            var updated = record
            updated.capturedRevision = capture.revision
            updated.capturedSize = capture.size
            try recovery.replaceMetadata(id + ".json", bytes: JSONEncoder().encode(updated))
        }
        return VaultCapturedPredecessor(
            id: id, path: record.path, size: capture.size, revision: capture.revision)
    }

    private func record(recovery: VaultDirectory, id: String) throws -> AppleVaultFiles.Displacement
    {
        let bytes = try boundedRead(recovery, name: id + ".json", maximum: 16_384)
        guard let fields = try FacetJSON.parse(bytes).object?.fields,
            Set(fields.keys).isSubset(of: [
                "id", "path", "replacementRevision", "expectedRevision", "capturedSize",
                "capturedRevision",
            ]), fields["id"] != nil, fields["path"] != nil
        else { throw VaultStageError.corruptStage }
        if let size = fields["capturedSize"], size != .null {
            guard FacetJSONNumbers.isInteger(size),
                let lower = FacetJSONNumbers.compare(size, .integer(0)), lower >= 0,
                let upper = FacetJSONNumbers.compare(size, .unsigned(UInt64.max)), upper <= 0
            else { throw VaultStageError.corruptStage }
        }
        let record = try FacetJSON.decoder(bytes).decode(
            AppleVaultFiles.Displacement.self, from: bytes)
        for revision in [
            record.expectedRevision, record.replacementRevision, record.capturedRevision,
        ] {
            guard revision == nil || revision.map(VaultRelativePath.isRevision) == true else {
                throw VaultStageError.corruptStage
            }
        }
        return record
    }

    private func acknowledged(profileID: String, id: String) throws -> Bool {
        try validateID(id)
        guard let folder = try acknowledgments(profileID: profileID, create: false),
            try folder.openFile(id + ".json") != nil
        else { return false }
        let bytes = try boundedRead(folder, name: id + ".json", maximum: 1_024)
        guard let fields = try FacetJSON.parse(bytes).object?.fields,
            Set(fields.keys) == ["schemaVersion", "engineIdentity", "profileID", "id"],
            let version = fields["schemaVersion"],
            FacetJSONNumbers.compare(version, .integer(1)) == 0
        else { throw VaultStageError.corruptStage }
        let record = try FacetJSON.decoder(bytes).decode(
            VaultLegacyAcknowledgment.self, from: bytes)
        guard record.schemaVersion == 1, record.engineIdentity == engineIdentity,
            record.profileID == profileID, record.id == id
        else { throw VaultStageError.changedIntent }
        return true
    }

    private func acknowledgments(profileID: String, create: Bool) throws -> VaultDirectory? {
        let path = "legacy-ack/" + engineIdentity + "/" + VaultHandleSigner.digest(profileID)
        if create {
            let result = try directory.directory(path, create: true)
            try directory.synchronize()
            return result
        }
        return try optionalDirectory(directory, path: path)
    }

    private func recovery(_ root: VaultDirectory, profileID: String) throws -> VaultDirectory? {
        try optionalDirectory(root, path: ".facet-recovery/" + VaultHandleSigner.digest(profileID))
    }

    private func optionalDirectory(_ root: VaultDirectory, path: String) throws -> VaultDirectory? {
        do { return try root.directory(path) } catch let failure as POSIXError
            where failure.code == .ENOENT
        {
            return nil
        }
    }

    private func boundedRead(_ directory: VaultDirectory, name: String, maximum: UInt64) throws
        -> Data
    {
        guard let file = try directory.openFile(name) else {
            throw VaultStageError.corruptStage
        }
        let size = try file.size()
        guard size <= maximum else { throw VaultStageError.corruptStage }
        let bytes = try file.read(offset: 0, length: Int(size))
        guard bytes.count == Int(size) else { throw VaultStageError.corruptStage }
        return bytes
    }

    private func validatePage(afterID: String?, limit: UInt32) throws {
        guard (1...128).contains(limit) else { throw AppleVaultError.invalidPath }
        if let afterID { try validateID(afterID) }
    }

    private func validateID(_ id: String) throws {
        guard let value = UUID(uuidString: id),
            value.uuidString.caseInsensitiveCompare(id) == .orderedSame
        else { throw AppleVaultError.invalidPath }
    }
}
