import CryptoKit
import Darwin
import Foundation

internal struct VaultFileFingerprint: Equatable {
    let size: UInt64
    let revision: String
}

internal struct VaultFileIdentity: Codable, Equatable {
    let device: UInt64
    let inode: UInt64
}

/// Owns a regular, no-follow file descriptor. Every byte operation is bounded.
internal final class VaultFile {
    private let descriptor: Int32
    private let handle: FileHandle
    static let maximumChunk = 1_048_576

    init(descriptor: Int32) throws {
        var value = stat()
        guard unsafe fstat(descriptor, &value) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        guard value.st_mode & S_IFMT == S_IFREG, value.st_size >= 0 else {
            throw AppleVaultError.invalidPath
        }
        self.descriptor = descriptor
        handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
    }

    deinit { close(descriptor) }

    func size() throws -> UInt64 { UInt64(try information().st_size) }

    func identity() throws -> VaultFileIdentity {
        let info = try information()
        return VaultFileIdentity(
            device: UInt64(UInt32(bitPattern: info.st_dev)), inode: info.st_ino)
    }

    func read(offset: UInt64, length: Int) throws -> Data {
        let size = try size()
        guard length >= 0, length <= Self.maximumChunk, offset <= size,
            UInt64(length) <= size - offset
        else { throw AppleVaultError.invalidPath }
        try handle.seek(toOffset: offset)
        var bytes = Data()
        while bytes.count < length {
            guard let chunk = try handle.read(upToCount: length - bytes.count), !chunk.isEmpty
            else {
                throw AppleVaultError.coordinationFailed
            }
            bytes.append(chunk)
        }
        return bytes
    }

    func write(offset: UInt64, bytes: Data, durable: Bool = true) throws {
        guard bytes.count <= Self.maximumChunk, offset <= UInt64(Int64.max),
            UInt64(bytes.count) <= UInt64(Int64.max) - offset
        else { throw AppleVaultError.invalidPath }
        try handle.seek(toOffset: offset)
        try handle.write(contentsOf: bytes)
        if durable { try synchronize() }
    }

    func truncate(to size: UInt64) throws {
        guard size <= UInt64(Int64.max) else { throw AppleVaultError.invalidPath }
        try handle.truncate(atOffset: size)
        try synchronize()
    }

    func synchronize() throws {
        guard fsync(descriptor) == 0 else { throw failure() }
    }

    func acquireExclusiveLease() throws {
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { throw failure() }
    }

    func releaseLease() throws {
        guard flock(descriptor, LOCK_UN) == 0 else { throw failure() }
    }

    func fingerprint() throws -> VaultFileFingerprint {
        let before = try information()
        let size = UInt64(before.st_size)
        var hash = SHA256()
        var offset: UInt64 = 0
        while offset < size {
            let length = Int(min(UInt64(Self.maximumChunk), size - offset))
            hash.update(data: try read(offset: offset, length: length))
            offset += UInt64(length)
        }
        guard unchanged(before, try information()) else { throw AppleVaultError.coordinationFailed }
        return VaultFileFingerprint(size: size, revision: hex(hash.finalize()))
    }

    /// Copy to a private regular file, then verify the exact source again.
    /// The copy is independent of the eventual writable destination inode.
    func copy(to destination: VaultFile) throws -> VaultFileFingerprint {
        let before = try information()
        let size = UInt64(before.st_size)
        try destination.truncate(to: 0)
        var hash = SHA256()
        var offset: UInt64 = 0
        while offset < size {
            let length = Int(min(UInt64(Self.maximumChunk), size - offset))
            let block = try read(offset: offset, length: length)
            hash.update(data: block)
            try destination.write(offset: offset, bytes: block, durable: false)
            offset += UInt64(length)
        }
        try destination.synchronize()
        let captured = VaultFileFingerprint(size: size, revision: hex(hash.finalize()))
        guard unchanged(before, try information()), try fingerprint() == captured,
            try destination.fingerprint() == captured
        else { throw AppleVaultError.coordinationFailed }
        return captured
    }

    private func information() throws -> stat {
        var value = stat()
        guard unsafe fstat(descriptor, &value) == 0 else { throw failure() }
        guard value.st_mode & S_IFMT == S_IFREG, value.st_size >= 0 else {
            throw AppleVaultError.invalidPath
        }
        return value
    }

    private func unchanged(_ before: stat, _ after: stat) -> Bool {
        before.st_dev == after.st_dev && before.st_ino == after.st_ino
            && before.st_size == after.st_size
            && before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec
            && before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec
            && before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec
            && before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
    }

    private func hex(_ digest: SHA256.Digest) -> String {
        digest.map {
            let digits = String($0, radix: 16)
            return digits.count == 1 ? "0" + digits : digits
        }.joined()
    }

    private func failure() -> POSIXError { POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
}
