import Foundation
import Testing

@testable import TaskNotesKit

struct FacetPayloadCleanupTests {
    @Test func orphanCleanupRequiresDurableObservedReceipt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let drafts = try FacetMutationDrafts(directory: root.appendingPathComponent("drafts"))
        let payloads = FacetPayloadDrafts(directory: root.appendingPathComponent("drafts"))
        let observed = try FacetActionObservations(
            directory: root.appendingPathComponent("observed"))
        let savedID = UUID().uuidString
        let uncertainID = UUID().uuidString
        try payloads.prepare(id: savedID, bytes: Data([1, 2, 3]))
        try payloads.prepare(id: uncertainID, bytes: Data([4, 5, 6]))
        let saved = FacetPendingMutation(
            profileID: "vault", id: savedID,
            mutation: .object([
                "command": .object(["kind": .string("resolve_conflict")])
            ]))
        try observed.observe(
            saved,
            receipt: .object([
                "applied": .bool(true), "paths": .array([.string("task.md")]),
            ]))
        for id in try drafts.orphanPayloadIDs() where try observed.hasObserved(id) {
            try drafts.discard(id: id)
        }
        #expect(try drafts.orphanPayloadIDs() == [uncertainID])
        #expect(try payloads.read(id: uncertainID, maximumSize: 3) == Data([4, 5, 6]))
    }
}
