import Foundation
import TaskNotesUniFFI

/// Retains exact admitted transfers until their durable completion barrier accepts.
extension FacetObsidianSession {
    internal struct PendingDownload {
        let uid: UInt64
        let transferID: String
        var applied = false
    }

    internal struct PendingMetadataCompletion {
        let uid: UInt64
        let directory: (path: String, deleted: Bool)?
        var applied = false
    }

    internal func noticeOwned(_ json: String, nowMs: UInt64) async throws -> [ObsidianSessionEffect]
    {
        let file = try FacetJSON.parse(Data(json.utf8))
        guard let fields = file.object?.fields, let uid = fields["uid"].flatMap(Self.unsigned),
            uid > 0, case .bool(let selected) = fields["selected"],
            case .bool(let folder) = fields["folder"], case .bool(let deleted) = fields["deleted"]
        else { throw FacetContractError.unsupportedResponse }
        if let previous = metadata[uid], previous != file {
            throw FacetContractError.unsupportedResponse
        }
        metadata[uid] = file
        if !selected {
            retainMetadataCompletion(uid: uid, directory: nil)
            return try await drainMetadataCompletions()
        }
        if folder {
            guard let path = fields["path"]?.text else {
                throw FacetContractError.unsupportedResponse
            }
            retainMetadataCompletion(uid: uid, directory: (path, deleted))
            return try await drainMetadataCompletions()
        }
        // Regular-file tombstones follow the same owned download path.
        return try core.queueDownload(uid: uid, nowMs: nowMs)
    }

    private func retainMetadataCompletion(
        uid: UInt64, directory: (path: String, deleted: Bool)?
    ) {
        guard !pendingMetadata.contains(where: { $0.uid == uid }) else { return }
        pendingMetadata.append(PendingMetadataCompletion(uid: uid, directory: directory))
    }

    internal func drainMetadataCompletions() async throws -> [ObsidianSessionEffect] {
        var effects: [ObsidianSessionEffect] = []
        while let pending = pendingMetadata.first {
            try _Concurrency.Task.checkCancellation()
            guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
            do {
                if !pending.applied {
                    if let directory = pending.directory {
                        try await engine.remoteDirectory(
                            profileID: profileID, path: directory.path, deleted: directory.deleted)
                    }
                    pendingMetadata[0].applied = true
                }
                guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
                let completed = try core.completeRemote(uid: pending.uid)
                metadata.removeValue(forKey: pending.uid)
                pendingMetadata.removeFirst()
                effects.append(contentsOf: completed)
            } catch FacetEngineError.Busy {
                return effects
            } catch ObsidianBoundaryError.Busy {
                return effects
            }
        }
        return effects
    }

    internal func retainOwnedDownload(uid: UInt64, transferID: String) async throws
        -> [ObsidianSessionEffect]
    {
        guard metadata[uid] != nil else { throw FacetContractError.unsupportedResponse }
        if let pending = pendingDownloads.first(where: { $0.uid == uid }) {
            guard pending.transferID == transferID else {
                throw FacetContractError.unsupportedResponse
            }
        } else {
            pendingDownloads.append(PendingDownload(uid: uid, transferID: transferID))
        }
        return try await drainOwnedDownloads()
    }

    internal func drainOwnedDownloads() async throws -> [ObsidianSessionEffect] {
        var effects: [ObsidianSessionEffect] = []
        while let pending = pendingDownloads.first {
            try _Concurrency.Task.checkCancellation()
            guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
            do {
                if !pending.applied {
                    try await engine.applyOwnedDownload(
                        session: core, transferID: pending.transferID)
                    pendingDownloads[0].applied = true
                }
                guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
                let completed = try core.completeRemote(uid: pending.uid)
                metadata.removeValue(forKey: pending.uid)
                pendingDownloads.removeFirst()
                dirty = true
                effects.append(contentsOf: completed)
            } catch FacetEngineError.Busy {
                return effects
            } catch ObsidianBoundaryError.Busy {
                return effects
            }
        }
        return effects
    }

    internal func uploadPendingOwned() async throws {
        guard pendingDownloads.isEmpty, pendingMetadata.isEmpty else { return }
        for upload in try await engine.uploads(profileID: profileID) {
            guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
            guard let id = upload.object?.fields["mutationId"]?.text else {
                throw FacetContractError.unsupportedResponse
            }
            if queued.contains(id) { continue }
            let outcome = try uploadAdmissions.attempt(
                id: id, at: Self.now(),
                random: {
                    var random = SystemRandomNumberGenerator()
                    return Data(
                        (0..<12).map { _ in UInt8.random(in: .min ... .max, using: &random) })
                },
                queue: { request in
                    try core.queueDurableUpload(
                        operationId: id, nonce: request.nonce, nowMs: request.nowMs)
                })
            let effects: [ObsidianSessionEffect]
            switch outcome {
            case .waiting: return
            case .accepted(let admitted):
                queued.insert(id)
                effects = admitted
            }
            // Admission transfers ownership to Rust. An effect failure does
            // not undo that admission or authorize another enqueue.
            try await process(effects)
        }
    }
}

extension FacetEngine {
    internal func bindOwnedSession(_ session: FfiObsidianSession, profileID: String) throws {
        try requireOpen()
        try session.bindRuntime(engine: engine, profileId: profileID)
    }

    internal func applyOwnedDownload(session: FfiObsidianSession, transferID: String) throws {
        try requireOpen()
        try session.applyDownload(transferId: transferID)
    }
}
