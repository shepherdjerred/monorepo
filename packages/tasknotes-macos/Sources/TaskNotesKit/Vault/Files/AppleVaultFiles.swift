import CryptoKit
import Darwin
public import Foundation
import Synchronization

/// File capabilities shared by the macOS and iOS hosts. The engine owns paths,
/// revisions and write journals; this host owns platform coordination and grants.
public final class AppleVaultFiles: Sendable {
    private struct Capability: Codable, Sendable {
        let bookmark: Data
        let external: Bool
    }

    internal struct Displacement: Codable {
        let id: String
        let path: String
        let replacementRevision: String?
        let expectedRevision: String?
        var capturedSize: UInt64?
        var capturedRevision: String?
    }

    private let registry: URL
    private let capabilities: Mutex<[String: Capability]>
    internal let boundedDirectory: URL
    internal let bounded = Mutex<VaultBoundedStorage?>(nil)

    public init(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        registry = directory.appendingPathComponent("vault-capabilities.json")
        boundedDirectory = directory.appendingPathComponent("bounded-vault")
        try FileManager.default.createDirectory(
            at: boundedDirectory, withIntermediateDirectories: true)
        let stored: [String: Capability]
        if FileManager.default.fileExists(atPath: registry.path) {
            stored = try JSONDecoder().decode(
                [String: Capability].self, from: Data(contentsOf: registry))
        } else {
            stored = [:]
        }
        capabilities = Mutex(stored)
    }

    public func register(profileID: String, directory: URL, external: Bool) throws {
        let granted = external && directory.startAccessingSecurityScopedResource()
        defer { if granted { directory.stopAccessingSecurityScopedResource() } }
        let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else {
            throw AppleVaultError.invalidDirectory
        }
        #if os(macOS)
            let options: URL.BookmarkCreationOptions = external ? [.withSecurityScope] : []
        #else
            let options: URL.BookmarkCreationOptions = [.minimalBookmark]
        #endif
        let capability = Capability(
            bookmark: try directory.bookmarkData(
                options: options, includingResourceValuesForKeys: nil, relativeTo: nil),
            external: external
        )
        try capabilities.withLock { stored in
            var next = stored
            next[profileID] = capability
            try VaultDirectory(url: registry.deletingLastPathComponent()).replaceMetadata(
                registry.lastPathComponent, bytes: JSONEncoder().encode(next))
            stored = next
        }
    }

    public func forget(profileID: String) throws {
        try capabilities.withLock { stored in
            var next = stored
            next.removeValue(forKey: profileID)
            try VaultDirectory(url: registry.deletingLastPathComponent()).replaceMetadata(
                registry.lastPathComponent, bytes: JSONEncoder().encode(next))
            stored = next
        }
    }

    public func listFiles(profileID: String) throws -> [String] {
        try withRoot(profileID) { root in
            try VaultDirectory(url: root).listFiles()
        }
    }

    public func directory(profileID: String, path: String, deleted: Bool) throws {
        try withRoot(profileID) { root in
            _ = try checkedURL(root: root, path: path)
            let capability = try VaultDirectory(url: root)
            if deleted {
                do {
                    let (parent, name) = try capability.parent(path)
                    try parent.removeDirectory(name)
                    try parent.synchronize()
                } catch let failure as POSIXError where failure.code == .ENOENT {}
            } else {
                let child = try capability.directory(path, create: true)
                try child.synchronize()
                try capability.synchronize()
            }
        }
    }

    public func readFile(profileID: String, path: String) throws -> Data? {
        try withRoot(profileID) { root in
            let target = try checkedURL(root: root, path: path)
            let capability = try VaultDirectory(url: root)
            var coordinationError: NSError?
            var result: Result<Data?, any Error> = .failure(AppleVaultError.coordinationFailed)
            // NSErrorPointer is valid for the synchronous duration of coordination.
            unsafe NSFileCoordinator().coordinate(
                readingItemAt: target, options: [], error: &coordinationError
            ) { coordinated in
                result = Result {
                    guard coordinated.standardizedFileURL == target.standardizedFileURL else {
                        throw AppleVaultError.coordinationFailed
                    }
                    do {
                        let (parent, name) = try capability.parent(path)
                        return try parent.read(name)
                    } catch let failure as POSIXError where failure.code == .ENOENT { return nil }
                }
            }
            if let coordinationError {
                if coordinationError.domain == NSCocoaErrorDomain
                    && coordinationError.code == NSFileReadNoSuchFileError
                {
                    return nil
                }
                throw coordinationError
            }
            return try result.get()
        }
    }

