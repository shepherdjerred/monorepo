import Foundation
import Testing

@testable import TaskNotesKit

struct FacetMutationDraftTests {
    @Test func interruptedStagingCannotMasqueradeAsACommittedAction() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let drafts = try FacetMutationDrafts(directory: root)
        let files = try VaultDirectory(url: root)
        try files.writeNew(UUID().uuidString + ".temporary", bytes: Data("{partial".utf8))
        #expect(try drafts.pending().isEmpty)
        let id = UUID().uuidString
        _ = try drafts.envelope(
            profileID: "vault", id: id, command: .object(["kind": .string("create")]),
            at: "2026-10-04T00:00:00Z")
        #expect(try drafts.pending().map(\.id) == [id])
        try files.writeNew(UUID().uuidString + ".json", bytes: Data("{partial".utf8))
        #expect(throws: (any Error).self) { try drafts.pending() }
    }
    @Test func retryPreservesCompleteEnvelopeAcrossRestart() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let id = UUID().uuidString
        let command = FacetValue.object([
            "kind": .string("create"), "properties": .object(["title": .string("Keep my draft")]),
        ])
        let first = try FacetMutationDrafts(directory: root).envelope(
            profileID: "vault", id: id, command: command, at: "2026-10-03T00:00:00Z")
        let restarted = try FacetMutationDrafts(directory: root)
        let discovered = try restarted.pending().first
        #expect(discovered?.id == id)
        #expect(discovered?.profileID == "vault")
        #expect(try restarted.read(id: #require(discovered?.id)).mutation == first)
        #expect(
            try restarted.envelope(
                profileID: "vault", id: id, command: command, at: "2026-10-04T00:00:00Z") == first)
        #expect(throws: FacetDraftError.self) {
            try restarted.envelope(
                profileID: "other-vault", id: id, command: command, at: "2026-10-04T00:00:00Z")
        }
        #expect(throws: FacetDraftError.self) {
            try restarted.envelope(
                profileID: "vault", id: id, command: .object(["kind": .string("delete")]),
                at: "2026-10-04T00:00:00Z")
        }
        try restarted.discard(id: id)
    }
}
