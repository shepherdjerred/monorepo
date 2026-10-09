import Foundation
import Testing

@testable import TaskNotesKit

struct FacetMutationDraftTests {
    @Test func supportedUncertainActionStaysByteIdenticalUntilAuthoritativeTerminalProof() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let id = UUID().uuidString
        let drafts = try FacetMutationDrafts(directory: root)
        _ = try drafts.envelope(
            profileID: "vault", id: id,
            command: .object([
                "kind": .string("create"), "properties": .object(["title": .string("Uncertain")]),
            ]),
            at: "2026-10-03T12:00:00Z")
        let file = root.appendingPathComponent(id + ".json")
        let bytes = try Data(contentsOf: file)
        let saved = try drafts.read(id: id)
        let schema = try FacetSchema.bundled()
        #expect(saved.canResume)
        let pending = FacetValue.object([
            "schemaVersion": .integer(1), "mutationId": .string(id),
            "state": .string("pending"), "receipt": .null,
        ])
        #expect(throws: FacetDraftError.changedNote) {
            try FacetRetainedActions.validateRetirement(saved, outcome: pending, schema: schema)
        }
        #expect(try Data(contentsOf: file) == bytes)
        let parked = FacetValue.object([
            "schemaVersion": .integer(1), "mutationId": .string(id), "state": .string("parked"),
            "receipt": .object([
                "schemaVersion": .integer(1), "mutationId": .string(id), "applied": .bool(false),
                "taskPath": .null, "cleanupPending": .bool(false), "paths": .array([]),
                "pendingCount": .integer(0), "diagnostics": .array([]),
            ]),
        ])
        try FacetRetainedActions.validateRetirement(saved, outcome: parked, schema: schema)
        #expect(try Data(contentsOf: file) == bytes)
    }

    @Test func retiredActionRemainsByteIdenticalUntilExplicitSafeRetirement() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let id = UUID().uuidString
        let drafts = try FacetMutationDrafts(directory: root)
        _ = try drafts.envelope(
            profileID: "vault", id: id,
            command: .object(["kind": .string("start_time"), "path": .string("Tasks/a.md")]),
            at: "2026-10-03T12:00:00Z")
        let path = root.appendingPathComponent(id + ".json")
        let before = try Data(contentsOf: path)
        let saved = try #require(drafts.pending().first)
        let schema = try FacetSchema.bundled()
        try schema.validate(saved.mutation, definition: "retainedMutation")
        #expect(!saved.canResume)
        #expect(try Data(contentsOf: path) == before)
        let pending = FacetValue.object([
            "schemaVersion": .integer(1), "mutationId": .string(id),
            "state": .string("pending"), "receipt": .null,
        ])
        #expect(throws: FacetDraftError.self) {
            try FacetRetainedActions.validateRetirement(saved, outcome: pending, schema: schema)
        }
        #expect(try Data(contentsOf: path) == before)
        let absent = FacetValue.object([
            "schemaVersion": .integer(1), "mutationId": .string(id),
            "state": .string("absent"), "receipt": .null,
        ])
        try FacetRetainedActions.validateRetirement(saved, outcome: absent, schema: schema)
        let wrong = FacetValue.object([
            "schemaVersion": .integer(1), "mutationId": .string(UUID().uuidString),
            "state": .string("absent"), "receipt": .null,
        ])
        #expect(throws: FacetContractError.self) {
            try FacetRetainedActions.validateRetirement(saved, outcome: wrong, schema: schema)
        }
        try drafts.discard(id: id)
        #expect(try drafts.pending().isEmpty)
    }

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