    public func exchange(
        profileID: String, path: String, expectedRevision: String?, replacement: Data?
    ) throws -> AppleVaultExchange {
        try withRoot(profileID) { root in
            let target = try checkedURL(root: root, path: path)
            let capability = try VaultDirectory(url: root)
            let (parent, name) = try capability.parent(path, create: replacement != nil)
            var coordinationError: NSError?
            var result: Result<AppleVaultExchange, any Error> = .failure(
                AppleVaultError.coordinationFailed)
            unsafe NSFileCoordinator().coordinate(
                writingItemAt: target, options: .forReplacing, error: &coordinationError
            ) { coordinated in
                result = Result {
                    guard coordinated.standardizedFileURL == target.standardizedFileURL else {
                        throw AppleVaultError.coordinationFailed
                    }
                    return try exchangeCoordinated(
                        AppleVaultOperation(
                            profileID: profileID, path: path,
                            expectedRevision: expectedRevision, replacement: replacement),
                        root: capability, parent: parent, name: name)
                }
            }
            if let coordinationError { throw coordinationError }
            return try result.get()
        }
    }

    public static func revision(_ data: Data) -> String {
        SHA256.hash(data: data).map { byte in
            let digits = String(byte, radix: 16)
            return digits.count == 1 ? "0" + digits : digits
        }.joined()
    }

    internal func withRoot<T>(_ profileID: String, operation: (URL) throws -> T) throws -> T {
        guard let capability = capabilities.withLock({ $0[profileID] }) else {
            throw AppleVaultError.missingPermission
        }
        var stale = false
        #if os(macOS)
            let options: URL.BookmarkResolutionOptions =
                capability.external ? [.withSecurityScope, .withoutUI] : [.withoutUI]
        #else
            let options: URL.BookmarkResolutionOptions = [.withoutUI]
        #endif
        let root = try URL(
            resolvingBookmarkData: capability.bookmark, options: options, relativeTo: nil,
            bookmarkDataIsStale: &stale)
        guard !stale else { throw AppleVaultError.expiredPermission }
        let granted = capability.external && root.startAccessingSecurityScopedResource()
        defer { if granted { root.stopAccessingSecurityScopedResource() } }
        let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else {
            throw AppleVaultError.invalidDirectory
        }
        return try operation(root.standardizedFileURL.resolvingSymlinksInPath())
    }

    internal func checkedURL(root: URL, path: String) throws -> URL {
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !components.isEmpty,
            components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
            components.first?.lowercased() != ".facet-recovery", !path.contains("\\"),
            !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw AppleVaultError.invalidPath }
        var current = root
        for component in components {
            current.appendPathComponent(String(component))
            if FileManager.default.fileExists(atPath: current.path),
                try current.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true
            {
                throw AppleVaultError.symbolicLink
            }
        }
        return current
    }
}

public struct AppleVaultExchange: Sendable {
    public let applied: Bool
    public let displacedBytes: Data?
    public let displacedVersionID: String?

    internal init(applied: Bool, displacedBytes: Data? = nil, displacedVersionID: String? = nil) {
        self.applied = applied
        self.displacedBytes = displacedBytes
        self.displacedVersionID = displacedVersionID
    }
}

public struct AppleDisplacedVersion: Sendable {
    public let id: String
    public let path: String
    public let bytes: Data
}

public struct AppleDisplacedMetadata: Sendable {
    public let id: String
    public let path: String
    public let size: UInt64
    public let revision: String
}

public enum AppleVaultError: Error, LocalizedError {
    case invalidDirectory, missingPermission, expiredPermission, invalidPath, symbolicLink
    case enumerationFailed, coordinationFailed

    public var errorDescription: String? {
        switch self {
        case .invalidDirectory: "Select a vault folder. Symbolic links cannot be opened as vaults."
        case .missingPermission: "Choose this vault folder again to restore access."
        case .expiredPermission: "The saved folder permission has expired. Choose the vault again."
        case .invalidPath: "The vault contains an invalid file path."
        case .symbolicLink: "Facet cannot modify a symbolic link outside its vault capability."
        case .enumerationFailed: "The folder provider could not enumerate this vault."
        case .coordinationFailed: "The folder provider could not coordinate this file operation."
        }
    }
}
