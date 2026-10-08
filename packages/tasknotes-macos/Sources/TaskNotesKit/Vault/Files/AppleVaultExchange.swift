import Darwin
import Foundation

internal struct AppleVaultOperation {
    let profileID: String
    let path: String
    let expectedRevision: String?
    let replacement: Data?
}

extension AppleVaultFiles {
    private struct PreparedExchange {
        let id: String
        let recovery: VaultDirectory
        var displaced: String { id + ".bytes" }
        var metadata: String { id + ".json" }
    }

    internal func exchangeCoordinated(
        _ request: AppleVaultOperation, root: VaultDirectory, parent: VaultDirectory, name: String
    ) throws -> AppleVaultExchange {
        let existing = try parent.read(name)
        guard existing.map(Self.revision) == request.expectedRevision else {
            return AppleVaultExchange(applied: false)
        }
        guard existing != nil || request.replacement != nil else {
            return AppleVaultExchange(applied: true)
        }
        let prepared = try prepareExchange(request, root: root)
        if existing != nil {
            return try captureExisting(request, prepared: prepared, parent: parent, name: name)
        }
        return try createNew(prepared, parent: parent, name: name)
    }

    private func prepareExchange(_ request: AppleVaultOperation, root: VaultDirectory) throws
        -> PreparedExchange
    {
        let prepared = PreparedExchange(
            id: UUID().uuidString,
            recovery: try recoveryRoot(root: root, profileID: request.profileID))
        if let replacement = request.replacement {
            try prepared.recovery.writeNew(prepared.displaced, bytes: replacement)
        }
        let record = Displacement(
            id: prepared.id, path: request.path,
            replacementRevision: request.replacement.map(Self.revision),
            expectedRevision: request.expectedRevision)
        try prepared.recovery.writeNew(prepared.metadata, bytes: JSONEncoder().encode(record))
        try prepared.recovery.synchronize()
        return prepared
    }

    private func captureExisting(
        _ request: AppleVaultOperation, prepared: PreparedExchange, parent: VaultDirectory,
        name: String
    ) throws -> AppleVaultExchange {
        // Exchange captures the exact displaced bytes even if an external writer
        // replaces this file after the earlier revision check.
        if request.replacement != nil {
            try prepared.recovery.rename(
                prepared.displaced, to: parent, name: name, flags: UInt32(RENAME_SWAP))
        } else {
            try parent.rename(
                name, to: prepared.recovery, name: prepared.displaced, flags: UInt32(RENAME_EXCL))
        }
        try prepared.recovery.synchronize()
        try parent.synchronize()
        guard let captured = try prepared.recovery.read(prepared.displaced) else {
            throw AppleVaultError.coordinationFailed
        }
        let record = Displacement(
            id: prepared.id, path: request.path,
            replacementRevision: request.replacement.map(Self.revision),
            expectedRevision: request.expectedRevision, capturedSize: UInt64(captured.count),
            capturedRevision: Self.revision(captured))
        try prepared.recovery.replaceMetadata(
            prepared.metadata, bytes: JSONEncoder().encode(record))
        return AppleVaultExchange(
            applied: true, displacedBytes: captured, displacedVersionID: prepared.id)
    }

    private func createNew(_ prepared: PreparedExchange, parent: VaultDirectory, name: String)
        throws -> AppleVaultExchange
    {
        do {
            try prepared.recovery.rename(
                prepared.displaced, to: parent, name: name, flags: UInt32(RENAME_EXCL))
        } catch let failure as POSIXError where failure.code == .EEXIST {
            try prepared.recovery.remove(prepared.metadata)
            try prepared.recovery.remove(prepared.displaced)
            try prepared.recovery.synchronize()
            return AppleVaultExchange(applied: false)
        }
        try parent.synchronize()
        try prepared.recovery.remove(prepared.metadata)
        try prepared.recovery.synchronize()
        return AppleVaultExchange(applied: true)
    }
}
