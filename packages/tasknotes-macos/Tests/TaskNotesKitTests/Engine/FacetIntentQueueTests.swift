import Foundation
import Testing

@testable import TaskNotesKit

struct FacetIntentQueueTests {
    @Test func escapedTitlesRoundTripAndOversizedRecordsFailBeforeBuffering() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let queue = try FacetIntentQueue(directory: root)
        try queue.selectProfile("vault")
        let title = "Task" + String(repeating: "\u{0000}", count: 8188)
        let capture = try queue.enqueue(title: title)
        #expect(try queue.pending().first?.title == title)
        let files = try VaultDirectory(url: root).directory("captures")
        let file = try #require(try files.openFile(capture.id + ".json", writable: true))
        try file.truncate(to: 200 * 1024 * 1024)
        #expect(throws: FacetContractError.self) { try queue.pending() }
        #expect(try file.size() == 200 * 1024 * 1024)
    }

    @Test func queuedCaptureKeepsOriginalOwnerAcrossSelectionAndReopen() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let queue = try FacetIntentQueue(directory: root)
        try queue.selectProfile("original-vault")
        let instant = Date(timeIntervalSince1970: 1_790_000_000)
        let capture = try queue.enqueue(title: "Queued title", at: instant)
        try queue.selectProfile("another-vault")
        let reopened = try FacetIntentQueue(directory: root)
        let recovered = try #require(reopened.pending().first)
        #expect(recovered.id == capture.id)
        #expect(recovered.profileID == "original-vault")
        #expect(recovered.at == instant.ISO8601Format())
        try reopened.acknowledge(id: capture.id)
        #expect(try reopened.pending().isEmpty)
    }

    @Test func missingSelectionAndCorruptCommittedActionFailVisibly() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let queue = try FacetIntentQueue(directory: root)
        #expect(throws: FacetIntentError.self) { try queue.enqueue(title: "No vault") }
        try queue.selectProfile("vault")
        let capture = try queue.enqueue(title: "Capture")
        let files = try VaultDirectory(url: root).directory("captures")
        try files.replaceMetadata(capture.id + ".json", bytes: Data("{}".utf8))
        #expect(throws: FacetContractError.self) { try queue.pending() }
    }

    @Test func appliedCaptureReplaysAfterQueueAcknowledgmentWasLost() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let engineDirectory = root.appendingPathComponent("engine")
        let engine = try await FacetEngine.open(directory: engineDirectory)
        let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
        _ = try await engine.refresh(profileID: profile.id)
        let queue = try FacetIntentQueue(directory: root.appendingPathComponent("group-actions"))
        try queue.selectProfile(profile.id)
        let capture = try queue.enqueue(title: "From an App Intent")
        try await engine.applyIntentCapture(capture)
        // Core receipt and host observation exist; AppGroup acknowledgment was lost.
        let reopened = try await FacetEngine.open(directory: engineDirectory)
        let stillQueued = try #require(queue.pending().first)
        try await reopened.applyIntentCapture(stillQueued)
        try queue.acknowledge(id: stillQueued.id)
        let snapshot = try await reopened.snapshot(profileID: profile.id, query: .object([:]))
        #expect(snapshot.tasks.count == 1)
        #expect(snapshot.tasks.first?.title == "From an App Intent")
        #expect(try queue.pending().isEmpty)
    }
}
