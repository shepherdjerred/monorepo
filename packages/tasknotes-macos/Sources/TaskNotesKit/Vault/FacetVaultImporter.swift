public import Foundation

internal struct VaultImportEntry: Codable, Equatable {
    let path: String
    let directory: Bool
}

public struct FacetVaultImport: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let complete: Bool
    public let files: UInt64
    public let bytes: UInt64
}

public enum FacetVaultImportError: Error, LocalizedError {
    case sourceChanged
    public var errorDescription: String? {
        "The source folder changed during import. The original and interrupted copy are retained. "
            + "Choose the source again to begin a new independent copy."
    }
}

/// An independent private copy. Source capabilities are read-only and never
/// registered as a writable profile. Interrupted copies stay private for retry.
public actor FacetVaultImporter {
    private struct Inventory: Codable {
        let entries: [VaultImportEntry]
    }
    private struct Manifest: Codable {
        let id: String
        let name: String
        let bookmark: Data
        var inventory: Inventory?
        var complete: Bool
        var registered: Bool
        var files: UInt64
        var bytes: UInt64

        var summary: FacetVaultImport {
            FacetVaultImport(
                id: id, name: name, complete: complete, files: files, bytes: bytes)
        }
    }

    private let directory: URL

    public init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public func pending() throws -> [FacetVaultImport] {
        let root = try VaultDirectory(url: directory)
        return try root.entries().map { id in
            guard UUID(uuidString: id) != nil else { throw AppleVaultError.invalidPath }
            let manifest = try read(root.directory(id), id: id)
            return manifest.registered ? nil : manifest.summary
        }.compactMap { $0 }
    }

    public func begin(source: URL) throws -> FacetVaultImport {
        let granted = source.startAccessingSecurityScopedResource()
        defer { if granted { source.stopAccessingSecurityScopedResource() } }
        #if os(macOS)
            let options: URL.BookmarkCreationOptions = [.withSecurityScope]
        #else
            let options: URL.BookmarkCreationOptions = [.minimalBookmark]
        #endif
        let id = UUID().uuidString
        let manifest = Manifest(
            id: id, name: source.lastPathComponent,
            bookmark: try source.bookmarkData(
                options: options, includingResourceValuesForKeys: nil, relativeTo: nil),
            inventory: nil, complete: false, registered: false, files: 0, bytes: 0)
        let target = try VaultDirectory(url: directory).directory(id, create: true)
        try save(manifest, in: target)
        return try copy(manifest: manifest, source: source, target: target)
    }

    public func retry(id: String) throws -> FacetVaultImport {
        guard UUID(uuidString: id) != nil else { throw AppleVaultError.invalidPath }
        let target = try VaultDirectory(url: directory).directory(id)
        let manifest = try read(target, id: id)
        var stale = false
        #if os(macOS)
            let options: URL.BookmarkResolutionOptions = [.withSecurityScope]
        #else
            let options: URL.BookmarkResolutionOptions = []
        #endif
        let source = try URL(
            resolvingBookmarkData: manifest.bookmark, options: options, relativeTo: nil,
            bookmarkDataIsStale: &stale)
        guard !stale else { throw AppleVaultError.expiredPermission }
        let granted = source.startAccessingSecurityScopedResource()
        defer { if granted { source.stopAccessingSecurityScopedResource() } }
        return try copy(manifest: manifest, source: source, target: target)
    }

    public func completedDirectory(id: String) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw AppleVaultError.invalidPath }
        let manifest = try read(VaultDirectory(url: directory).directory(id), id: id)
        guard manifest.complete else { throw AppleVaultError.coordinationFailed }
        return directory.appendingPathComponent(id).appendingPathComponent("vault")
    }

    public func acknowledgeRegistration(id: String) throws {
        guard UUID(uuidString: id) != nil else { throw AppleVaultError.invalidPath }
        let target = try VaultDirectory(url: directory).directory(id)
        var manifest = try read(target, id: id)
        guard manifest.complete else { throw AppleVaultError.coordinationFailed }
        manifest.registered = true
        try save(manifest, in: target)
    }

    private func copy(manifest original: Manifest, source: URL, target: VaultDirectory) throws
        -> FacetVaultImport
    {
        if original.complete { return original.summary }
        var manifest = original
        let sourceRoot = try VaultDirectory(url: source)
        let entries = try coordinated(source) { try sourceRoot.importTree() }
        if let expected = manifest.inventory {
            guard entries == expected.entries else { throw FacetVaultImportError.sourceChanged }
        } else {
            manifest.inventory = Inventory(entries: entries)
            try save(manifest, in: target)
        }
        let vault = try target.directory("vault", create: true)
        let staging = try target.directory("staging", create: true)
        manifest.files = 0
        manifest.bytes = 0
        for entry in entries {
            if entry.directory {
                _ = try vault.directory(entry.path, create: true)
            } else {
                let copied = try coordinated(source.appendingPathComponent(entry.path)) {
                    try copyFile(entry.path, from: sourceRoot, to: vault, staging: staging)
                }
                manifest.files += 1
                manifest.bytes += copied.size
            }
        }
        guard try coordinated(source, { try sourceRoot.importTree() }) == entries else {
            throw FacetVaultImportError.sourceChanged
        }
        try vault.synchronize()
        for name in try staging.entries() {
            guard UUID(uuidString: name) != nil else { throw AppleVaultError.invalidPath }
            try staging.remove(name)
        }
        try staging.synchronize()
        manifest.complete = true
        try save(manifest, in: target)
        return manifest.summary
    }

    private func copyFile(
        _ path: String, from source: VaultDirectory, to target: VaultDirectory,
        staging: VaultDirectory
    )
        throws -> VaultFileFingerprint
    {
        let (sourceParent, sourceName) = try source.parent(path)
        guard let input = try sourceParent.openFile(sourceName) else {
            throw AppleVaultError.coordinationFailed
        }
        let (parent, name) = try target.parent(path, create: true)
        let temporary = UUID().uuidString
        guard let output = try staging.openFile(temporary, writable: true, createNew: true) else {
            throw AppleVaultError.coordinationFailed
        }
        do {
            let copied = try input.copy(to: output)
            try staging.rename(temporary, to: parent, name: name, flags: 0)
            try parent.synchronize()
            try staging.synchronize()
            return copied
        } catch {
            try staging.remove(temporary)
            try staging.synchronize()
            throw error
        }
    }

    private func coordinated<T>(_ url: URL, _ operation: () throws -> T) throws -> T {
        var error: NSError?
        var result: Result<T, any Error> = .failure(AppleVaultError.coordinationFailed)
        unsafe NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) {
            coordinated in
            result = Result {
                guard coordinated.standardizedFileURL == url.standardizedFileURL else {
                    throw AppleVaultError.coordinationFailed
                }
                return try operation()
            }
        }
        if let error { throw error }
        return try result.get()
    }

    private func read(_ target: VaultDirectory, id: String) throws -> Manifest {
        guard let bytes = try target.read("manifest.json") else {
            throw AppleVaultError.coordinationFailed
        }
        let manifest = try JSONDecoder().decode(Manifest.self, from: bytes)
        guard manifest.id == id else { throw AppleVaultError.invalidPath }
        return manifest
    }

    private func save(_ manifest: Manifest, in target: VaultDirectory) throws {
        try target.replaceMetadata("manifest.json", bytes: JSONEncoder().encode(manifest))
    }
}
