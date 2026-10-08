import CryptoKit
import Darwin
import Foundation

/// Descriptor-relative operations keep an opened vault capability anchored
/// even if another process changes a path component to a symbolic link.
internal final class VaultDirectory {
    let descriptor: Int32

    init(url: URL) throws {
        descriptor = url.path.withCString { unsafe open($0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW) }
        guard descriptor >= 0 else { throw Self.failure() }
    }

    private init(descriptor: Int32) { self.descriptor = descriptor }
    deinit { close(descriptor) }

    func directory(_ path: String, create: Bool = false) throws -> VaultDirectory {
        var directoryDescriptor = dup(self.descriptor)
        guard directoryDescriptor >= 0 else { throw Self.failure() }
        for component in try components(path) {
            let next = component.withCString {
                unsafe openat(directoryDescriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
            }
            if next < 0, create, errno == ENOENT {
                let created = component.withCString {
                    unsafe mkdirat(directoryDescriptor, $0, 0o700)
                }
                guard created == 0 || errno == EEXIST else {
                    close(directoryDescriptor)
                    throw Self.failure()
                }
                guard fsync(directoryDescriptor) == 0 else {
                    close(directoryDescriptor)
                    throw Self.failure()
                }
                let reopened = component.withCString {
                    unsafe openat(directoryDescriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                }
                guard reopened >= 0 else {
                    close(directoryDescriptor)
                    throw Self.failure()
                }
                close(directoryDescriptor)
                directoryDescriptor = reopened
            } else {
                guard next >= 0 else {
                    close(directoryDescriptor)
                    throw Self.failure()
                }
                close(directoryDescriptor)
                directoryDescriptor = next
            }
        }
        return VaultDirectory(descriptor: directoryDescriptor)
    }

    func parent(_ path: String, create: Bool = false) throws -> (VaultDirectory, String) {
        let pieces = try components(path)
        guard let name = pieces.last else { throw AppleVaultError.invalidPath }
        return (try directory(pieces.dropLast().joined(separator: "/"), create: create), name)
    }

    func read(_ name: String) throws -> Data? {
        try basename(name)
        let file = name.withCString { unsafe openat(descriptor, $0, O_RDONLY | O_NOFOLLOW) }
        guard file >= 0 else {
            if errno == ENOENT { return nil }
            throw Self.failure()
        }
        defer { close(file) }
        var information = stat()
        guard unsafe fstat(file, &information) == 0, information.st_mode & S_IFMT == S_IFREG else {
            throw AppleVaultError.invalidPath
        }
        return try FileHandle(fileDescriptor: file, closeOnDealloc: false).readToEnd() ?? Data()
    }

    func openFile(_ name: String, writable: Bool = false, createNew: Bool = false) throws
        -> VaultFile?
    {
        try basename(name)
        guard !createNew || writable else { throw AppleVaultError.invalidPath }
        let access = writable ? O_RDWR : O_RDONLY
        let creation = createNew ? O_CREAT | O_EXCL : 0
        let file = name.withCString {
            unsafe openat(descriptor, $0, access | creation | O_NOFOLLOW | O_NONBLOCK, 0o600)
        }
        guard file >= 0 else {
            if !createNew, errno == ENOENT { return nil }
            throw Self.failure()
        }
        do { return try VaultFile(descriptor: file) } catch {
            close(file)
            throw error
        }
    }

    func writeNew(_ name: String, bytes: Data) throws {
        try basename(name)
        let file = name.withCString {
            unsafe openat(descriptor, $0, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        }
        guard file >= 0 else { throw Self.failure() }
        defer { close(file) }
        try FileHandle(fileDescriptor: file, closeOnDealloc: false).write(contentsOf: bytes)
        guard fsync(file) == 0 else { throw Self.failure() }
    }

    /// Only the final name is a committed record. Interrupted staging writes
    /// must never appear as partially written durable action envelopes.
    func writeNewAtomic(_ name: String, bytes: Data) throws {
        try basename(name)
        let temporary = UUID().uuidString + ".temporary"
        try writeNew(temporary, bytes: bytes)
        try rename(temporary, to: self, name: name, flags: UInt32(RENAME_EXCL))
        try synchronize()
    }

    func fingerprint(_ name: String) throws -> (size: UInt64, revision: String)? {
        try basename(name)
        let file = name.withCString { unsafe openat(descriptor, $0, O_RDONLY | O_NOFOLLOW) }
        guard file >= 0 else {
            if errno == ENOENT { return nil }
            throw Self.failure()
        }
        defer { close(file) }
        var information = stat()
        guard unsafe fstat(file, &information) == 0, information.st_mode & S_IFMT == S_IFREG else {
            throw AppleVaultError.invalidPath
        }
        let handle = FileHandle(fileDescriptor: file, closeOnDealloc: false)
        var hash = SHA256()
        var count: UInt64 = 0
        while let block = try handle.read(upToCount: 64 * 1024), !block.isEmpty {
            count += UInt64(block.count)
            hash.update(data: block)
        }
        return (
            count,
            hash.finalize().map {
                let value = String($0, radix: 16)
                return value.count == 1 ? "0" + value : value
            }.joined()
        )
    }

    func replaceMetadata(_ name: String, bytes: Data) throws {
        try basename(name)
        let temporary = UUID().uuidString + ".temporary"
        try writeNew(temporary, bytes: bytes)
        try rename(temporary, to: self, name: name, flags: 0)
        try synchronize()
    }

    func remove(_ name: String) throws {
        try basename(name)
        let result = name.withCString { unsafe unlinkat(descriptor, $0, 0) }
        guard result == 0 || errno == ENOENT else { throw Self.failure() }
    }

    func removeDirectory(_ name: String) throws {
        try basename(name)
        let result = name.withCString { unsafe unlinkat(descriptor, $0, AT_REMOVEDIR) }
        guard result == 0 || errno == ENOENT || errno == ENOTEMPTY else { throw Self.failure() }
    }

    func rename(_ name: String, to target: VaultDirectory, name targetName: String, flags: UInt32)
        throws
    {
        try basename(name)
        try basename(targetName)
        let result = name.withCString { source in
            targetName.withCString { destination in
                unsafe renameatx_np(descriptor, source, target.descriptor, destination, flags)
            }
        }
        guard result == 0 else { throw Self.failure() }
    }

    func synchronize() throws { guard fsync(descriptor) == 0 else { throw Self.failure() } }

    func entries() throws -> [String] {
        // dup shares the directory stream offset: a second enumeration would
        // falsely appear empty. Open this anchored directory independently.
        let copied = ".".withCString {
            unsafe openat(descriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        }
        guard copied >= 0 else { throw Self.failure() }
        guard let directory = unsafe fdopendir(copied) else {
            close(copied)
            throw Self.failure()
        }
        defer { unsafe closedir(directory) }
        var result: [String] = []
        while true {
            errno = 0
            guard let entry = unsafe readdir(directory) else {
                guard errno == 0 else { throw Self.failure() }
                break
            }
            let name = unsafe withUnsafePointer(to: &entry.pointee.d_name) { name in
                unsafe name.withMemoryRebound(
                    to: CChar.self, capacity: MemoryLayout.size(ofValue: entry.pointee.d_name)
                ) {
                    unsafe String(cString: $0)
                }
            }
            if name != ".", name != ".." { result.append(name) }
        }
        return result.sorted()
    }

    func listFiles(prefix: String = "") throws -> [String] {
        var result: [String] = []
        for name in try entries() where name.lowercased() != ".facet-recovery" {
            let child = name.withCString {
                unsafe openat(descriptor, $0, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
            }
            if child < 0, errno == ELOOP { continue }
            guard child >= 0 else { throw Self.failure() }
            var information = stat()
            guard unsafe fstat(child, &information) == 0 else {
                close(child)
                throw Self.failure()
            }
            let type = information.st_mode & S_IFMT
            let path = prefix.isEmpty ? name : prefix + "/" + name
            if type == S_IFDIR {
                let nested = VaultDirectory(descriptor: child)
                result.append(contentsOf: try nested.listFiles(prefix: path))
            } else {
                close(child)
                if type == S_IFREG { result.append(path) }
            }
        }
        return result.sorted()
    }

    private func components(_ path: String) throws -> [String] {
        if path.isEmpty { return [] }
        let pieces = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard pieces.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }), !path.contains("\\"),
            !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else {
            throw AppleVaultError.invalidPath
        }
        return pieces
    }

    private func basename(_ name: String) throws {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
            !name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw AppleVaultError.invalidPath }
    }

    private static func failure() -> POSIXError {
        POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
}
