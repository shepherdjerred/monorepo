import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit

struct FacetTrackingPlanTests {
    @Test func invalidProducerCannotReplaceExistingActivities() async throws {
        let original = try #require(
            Self.page(path: "Tasks/a.md", next: false, total: 1).object?.fields)
        let invalidFields: [(String, FacetValue)] = [
            ("schemaVersion", .integer(2)),
            ("schemaVersion", .rawNumber("1.0000000000000000001")),
            ("at", .string("2026-10-04T12:00:01Z")),
            ("at", .string("2026-10-04T12:00:00.000000001Z")),
            ("version", .rawNumber("3.0000000000000000001")),
            ("futureField", .bool(true)),
        ]
        for (key, value) in invalidFields {
            var page = original
            page[key] = value
            let response = FacetValue.object(page)
            await #expect(throws: FacetContractError.self) {
                try await FacetTrackingPlanReader.read(
                    profileID: "owner", at: "2026-10-04T12:00:00Z", maximumRows: 8,
                    fetch: { _ in response })
            }
        }
        let originalRow = try #require(original["rows"]?.array?.elements.first?.object?.fields)
        for (key, value) in [
            ("sessionId", "facet-tracking:invalid"), ("taskRevision", "invalid"),
            ("taskPath", "../outside.md"), ("startedAt", "invalid"),
        ] {
            var row = originalRow
            row[key] = .string(value)
            var page = original
            page["rows"] = .array([.object(row)])
            let response = FacetValue.object(page)
            await #expect(throws: FacetContractError.self) {
                try await FacetTrackingPlanReader.read(
                    profileID: "owner", at: "2026-10-04T12:00:00Z", maximumRows: 8,
                    fetch: { _ in response })
            }
        }
        var equivalent = original
        equivalent["at"] = .string("2026-10-04T08:00:00-04:00")
        let response = FacetValue.object(equivalent)
        let plan = try await FacetTrackingPlanReader.read(
            profileID: "owner", at: "2026-10-04T12:00:00Z", maximumRows: 8,
            fetch: { _ in response })
        #expect(plan.rows.count == 1)
    }

    @Test func completePagesFreezeClockOwnerAndRevisionBeforeAnOSReplacement() async throws {
        let calls = Mutex<[FacetValue]>([])
        let plan = try await FacetTrackingPlanReader.read(
            profileID: "owner", at: "2026-10-04T12:00:00Z", maximumRows: 1,
            retain: { $0.taskPath == "Tasks/b.md" },
            fetch: { request in
                calls.withLock { $0.append(request) }
                if request.object?.fields["after"] == nil {
                    return Self.page(path: "Tasks/a.md", next: true)
                }
                return Self.page(path: "Tasks/b.md", next: false)
            })
        #expect(plan.totalCount == 2)
        #expect(plan.rows.map(\.taskPath) == ["Tasks/b.md"])
        #expect(calls.withLock { $0.count } == 2)
        let second = calls.withLock { $0.last?.object?.fields }
        #expect(second?["at"] == .string("2026-10-04T12:00:00Z"))
        #expect(second?["expectedVersion"] == .unsigned(3))
        #expect(second?["after"]?.object?.fields["at"] == second?["at"])
        await #expect(throws: FacetContractError.self) {
            try await FacetTrackingPlanReader.read(
                profileID: "owner", at: "2026-10-04T12:00:00Z", maximumRows: 8,
                fetch: { request in
                    if request.object?.fields["after"] == nil {
                        return Self.page(path: "Tasks/a.md", next: true)
                    }
                    return Self.page(path: "Tasks/b.md", next: false, owner: "foreign")
                })
        }
    }

    @Test func durableStopKeepsOwnerSessionRevisionAndRejectsAReplacementSession() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let queue = try FacetIntentQueue(directory: root)
        try queue.selectProfile("owner")
        let stop = try queue.enqueueTrackingStop(
            profileID: "owner", engineIdentity: String(repeating: "d", count: 64),
            sessionID: "facet-tracking:" + String(repeating: "a", count: 64),
            taskPath: "Tasks/a.md", taskRevision: String(repeating: "b", count: 64),
            at: try Date.ISO8601FormatStyle().parse("2026-10-04T12:00:00Z"))
        try queue.selectProfile("foreign")
        let reopened = try FacetIntentQueue(directory: root)
        let retained = try #require(try reopened.pendingTrackingStops().first)
        #expect(retained.profileID == "owner")
        #expect(retained.id == stop.id && retained.at == stop.at)
        #expect(retained.command.object?.fields["expectedRevision"] == .string(stop.taskRevision))
        let plan = try await FacetTrackingPlanReader.read(
            profileID: "owner", at: stop.at, maximumRows: 8,
            fetch: { _ in Self.page(path: "Tasks/a.md", next: false, total: 1) })
        try retained.requireCurrent(plan, engineIdentity: String(repeating: "d", count: 64))
        #expect(throws: FacetTrackingStopError.self) {
            try retained.requireCurrent(plan, engineIdentity: String(repeating: "e", count: 64))
        }
        let changed = try await FacetTrackingPlanReader.read(
            profileID: "owner", at: stop.at, maximumRows: 8,
            fetch: { _ in Self.page(path: "Tasks/a.md", next: false, total: 1, session: "c") })
        #expect(throws: FacetTrackingStopError.self) {
            try retained.requireCurrent(changed, engineIdentity: String(repeating: "d", count: 64))
        }
        try reopened.acknowledgeTrackingStop(id: retained.id)
        #expect(try reopened.pendingTrackingStops().isEmpty)
    }

    private static func page(
        path: String, next: Bool, owner: String = "owner", total: UInt64 = 2, session: String = "a"
    ) -> FacetValue {
        let at = FacetValue.string("2026-10-04T12:00:00Z")
        return .object([
            "schemaVersion": .integer(1), "profileId": .string(owner), "version": .integer(3),
            "at": at, "totalCount": .unsigned(total),
            "rows": .array([
                .object([
                    "sessionId": .string("facet-tracking:" + String(repeating: session, count: 64)),
                    "taskPath": .string(path), "title": .string("Tracking"),
                    "taskRevision": .string(String(repeating: "b", count: 64)),
                    "startedAt": .string("2026-10-04T11:00:00Z"),
                    "elapsedSeconds": .integer(3600), "state": .string("running"),
                    "projectLabels": .array([]),
                ])
            ]),
            "nextCursor": next ? .object(["taskPath": .string(path), "at": at]) : .null,
            "problemCount": .integer(0), "problems": .array([]),
        ])
    }
}
