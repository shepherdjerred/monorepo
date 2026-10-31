import Foundation
import Testing

@testable import TaskNotesKit

struct FacetOccurrenceProjectionTests {
    private let revision = String(repeating: "a", count: 64)

    @Test func rollingPlanPreservesUnsignedCursorVersionAndCommandOrigin() throws {
        let schema = try FacetSchema.bundled()
        let version = UInt64.max
        let target = FacetValue.object([
            "parentPath": .string("Tasks/series.md"), "expectedParentRevision": .string(revision),
            "referenceDate": .string("2026-10-24"), "start": .string("2026-10-24"),
            "end": .string("2026-11-24"),
        ])
        let value = FacetValue.object([
            "schemaVersion": .integer(1), "profileId": .string("vault"),
            "version": .unsigned(version), "referenceDate": .string("2026-10-24"),
            "inspectedCount": .integer(1), "targets": .array([target]), "problems": .array([]),
            "nextCursor": .object([
                "lastPath": .string("Tasks/series.md"), "referenceDate": .string("2026-10-24"),
                "version": .unsigned(version), "binding": .string(revision),
            ]),
        ])
        try schema.validate(value, definition: "rollingMaintenancePlan")
        let plan = try FacetFeatureProjection.decode(FacetRollingMaintenancePlan.self, from: value)
        #expect(plan.version == version)
        #expect(plan.nextCursor?.object?.fields["version"] == .unsigned(version))
        let decoded = try #require(plan.targets.first)
        try schema.validate(decoded.command(), definition: "command")
        try schema.validate(decoded.command(automatic: true), definition: "command")
        #expect(decoded.command().object?.fields["origin"] == .string("user"))
        #expect(
            decoded.command(automatic: true).object?.fields["origin"]
                == .string("automatic_maintenance"))
        var unknown = try #require(decoded.command().object?.fields)
        unknown["origin"] = .string("bypass_undo")
        #expect(throws: (any Error).self) {
            try schema.validate(.object(unknown), definition: "command")
        }
    }

    @Test func deferredRepairRetainsExactCoreCommandAndRejectsUnknownActions() throws {
        let schema = try FacetSchema.bundled()
        let command = FacetValue.object([
            "kind": .string("repair_occurrence_progression"),
            "progressionId": .string("occprogress:" + revision),
            "expectedParentRevision": .string(revision), "expectedChildRevision": .string(revision),
        ])
        let item = FacetValue.object([
            "kind": .string("deferred_progression"),
            "successorId": .string("occprogress:" + revision),
            "parentPath": .string("Tasks/series.md"), "childPath": .string("Tasks/child.md"),
            "completedOccurrenceDate": .string("2026-10-24"), "childState": .string("completed"),
            "occurrenceDate": .null, "parentProjectionOwed": .bool(true),
            "successorDiscoveryOwed": .bool(true), "state": .string("failed"),
            "failure": .object(["code": .string("conflict"), "message": .string("Parent changed")]),
            "resolution": .null,
        ])
        var value: [String: FacetValue] = [
            "schemaVersion": .integer(1), "profileId": .string("vault"), "version": .integer(1),
            "inspectedCount": .integer(1), "nextCursor": .null,
            "items": .array([
                .object([
                    "primaryMutationId": .string("completed"), "item": item,
                    "action": .object(["kind": .string("repairable"), "command": command]),
                ])
            ]),
        ]
        try schema.validate(.object(value), definition: "generationFailuresPlan")
        let plan = try FacetFeatureProjection.decode(
            FacetGenerationFailuresPlan.self, from: .object(value))
        #expect(plan.items.first?.action.command == command)
        #expect(plan.items.first?.item.childPath == "Tasks/child.md")
        value["unexpected"] = .bool(true)
        #expect(throws: (any Error).self) {
            try schema.validate(.object(value), definition: "generationFailuresPlan")
        }
    }
}
