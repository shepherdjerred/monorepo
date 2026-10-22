import Foundation
import Testing

@testable import TaskNotesKit

struct FacetVaultImporterTests {
    @Test func independentCopyPreservesAttachmentsEmptyFoldersAndSourceBytes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let source = root.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        let files = try VaultDirectory(url: source)
        _ = try files.directory("empty/nested", create: true)
        try files.writeNew("task.md", bytes: Data("original Markdown".utf8))
        let attachment = try #require(
            try files.openFile("attachment.bin", writable: true, createNew: true))
        let chunk = Data(repeating: 73, count: VaultFile.maximumChunk)
        for ordinal in 0..<3 {
            try attachment.write(offset: UInt64(ordinal * chunk.count), bytes: chunk)
        }
        let importer = try FacetVaultImporter(directory: root.appendingPathComponent("imports"))
        let copied = try await importer.begin(source: source)
        #expect(copied.complete)
        #expect(copied.files == 2)
        #expect(copied.bytes == UInt64(chunk.count * 3 + "original Markdown".utf8.count))
        let destination = try await importer.completedDirectory(id: copied.id)
        let target = try VaultDirectory(url: destination)
        #expect(try target.importTree() == files.importTree())
        let saved = try #require(try target.openFile("attachment.bin"))
        #expect(try saved.fingerprint() == attachment.fingerprint())
        try target.replaceMetadata("task.md", bytes: Data("private edit".utf8))
        #expect(try files.read("task.md") == Data("original Markdown".utf8))
        #expect(try await importer.pending().map(\.id) == [copied.id])
        let reopened = try FacetVaultImporter(directory: root.appendingPathComponent("imports"))
        #expect(try await reopened.retry(id: copied.id).id == copied.id)
        #expect(try target.read("task.md") == Data("private edit".utf8))
        try await reopened.acknowledgeRegistration(id: copied.id)
        #expect(try await reopened.pending().isEmpty)
    }

    @Test func unsupportedSourceEntryFailsVisiblyAndRetainsRetryIntent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let source = root.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try VaultDirectory(url: source).writeNew("task.md", bytes: Data("original".utf8))
        try FileManager.default.createSymbolicLink(
            at: source.appendingPathComponent("link"),
            withDestinationURL: source.appendingPathComponent("task.md"))
        let importer = try FacetVaultImporter(directory: root.appendingPathComponent("imports"))
        await #expect(throws: POSIXError.self) { try await importer.begin(source: source) }
        let interrupted = try #require(try await importer.pending().first)
        #expect(!interrupted.complete)
        try VaultDirectory(url: source).remove("link")
        let completed = try await importer.retry(id: interrupted.id)
        #expect(completed.complete)
        #expect(completed.id == interrupted.id)
        #expect(try VaultDirectory(url: source).read("task.md") == Data("original".utf8))
    }
}
