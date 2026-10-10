import Darwin
import Foundation
import Testing

@testable import TaskNotesKit

struct AppleVaultFilesTests {
    @Test func legacyAmbiguousPreparationRetainsEqualHashAndMissingSlots() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        defer { NativeTestFiles.remove(temporary) }
        let vault = temporary.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let host = try AppleVaultFiles(directory: temporary.appendingPathComponent("state"))
        try host.register(profileID: "profile", directory: vault, external: false)
        let root = try VaultDirectory(url: vault)
        let recovery = try host.recoveryRoot(root: root, profileID: "profile")
        let original = Data("equal predecessor and replacement".utf8)
        try root.writeNew("task.md", bytes: original)
        let id = UUID().uuidString
        var record = AppleVaultFiles.Displacement(
            id: id, path: "task.md", replacementRevision: AppleVaultFiles.revision(original),
            expectedRevision: AppleVaultFiles.revision(original))
        let bytes = try JSONEncoder().encode(record)
        try recovery.writeNew(id + ".json", bytes: bytes)
        #expect(throws: AppleVaultError.self) {
            try host.displacedMetadata(profileID: "profile", afterID: nil, limit: 128)
        }
        #expect(try recovery.read(id + ".json") == bytes)
        try recovery.writeNew(id + ".bytes", bytes: original)
        #expect(throws: AppleVaultError.self) {
            try host.displacedMetadata(profileID: "profile", afterID: nil, limit: 128)
        }
        #expect(try recovery.read(id + ".bytes") == original)
        #expect(try recovery.read(id + ".json") == bytes)
        // An explicitly committed legacy capture remains available for bounded
        // migration even when its bytes equal the eventual replacement.
        record.capturedRevision = AppleVaultFiles.revision(original)
        record.capturedSize = UInt64(original.count)
        try recovery.replaceMetadata(id + ".json", bytes: JSONEncoder().encode(record))
        let metadata = try #require(
            try host.displacedMetadata(
                profileID: "profile", afterID: nil, limit: 128
            ).first)
        #expect(metadata.id == id)
        #expect(metadata.revision == record.capturedRevision)
    }

    @Test func recoveryPagesRetainExactVersionsAndRejectMissingCapturedBytes() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        defer { NativeTestFiles.remove(temporary) }
        let vault = temporary.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let host = try AppleVaultFiles(directory: temporary.appendingPathComponent("state"))
        try host.register(profileID: "profile", directory: vault, external: false)
        for index in 0..<5 {
            let bytes = Data("Original \(index)".utf8)
            _ = try host.exchange(
                profileID: "profile", path: "\(index).md", expectedRevision: nil, replacement: bytes
            )
            _ = try host.exchange(
                profileID: "profile", path: "\(index).md",
                expectedRevision: AppleVaultFiles.revision(bytes),
                replacement: Data("Replacement".utf8))
        }
        var records: [AppleDisplacedMetadata] = []
        var after: String?
        while true {
            let page = try host.displacedMetadata(profileID: "profile", afterID: after, limit: 2)
            #expect(page.count <= 2)
            if page.isEmpty { break }
            records += page
            after = page.last?.id
        }
        #expect(records.count == 5)
        #expect(records.map(\.id) == records.map(\.id).sorted())
        for record in records {
            let bytes = try host.readDisplaced(profileID: "profile", id: record.id)
            #expect(record.size == UInt64(bytes.count))
            #expect(record.revision == AppleVaultFiles.revision(bytes))
        }
        let first = try #require(records.first)
        let captured = vault.appendingPathComponent(".facet-recovery").appendingPathComponent(
            AppleVaultFiles.revision(Data("profile".utf8))
        ).appendingPathComponent(first.id + ".bytes")
        try FileManager.default.removeItem(at: captured)
        #expect(throws: AppleVaultError.self) {
            try host.displacedMetadata(profileID: "profile", afterID: nil, limit: 2)
        }
    }

    @Test func coordinatedWritesRejectStaleRevisionsAndPersistPermissions() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        defer { NativeTestFiles.remove(temporary) }
        let vault = temporary.appendingPathComponent("vault")
        let state = temporary.appendingPathComponent("state")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let host = try AppleVaultFiles(directory: state)
        try host.register(profileID: "profile", directory: vault, external: false)
        let original = Data("---\ntitle: Original\n---\nBody\n".utf8)
        #expect(
            try host.exchange(
                profileID: "profile", path: "Tasks/test.md", expectedRevision: nil,
                replacement: original
            ).applied)
        #expect(try host.readFile(profileID: "profile", path: "Tasks/test.md") == original)
        #expect(try host.listFiles(profileID: "profile") == ["Tasks/test.md"])
        let externallyEdited = Data("External edit".utf8)
        try externallyEdited.write(
            to: vault.appendingPathComponent("Tasks/test.md"), options: .atomic)
        #expect(
            try !host.exchange(
                profileID: "profile", path: "Tasks/test.md",
                expectedRevision: AppleVaultFiles.revision(original),
                replacement: Data("Wrong".utf8)
            ).applied)
        let restarted = try AppleVaultFiles(directory: state)
        #expect(
            try restarted.readFile(profileID: "profile", path: "Tasks/test.md") == externallyEdited)
        let deletion = try restarted.exchange(
            profileID: "profile", path: "Tasks/test.md",
            expectedRevision: AppleVaultFiles.revision(externallyEdited), replacement: nil)
        #expect(deletion.applied)
        #expect(deletion.displacedBytes == externallyEdited)
        let retained = try restarted.displacedVersions(profileID: "profile")
        #expect(retained.count == 1)
        #expect(retained.first?.bytes == externallyEdited)
        if let id = deletion.displacedVersionID {
            try restarted.acknowledgeDisplaced(profileID: "profile", id: id)
        }
        #expect(try restarted.displacedVersions(profileID: "profile").isEmpty)
        #expect(try restarted.listFiles(profileID: "profile").isEmpty)
    }

    @Test func capabilitiesRejectTraversalAndSymlinks() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        defer { NativeTestFiles.remove(temporary) }
        let vault = temporary.appendingPathComponent("vault")
        let outside = temporary.appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try Data("Outside".utf8).write(to: outside.appendingPathComponent("secret.md"))
        try FileManager.default.createSymbolicLink(
            at: vault.appendingPathComponent("link"), withDestinationURL: outside)
        let host = try AppleVaultFiles(directory: temporary.appendingPathComponent("state"))
        try host.register(profileID: "profile", directory: vault, external: false)
        #expect(throws: AppleVaultError.self) {
            try host.readFile(profileID: "profile", path: "../outside/secret.md")
        }
        #expect(throws: AppleVaultError.self) {
            try host.readFile(profileID: "profile", path: "link/secret.md")
        }
        #expect(try host.listFiles(profileID: "profile").isEmpty)
        try host.forget(profileID: "profile")
        #expect(throws: AppleVaultError.self) { try host.listFiles(profileID: "profile") }
    }

    @Test func replacedParentCannotRedirectAnAnchoredWrite() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        defer { NativeTestFiles.remove(temporary) }
        let vault = temporary.appendingPathComponent("vault")
        let outside = temporary.appendingPathComponent("outside")
        try FileManager.default.createDirectory(
            at: vault.appendingPathComponent("Tasks"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        let root = try VaultDirectory(url: vault)
        let (anchored, name) = try root.parent("Tasks/task.md")
        try FileManager.default.moveItem(
            at: vault.appendingPathComponent("Tasks"),
            to: vault.appendingPathComponent("OriginalTasks"))
        try FileManager.default.createSymbolicLink(
            at: vault.appendingPathComponent("Tasks"), withDestinationURL: outside)
        try anchored.writeNew(name, bytes: Data("Anchored".utf8))
        #expect(!FileManager.default.fileExists(atPath: outside.appendingPathComponent(name).path))
        #expect(
            try Data(contentsOf: vault.appendingPathComponent("OriginalTasks/task.md"))
                == Data("Anchored".utf8))
        #expect(throws: (any Error).self) { try root.parent("Tasks/task.md") }
    }

    @Test func atomicDisplacementCapturesAnEditAfterTheRevisionRead() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        defer { NativeTestFiles.remove(temporary) }
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        let root = try VaultDirectory(url: temporary)
        let original = Data("Original".utf8)
        try root.writeNew("task.md", bytes: original)
        let observed = try root.read("task.md")
        let expected = AppleVaultFiles.revision(try #require(observed))
        let recovery = try root.directory("recovery", create: true)
        let replacement = Data("Facet edit".utf8)
        try recovery.writeNew("captured.bytes", bytes: replacement)
        let external = Data("Concurrent Obsidian edit".utf8)
        try external.write(to: temporary.appendingPathComponent("task.md"), options: .atomic)
        try recovery.rename("captured.bytes", to: root, name: "task.md", flags: UInt32(RENAME_SWAP))
        try recovery.synchronize()
        try root.synchronize()
        let captured = try recovery.read("captured.bytes")
        let displaced = try #require(captured)
        #expect(displaced == external)
        #expect(AppleVaultFiles.revision(displaced) != expected)
        #expect(try root.read("task.md") == replacement)
    }
}
