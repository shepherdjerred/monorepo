import Foundation

internal struct VaultStageIntent: Codable, Equatable {
    let profileID: String
    let operationID: String
    let path: String
    let expectedRevision: String?
    let size: UInt64
    let revision: String
}

internal struct VaultStageReceipt: Codable, Equatable {
    let id: String
    let operationID: String
    let path: String
    let size: UInt64
    let revision: String
    var written: UInt64
    var sealed: Bool
}

internal struct VaultStageManifest: Codable {
    let schemaVersion: UInt32
    let engineIdentity: String
    let intent: VaultStageIntent
    var stage: VaultStageReceipt
    var discarded: Bool
    var outcome: VaultStagedOutcome?
}

internal struct VaultCapturedPredecessor: Codable, Equatable {
    let id: String
    let path: String
    let size: UInt64
    let revision: String
}

internal struct VaultStagedOutcome: Codable, Equatable {
    let applied: Bool
    let displaced: VaultCapturedPredecessor?
}

/// Durable contiguous-prefix staging. A retained sealed source is never exposed
/// as a writable vault inode. The callback owner serializes access to this store.
internal final class VaultReplacementStages {
    private struct Owned {
        let folder: VaultDirectory
        let name: String
        let manifest: VaultStageManifest
    }
    private let directory: VaultDirectory
    private let signer: VaultHandleSigner

    init(directory: VaultDirectory, signer: VaultHandleSigner) {
        self.directory = directory
        self.signer = signer
    }

    func begin(_ intent: VaultStageIntent) throws -> VaultStageReceipt {
        try validate(intent)
        let id = try signer.stage(profileID: intent.profileID, operationID: intent.operationID)
        let name = try signer.stageName(profileID: intent.profileID, id: id)
        let folder = try profile(intent.profileID, create: true)
        if let existing = try load(folder, name: name) {
            guard existing.intent == intent else {
                throw VaultStageError.changedIntent
            }
            if existing.discarded { return existing.stage }
            return try reconcile(existing, folder: folder, name: name).stage
        }
        guard try folder.openFile(name + ".image") == nil else {
            throw VaultStageError.corruptStage
        }
        let receipt = VaultStageReceipt(
            id: id, operationID: intent.operationID, path: intent.path, size: intent.size,
            revision: intent.revision, written: 0, sealed: false)
        let manifest = VaultStageManifest(
            schemaVersion: 1, engineIdentity: signer.engineIdentity, intent: intent, stage: receipt,
            discarded: false)
        try folder.writeNewAtomic(name + ".json", bytes: JSONEncoder().encode(manifest))
        return try reconcile(manifest, folder: folder, name: name).stage
    }

    func write(profileID: String, id: String, offset: UInt64, bytes: Data) throws
        -> VaultStageReceipt
    {
        let owned = try owned(profileID: profileID, id: id)
        let folder = owned.folder
        let name = owned.name
        var manifest = try reconcile(owned.manifest, folder: folder, name: name)
        let written = manifest.stage.written
        guard bytes.count <= VaultFile.maximumChunk, offset <= written,
            UInt64(bytes.count) <= manifest.stage.size - offset
        else { throw VaultStageError.invalidChunk }
        guard let image = try folder.openFile(name + ".image", writable: !manifest.stage.sealed)
        else {
            throw VaultStageError.corruptStage
        }
        if offset < written || manifest.stage.sealed || bytes.isEmpty {
            guard UInt64(bytes.count) <= written - offset,
                try image.read(offset: offset, length: bytes.count) == bytes
            else { throw VaultStageError.changedIntent }
            return manifest.stage
        }
        try image.write(offset: offset, bytes: bytes)
        manifest.stage.written += UInt64(bytes.count)
        try save(manifest, folder: folder, name: name)
        return manifest.stage
    }

    func seal(profileID: String, id: String) throws -> VaultStageReceipt {
        let owned = try owned(profileID: profileID, id: id)
        let folder = owned.folder
        let name = owned.name
        var manifest = try reconcile(owned.manifest, folder: folder, name: name)
        guard manifest.stage.written == manifest.stage.size,
            let image = try folder.openFile(name + ".image")
        else { throw VaultStageError.invalidChunk }
        let actual = try image.fingerprint()
        guard actual.size == manifest.stage.size, actual.revision == manifest.stage.revision else {
            throw VaultStageError.changedIntent
        }
        try image.synchronize()
        manifest.stage.sealed = true
        try save(manifest, folder: folder, name: name)
        return manifest.stage
    }

    func copySealed(profileID: String, id: String, destination: VaultFile) throws
        -> VaultStageReceipt
    {
        let owned = try owned(profileID: profileID, id: id)
        let manifest = owned.manifest
        guard manifest.stage.sealed,
            let image = try owned.folder.openFile(owned.name + ".image")
        else { throw VaultStageError.invalidChunk }
        let actual = try image.copy(to: destination)
        guard actual.size == manifest.stage.size, actual.revision == manifest.stage.revision else {
            throw VaultStageError.changedIntent
        }
        return manifest.stage
    }

    func outcome(profileID: String, id: String) throws -> VaultStagedOutcome? {
        try owned(profileID: profileID, id: id, allowDiscarded: true).manifest.outcome
    }

    func intent(profileID: String, id: String) throws -> VaultStageIntent {
        try owned(profileID: profileID, id: id, allowDiscarded: true).manifest.intent
    }

    func recordOutcome(profileID: String, id: String, outcome: VaultStagedOutcome) throws {
        let owned = try owned(profileID: profileID, id: id, allowDiscarded: true)
        let original = owned.manifest
        if let existing = original.outcome {
            guard existing == outcome else { throw VaultStageError.changedIntent }
            return
        }
        guard !original.discarded, original.stage.sealed else {
            throw VaultStageError.corruptStage
        }
        try validate(outcome, path: original.intent.path)
        var manifest = original
        manifest.outcome = outcome
        try save(manifest, folder: owned.folder, name: owned.name)
    }

