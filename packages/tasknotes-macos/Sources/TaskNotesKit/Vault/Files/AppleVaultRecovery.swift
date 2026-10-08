public import Foundation

extension AppleVaultFiles {
    public func displacedVersions(profileID: String) throws -> [AppleDisplacedVersion] {
        try displacedMetadata(profileID: profileID, afterID: nil, limit: 128).map { metadata in
            AppleDisplacedVersion(
                id: metadata.id, path: metadata.path,
                bytes: try readDisplaced(profileID: profileID, id: metadata.id))
        }
    }

    public func displacedMetadata(profileID: String, afterID: String?, limit: UInt32) throws
        -> [AppleDisplacedMetadata]
    {
        guard limit > 0, limit <= 128,
            afterID == nil || afterID.flatMap(UUID.init(uuidString:)) != nil
        else { throw AppleVaultError.invalidPath }
        return try withRoot(profileID) { root in
            let capability = try VaultDirectory(url: root)
            let recovery = try recoveryRoot(root: capability, profileID: profileID)
            var result: [AppleDisplacedMetadata] = []
            for filename in try recovery.entries()
            where filename.hasSuffix(".json") && String(filename.dropLast(5)) > (afterID ?? "") {
                if result.count == Int(limit) { break }
                if let metadata = try recoveryMetadata(
                    root: root, recovery: recovery, filename: filename)
                {
                    result.append(metadata)
                }
            }
            return result
        }
    }

    private func recoveryMetadata(
        root: URL, recovery: VaultDirectory, filename: String
    ) throws -> AppleDisplacedMetadata? {
        guard let bytes = try recovery.read(filename) else {
            throw AppleVaultError.coordinationFailed
        }
        var record = try JSONDecoder().decode(Displacement.self, from: bytes)
        guard UUID(uuidString: record.id) != nil, filename == record.id + ".json" else {
            throw AppleVaultError.invalidPath
        }
        _ = try checkedURL(root: root, path: record.path)
        guard let captured = try recovery.fingerprint(record.id + ".bytes") else {
            // Legacy records did not retain preparation inode/phase proofs.
            // Neither a missing slot nor a matching destination hash proves
            // that a captured predecessor was never present. Retain the intent.
            throw AppleVaultError.coordinationFailed
        }
        if record.capturedRevision == nil && captured.revision == record.replacementRevision {
            // An equal-hash predecessor and an unexchanged staged replacement
            // are indistinguishable without the new bounded inode proof.
            throw AppleVaultError.coordinationFailed
        }
        if let revision = record.capturedRevision {
            guard revision == captured.revision, record.capturedSize == captured.size else {
                throw AppleVaultError.coordinationFailed
            }
        } else {
            record.capturedRevision = captured.revision
            record.capturedSize = captured.size
            try recovery.replaceMetadata(filename, bytes: JSONEncoder().encode(record))
        }
        return AppleDisplacedMetadata(
            id: record.id, path: record.path, size: captured.size, revision: captured.revision)
    }

    public func readDisplaced(profileID: String, id: String) throws -> Data {
        guard UUID(uuidString: id) != nil else { throw AppleVaultError.invalidPath }
        return try withRoot(profileID) { root in
            let recovery = try recoveryRoot(root: VaultDirectory(url: root), profileID: profileID)
            guard let metadata = try recovery.read(id + ".json"),
                let bytes = try recovery.read(id + ".bytes")
            else { throw AppleVaultError.coordinationFailed }
            let record = try JSONDecoder().decode(Displacement.self, from: metadata)
            guard record.id == id, record.capturedSize == UInt64(bytes.count),
                record.capturedRevision == Self.revision(bytes)
            else { throw AppleVaultError.coordinationFailed }
            _ = try checkedURL(root: root, path: record.path)
            return bytes
        }
    }

    public func acknowledgeDisplaced(profileID: String, id: String) throws {
        guard UUID(uuidString: id) != nil else { throw AppleVaultError.invalidPath }
        try withRoot(profileID) { root in
            let recovery = try recoveryRoot(root: VaultDirectory(url: root), profileID: profileID)
            for suffix in [".bytes", ".json"] {
                try recovery.remove(id + suffix)
            }
            try recovery.synchronize()
        }
    }

    internal func recoveryRoot(root: VaultDirectory, profileID: String) throws -> VaultDirectory {
        let path = ".facet-recovery/" + Self.revision(Data(profileID.utf8))
        return try root.directory(path, create: true)
    }
}
