import Foundation
import TaskNotesUniFFI

/// Translates bounded native capabilities into the generated host contract.
internal final class FacetVaultAdapter: FacetVaultFiles {
    private let files: AppleVaultFiles
    init(files: AppleVaultFiles) { self.files = files }

    func listFiles(profileId: String) throws -> [String] {
        try boundary { try files.listFiles(profileID: profileId) }
    }

    func openFileSnapshot(profileId: String, path: String) throws -> FacetFileSnapshot? {
        try boundary {
            try files.openFileSnapshot(profileID: profileId, path: path).map(snapshot)
        }
    }

    func openDisplacedSnapshot(profileId: String, backupId: String) throws -> FacetFileSnapshot {
        try boundary {
            snapshot(try files.openDisplacedSnapshot(profileID: profileId, id: backupId))
        }
    }

    func readSnapshotChunk(profileId: String, snapshotId: String, offset: UInt64, length: UInt32)
        throws -> Data
    {
        try boundary {
            try files.readSnapshotChunk(
                profileID: profileId, id: snapshotId, offset: offset, length: length)
        }
    }

    func closeSnapshot(profileId: String, snapshotId: String) throws {
        try boundary { try files.closeSnapshot(profileID: profileId, id: snapshotId) }
    }

    func beginReplacement(
        profileId: String, operationId: String, path: String, expectedRevision: String? = nil,
        size: UInt64, revision: String
    ) throws -> FacetReplacementStage {
        try boundary {
            stage(
                try files.beginReplacement(
                    VaultStageIntent(
                        profileID: profileId, operationID: operationId, path: path,
                        expectedRevision: expectedRevision, size: size, revision: revision)))
        }
    }

    func writeReplacementChunk(profileId: String, stageId: String, offset: UInt64, bytes: Data)
        throws -> FacetReplacementStage
    {
        try boundary {
            stage(
                try files.writeReplacementChunk(
                    profileID: profileId, id: stageId, offset: offset, bytes: bytes))
        }
    }

    func sealReplacement(profileId: String, stageId: String) throws -> FacetReplacementStage {
        try boundary { stage(try files.sealReplacement(profileID: profileId, id: stageId)) }
    }

    func compareExchangeStaged(
        profileId: String, operationId: String, path: String, expectedRevision: String?,
        stageId: String?
    ) throws -> FacetStagedExchange {
        try boundary {
            let outcome = try files.compareExchangeStaged(
                VaultExchangeRequest(
                    profileID: profileId, operationID: operationId, path: path,
                    expectedRevision: expectedRevision, stageID: stageId))
            return FacetStagedExchange(
                applied: outcome.applied, displaced: outcome.displaced.map(displaced))
        }
    }

    func discardReplacement(profileId: String, stageId: String) throws {
        try boundary { try files.discardReplacement(profileID: profileId, id: stageId) }
    }

    func displacedMetadata(profileId: String, afterId: String?, limit: UInt32) throws
        -> [FacetDisplacedMetadata]
    {
        try boundary {
            try files.boundedDisplacedMetadata(profileID: profileId, afterID: afterId, limit: limit)
                .map(displaced)
        }
    }

    func acknowledgeDisplaced(profileId: String, id: String) throws {
        try boundary { try files.acknowledgeBoundedDisplaced(profileID: profileId, id: id) }
    }

    private func snapshot(_ value: VaultSnapshotReceipt) -> FacetFileSnapshot {
        FacetFileSnapshot(id: value.id, size: value.size, revision: value.revision)
    }

    private func stage(_ value: VaultStageReceipt) -> FacetReplacementStage {
        FacetReplacementStage(
            id: value.id, operationId: value.operationID, path: value.path,
            size: value.size, revision: value.revision, written: value.written, sealed: value.sealed
        )
    }

    private func displaced(_ value: VaultCapturedPredecessor) -> FacetDisplacedMetadata {
        FacetDisplacedMetadata(
            id: value.id, path: value.path, size: value.size, revision: value.revision)
    }

    private func boundary<Value>(_ operation: () throws -> Value) throws -> Value {
        do { return try operation() } catch let failure as AppleVaultError {
            switch failure {
            case .missingPermission, .expiredPermission:
                throw FacetHostError.PermissionDenied(detail: failure.localizedDescription)
            case .invalidPath:
                throw FacetHostError.Contract(
                    detail: "The host rejected an invalid bounded file capability.")
            case .invalidDirectory, .symbolicLink, .enumerationFailed, .coordinationFailed:
                throw FacetHostError.Unavailable(detail: failure.localizedDescription)
            }
        } catch is VaultStageError {
            throw FacetHostError.Contract(
                detail:
                    "Private replacement metadata or its immutable operation proof is inconsistent. "
                    + "Retained vault bytes were preserved."
            )
        } catch is VaultSnapshotError {
            throw FacetHostError.Contract(
                detail:
                    "The bounded snapshot owner or range does not match its retained capability.")
        } catch is POSIXError {
            throw FacetHostError.Io(
                detail: "The vault provider could not complete its durable file operation.")
        } catch {
            throw FacetHostError.Contract(
                detail:
                    "The bounded file host encountered an unexpected internal contract failure. "
                    + "Retained vault bytes were preserved."
            )
        }
    }
}
