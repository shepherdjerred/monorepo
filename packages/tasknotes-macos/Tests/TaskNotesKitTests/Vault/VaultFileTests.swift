import Foundation
import Testing

@testable import TaskNotesKit

struct VaultFileTests {
    @Test func boundedReadsCopiesAndTruncationPreserveAnIndependentImage() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let directory = try VaultDirectory(url: root)
        let source = try #require(try directory.openFile("source", writable: true, createNew: true))
        let destination = try #require(
            try directory.openFile("snapshot", writable: true, createNew: true))
        let block = Data(repeating: 42, count: VaultFile.maximumChunk)
        for index in 0..<3 { try source.write(offset: UInt64(index * block.count), bytes: block) }
        let expected = try source.fingerprint()
        #expect(try source.copy(to: destination) == expected)
        #expect(try destination.read(offset: expected.size, length: 0).isEmpty)
        #expect(throws: AppleVaultError.self) {
            try destination.read(offset: 0, length: VaultFile.maximumChunk + 1)
        }
        #expect(throws: AppleVaultError.self) {
            try destination.read(offset: expected.size, length: 1)
        }
        try source.write(offset: 0, bytes: Data([99]))
        #expect(try source.fingerprint() != expected)
        #expect(try destination.fingerprint() == expected)
        try destination.truncate(to: UInt64(block.count))
        #expect(try destination.size() == UInt64(block.count))
    }

    @Test func regularNoFollowDescriptorRejectsDirectoryAndSymlink() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let directory = try VaultDirectory(url: root)
        _ = try directory.directory("child", create: true)
        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("link"),
            withDestinationURL: root.appendingPathComponent("child"))
        #expect(throws: AppleVaultError.self) { try directory.openFile("child") }
        #expect(throws: POSIXError.self) { try directory.openFile("link") }
        #expect(try directory.openFile("missing") == nil)
    }
}