    /// Runtime calls only after durable disposition. Retain the small immutable
    /// intent receipt so stale begin/write calls cannot recreate discarded bytes.
    func discard(profileID: String, id: String) throws {
        let owned = try owned(profileID: profileID, id: id, allowDiscarded: true)
        let original = owned.manifest
        if !original.discarded {
            var manifest = original
            manifest.discarded = true
            try save(manifest, folder: owned.folder, name: owned.name)
        }
        try owned.folder.remove(owned.name + ".image")
        try owned.folder.synchronize()
    }

    private func owned(profileID: String, id: String, allowDiscarded: Bool = false) throws
        -> Owned
    {
        let name = try signer.stageName(profileID: profileID, id: id)
        let folder = try profile(profileID, create: false)
        guard let manifest = try load(folder, name: name), manifest.stage.id == id,
            manifest.intent.profileID == profileID, allowDiscarded || !manifest.discarded
        else { throw VaultStageError.corruptStage }
        return Owned(folder: folder, name: name, manifest: manifest)
    }

    private func reconcile(_ original: VaultStageManifest, folder: VaultDirectory, name: String)
        throws
        -> VaultStageManifest
    {
        guard !original.discarded else { throw VaultStageError.corruptStage }
        let image: VaultFile
        if let existing = try folder.openFile(name + ".image", writable: !original.stage.sealed) {
            image = existing
        } else {
            guard original.stage.written == 0, !original.stage.sealed, original.outcome == nil,
                let created = try folder.openFile(name + ".image", writable: true, createNew: true)
            else { throw VaultStageError.corruptStage }
            try created.synchronize()
            try folder.synchronize()
            image = created
        }
        let length = try image.size()
        guard length >= original.stage.written else { throw VaultStageError.corruptStage }
        if original.stage.sealed {
            guard length == original.stage.size else { throw VaultStageError.corruptStage }
        } else if length > original.stage.written {
            try image.truncate(to: original.stage.written)
        }
        return original
    }

    private func profile(_ id: String, create: Bool) throws -> VaultDirectory {
        let result = try directory.directory(VaultHandleSigner.digest(id), create: create)
        if create { try directory.synchronize() }
        return result
    }

    private func save(_ manifest: VaultStageManifest, folder: VaultDirectory, name: String) throws {
        try folder.replaceMetadata(name + ".json", bytes: JSONEncoder().encode(manifest))
    }

    private func load(_ folder: VaultDirectory, name: String) throws -> VaultStageManifest? {
        guard let file = try folder.openFile(name + ".json") else { return nil }
        let size = try file.size()
        guard size <= 16_384 else { throw VaultStageError.corruptStage }
        let bytes = try file.read(offset: 0, length: Int(size))
        try validateShape(bytes)
        let manifest = try JSONDecoder().decode(VaultStageManifest.self, from: bytes)
        try validate(manifest.intent)
        guard manifest.schemaVersion == 1, manifest.engineIdentity == signer.engineIdentity,
            manifest.stage.written <= manifest.stage.size,
            manifest.stage.size == manifest.intent.size,
            manifest.stage.revision == manifest.intent.revision,
            manifest.stage.operationID == manifest.intent.operationID,
            manifest.stage.path == manifest.intent.path,
            try signer.stage(
                profileID: manifest.intent.profileID, operationID: manifest.intent.operationID)
                == manifest.stage.id
        else { throw VaultStageError.corruptStage }
        if let outcome = manifest.outcome { try validate(outcome, path: manifest.intent.path) }
        return manifest
    }

    private func validateShape(_ bytes: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            Set(object.keys).isSubset(of: [
                "schemaVersion", "engineIdentity", "intent", "stage", "discarded", "outcome",
            ]),
            let intent = object["intent"] as? [String: Any],
            Set(intent.keys).isSubset(of: [
                "profileID", "operationID", "path", "expectedRevision", "size", "revision",
            ]),
            let stage = object["stage"] as? [String: Any],
            Set(stage.keys) == [
                "id", "operationID", "path", "size", "revision", "written", "sealed",
            ]
        else { throw VaultStageError.corruptStage }
        if let outcome = object["outcome"], !(outcome is NSNull) {
            guard let fields = outcome as? [String: Any],
                Set(fields.keys).isSubset(of: ["applied", "displaced"])
            else { throw VaultStageError.corruptStage }
            if let displaced = fields["displaced"], !(displaced is NSNull) {
                guard let record = displaced as? [String: Any],
                    Set(record.keys) == ["id", "path", "size", "revision"]
                else { throw VaultStageError.corruptStage }
            }
        }
    }

    private func validate(_ outcome: VaultStagedOutcome, path: String) throws {
        if let displaced = outcome.displaced {
            guard outcome.applied, displaced.path == path, UUID(uuidString: displaced.id) != nil,
                isRevision(displaced.revision), displaced.size <= UInt64(Int64.max)
            else { throw VaultStageError.corruptStage }
        }
    }

    private func validate(_ intent: VaultStageIntent) throws {
        try VaultRelativePath.validate(intent.path)
        guard !intent.profileID.isEmpty,
            intent.size <= UInt64(Int64.max), isRevision(intent.revision),
            intent.expectedRevision == nil || intent.expectedRevision.map(isRevision) == true
        else { throw VaultStageError.changedIntent }
    }

    private func isRevision(_ value: String) -> Bool {
        value.utf8.count == 64
            && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

internal enum VaultStageError: Error {
    case changedIntent, corruptStage, invalidChunk
}
