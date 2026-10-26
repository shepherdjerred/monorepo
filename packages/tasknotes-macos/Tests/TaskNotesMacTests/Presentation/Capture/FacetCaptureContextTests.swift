import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Contextual mobile capture", .serialized) @MainActor
struct FacetCaptureContextTests {
    @Test func contextualCaptureKeepsItsSubmittedVaultDayAndProject() async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("context-capture-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        _ = try await context.first.refresh(profileID: profile.id)
        context.store.selectedProfileID = profile.id
        let draft = FacetCaptureDraft()
        draft.input = "Prepare slides"
        var seed: [String: FacetValue] = [
            "scheduled": .string("2026-11-02"), "projects": .array([.string("[[Launch]]")]),
        ]
        #expect(draft.begin(store: context.store, profileID: profile.id, context: seed))
        seed["scheduled"] = .string("2027-01-01")
        seed["projects"] = .array([.string("[[Other]]")])
        #expect(await draft.submit(store: context.store))
        let snapshot = try await context.first.snapshot(
            profileID: profile.id,
            query: .object(["scope": .string("all"), "limit": .integer(100)]))
        let task = try #require(snapshot.tasks.first)
        #expect(task.title == "Prepare slides")
        #expect(task.properties["scheduled"] == .string("2026-11-02"))
        #expect(task.properties["projects"] == .array([.string("[[Launch]]")]))
        #expect(snapshot.tasks.count == 1)
        try await context.close()
    }

    @Test func explicitCaptureEditsOverrideContextWithoutReinterpretingItsClock() async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("reviewed-context-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        _ = try await context.first.refresh(profileID: profile.id)
        context.store.selectedProfileID = profile.id
        let draft = FacetCaptureDraft()
        draft.input = "Review tomorrow p:Parsed"
        let seed: [String: FacetValue] = [
            "scheduled": .string("2026-11-02"), "projects": .array([.string("[[Launch]]")]),
        ]
        #expect(
            draft.begin(
                store: context.store, profileID: profile.id,
                properties: ["scheduled": .null, "projects": .array([.string("[[Reviewed]]")])],
                context: seed))
        #expect(await draft.submit(store: context.store))
        let snapshot = try await context.first.snapshot(
            profileID: profile.id,
            query: .object(["scope": .string("all"), "limit": .integer(100)]))
        let task = try #require(snapshot.tasks.first)
        #expect(task.properties["scheduled"] == nil || task.properties["scheduled"] == .null)
        #expect(task.properties["projects"] == .array([.string("[[Reviewed]]")]))
        #expect(task.properties["due"]?.text != nil)
        #expect(snapshot.tasks.count == 1)
        try await context.close()
    }
}
