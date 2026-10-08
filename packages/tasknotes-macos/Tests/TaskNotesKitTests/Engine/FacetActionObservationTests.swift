import Foundation
import Testing

@testable import TaskNotesKit

struct FacetActionObservationTests {
    @Test func replayedUndoDoesNotConsumeTheNextReceiptAfterRestart() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let first = action("create")
        let second = action("update")
        let receipt = FacetValue.object([
            "applied": .bool(true), "paths": .array([.string("task.md")]),
        ])
        let history = try FacetActionObservations(directory: root)
        try history.observe(first, receipt: receipt)
        try history.observe(second, receipt: receipt)
        let undo = action("undo", target: second.id)
        try history.observe(undo, receipt: receipt)
        let reopened = try FacetActionObservations(directory: root)
        try reopened.observe(undo, receipt: receipt)
        try reopened.observe(second, receipt: receipt)
        #expect(try reopened.lastUndo(profileID: "vault") == first.id)
    }

    private func action(_ kind: String, target: String? = nil) -> FacetPendingMutation {
        var command: [String: FacetValue] = ["kind": .string(kind)]
        if let target { command["receiptId"] = .string(target) }
        let id = UUID().uuidString
        return FacetPendingMutation(
            profileID: "vault", id: id,
            mutation: .object([
                "mutationId": .string(id), "command": .object(command),
            ]))
    }
}
