import Foundation

internal struct VaultSnapshotReceipt: Equatable {
    let id: String
    let size: UInt64
    let revision: String
}

/// Callbacks serialize this registry and all descriptor positions through the
/// owning storage mutex. Only four immutable copies per profile remain active.
internal final class VaultSnapshots {
    private struct Active {
        let profileID: String
        let name: String
        let file: VaultFile
        let receipt: VaultSnapshotReceipt
    }

    private let directory: VaultDirectory
    private let parent: VaultDirectory
    private let epochName: String
    private let signer: VaultHandleSigner
    private var active: [String: Active] = [:]

    init(directory: VaultDirectory, signer: VaultHandleSigner) throws {
        self.signer = signer
        parent = directory
        epochName = UUID().uuidString.lowercased()
        // The callback storage owns an exclusive namespace lease before this
        // scan; previous epochs contain only disposable private read copies.
        for name in try directory.entries() {
            guard UUID(uuidString: name)?.uuidString.lowercased() == name else {
                throw VaultSnapshotError.invalidHandle
            }
            let stale = try directory.directory(name)
            for image in try stale.entries() {
                guard UUID(uuidString: image)?.uuidString.lowercased() == image,
                    try stale.openFile(image) != nil
                else { throw VaultSnapshotError.invalidHandle }
                try stale.remove(image)
            }
            try directory.removeDirectory(name)
        }
        self.directory = try directory.directory(epochName, create: true)
        try directory.synchronize()
    }

    func open(profileID: String, source: VaultFile, expected: VaultFileFingerprint? = nil) throws
        -> VaultSnapshotReceipt
    {
        guard active.values.filter({ $0.profileID == profileID }).count < 4 else {
            throw VaultSnapshotError.capacity
        }
        let name = UUID().uuidString.lowercased()
        guard let copy = try directory.openFile(name, writable: true, createNew: true) else {
            throw VaultSnapshotError.invalidHandle
        }
        do {
            let captured = try source.copy(to: copy)
            guard expected == nil || expected == captured else {
                throw AppleVaultError.coordinationFailed
            }
            let id = try signer.snapshot(profileID: profileID, nonce: name)
            let receipt = VaultSnapshotReceipt(
                id: id, size: captured.size, revision: captured.revision)
            active[id] = Active(profileID: profileID, name: name, file: copy, receipt: receipt)
            return receipt
        } catch {
            try directory.remove(name)
            throw error
        }
    }

    func read(profileID: String, id: String, offset: UInt64, length: Int) throws -> Data {
        _ = try signer.snapshotNonce(profileID: profileID, id: id)
        guard let image = active[id], image.profileID == profileID else {
            throw VaultSnapshotError.invalidHandle
        }
        return try image.file.read(offset: offset, length: length)
    }

    func close(profileID: String, id: String) throws {
        // A valid proof from this callback epoch is the bounded close receipt;
        // an unissued or wrong-owner token cannot pass the signature check.
        _ = try signer.snapshotNonce(profileID: profileID, id: id)
        guard let image = active[id] else { return }
        guard image.profileID == profileID else { throw VaultSnapshotError.invalidHandle }
        try directory.remove(image.name)
        active.removeValue(forKey: id)
    }

    func retire() throws {
        var first: (any Error)?
        for (id, image) in active {
            do {
                try directory.remove(image.name)
                active.removeValue(forKey: id)
            } catch { if first == nil { first = error } }
        }
        if let first { throw first }
        try parent.removeDirectory(epochName)
    }
}

internal enum VaultSnapshotError: Error { case capacity, invalidHandle }
