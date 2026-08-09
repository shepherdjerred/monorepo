import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The `/v2` wire vocabulary, in isolation.
///
/// These are unit tests for a file that should not exist — see the header of
/// `WireBridge.swift`. They earn their keep twice over anyway: they pin the
/// behaviour the core's `wire.rs` already has, so a future deletion can be
/// checked against them rather than eyeballed.
@Suite("Wire bridge")
struct WireBridgeTests {
    @Test("the rename table is applied inbound")
    func theRenameTableIsAppliedInbound() throws {
        let task = try WireBridge.task(
            fromWire: [
                "path": "Tasks/a.md",
                "title": "Write the plan",
                "status": "in-progress",
                "priority": "high",
                "recurrence_anchor": "completion",
                "complete_instances": ["2026-08-01"],
                "skipped_instances": ["2026-08-02"],
            ]
        )

        #expect(task.recurrenceAnchor == .completion)
        #expect(task.completeInstances == ["2026-08-01"])
        #expect(task.skippedInstances == ["2026-08-02"])
        #expect(task.status == .inProgress)
        #expect(task.priority == .high)
    }

    @Test("the identity is the vault path")
    func theIdentityIsTheVaultPath() throws {
        let fromPath = try WireBridge.task(
            fromWire: ["path": "Tasks/a.md", "title": "Alpha"]
        )
        #expect(fromPath.id == "Tasks/a.md")
        #expect(fromPath.path == "Tasks/a.md")

        // `id` is only a fallback for the one endpoint that omits `path`.
        let fromId = try WireBridge.task(
            fromWire: ["path": "", "id": "Tasks/b.md", "title": "Beta"]
        )
        #expect(fromId.id == "Tasks/b.md")
    }

    @Test("a task with no usable identity is rejected by the core")
    func anUnidentifiableTaskIsRejected() {
        // Left empty on purpose so the core rejects it, rather than being
        // papered over in Swift where the failure would be invisible.
        #expect(throws: CoreError.self) {
            try WireBridge.task(fromWire: ["path": "", "title": "Nameless"])
        }
    }

    @Test("a task id that is not a markdown path is rejected by the core")
    func aNonMarkdownIdIsRejected() {
        #expect(throws: CoreError.self) {
            try WireBridge.task(fromWire: ["path": "Tasks/a.txt", "title": "Alpha"])
        }
    }

    @Test("the rename table is applied outbound on a create")
    func theRenameTableIsAppliedOutboundOnCreate() throws {
        var request = createRequest(title: "Standup", status: .open)
        request.recurrence = "FREQ=DAILY"
        request.recurrenceAnchor = .scheduled
        request.extraFields = #"{"area":"work"}"#

        let body = try WireBridge.body(forCreate: request)

        #expect(body["title"] as? String == "Standup")
        #expect(body["status"] as? String == "open")
        #expect(body["recurrence_anchor"] as? String == "scheduled")
        #expect(body["customProperties"] as? [String: String] == ["area": "work"])
        // The domain spellings must not survive: the server does not know them.
        #expect(body["recurrenceAnchor"] == nil)
        #expect(body["extraFields"] == nil)
    }

    @Test("an absent create field is omitted, never sent as null")
    func absentCreateFieldsAreOmitted() throws {
        let body = try WireBridge.body(forCreate: createRequest(title: "Bare"))
        #expect(body.keys.sorted() == ["title"])
        // `null` is the server's instruction to *delete* a frontmatter key.
        // Sending it on a create would be a different request entirely.
        #expect(body["due"] == nil)
    }

    @Test("an update keeps the core's three-state distinction")
    func anUpdateKeepsItsThreeStates() throws {
        // Absent, explicit-null, and a value are three different instructions.
        // The distinction is the core's and is exercised here through
        // `updateTaskRequestToJson`, not re-implemented.
        let request = try updateTaskRequestFromJson(
            json: #"{"due":null,"scheduled":"2026-08-08"}"#
        )
        let body = try WireBridge.body(forUpdate: request)

        #expect(body["due"] is NSNull)
        #expect(body["scheduled"] as? String == "2026-08-08")
        #expect(body["title"] == nil)
    }

    @Test("a successful envelope yields its payload")
    func aSuccessfulEnvelopeYieldsItsPayload() throws {
        let unwrapped = try WireBridge.unwrapEnvelope(
            ["success": true, "data": ["title": "Alpha"]]
        )
        #expect((unwrapped as? [String: Any])?["title"] as? String == "Alpha")
    }

    @Test("a failed envelope becomes an Api error with status 0")
    func aFailedEnvelopeBecomesAnApiError() throws {
        // Status 0 is deliberate and matches the core: an envelope failure
        // carries no HTTP status of its own, and inventing one would make the
        // sync layer's classifier retry or dead-letter on a fiction.
        let thrown = #expect(throws: CoreError.self) {
            try WireBridge.unwrapEnvelope(["success": false, "error": "Task not found"])
        }
        #expect(thrown == .Api(message: "Task not found", status: 0))
    }

    @Test("a bare payload passes through untouched")
    func aBarePayloadPassesThrough() throws {
        // Most endpoints answer with a bare payload; treating one as a broken
        // envelope would reject every successful response.
        let unwrapped = try WireBridge.unwrapEnvelope(["title": "Alpha"])
        #expect((unwrapped as? [String: Any])?["title"] as? String == "Alpha")
    }

    @Test("the rename table has exactly four entries and no duplicates")
    func theRenameTableIsExactlyFourEntries() {
        // Four, and the only four — the core says so in `WIRE_FIELD_RENAMES`.
        // Everything else is spelled identically on both sides, which is why
        // this is a lookup and not a case transform.
        #expect(WireBridge.fieldRenames.count == 4)
        #expect(Set(WireBridge.fieldRenames.map(\.domain)).count == 4)
        #expect(Set(WireBridge.fieldRenames.map(\.wire)).count == 4)
    }
}
