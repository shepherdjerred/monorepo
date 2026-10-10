import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Native capture ownership", .serialized) @MainActor
struct FacetCaptureDraftTests {
    @Test func hiddenPanelBufferVetoesLifecycleUntilExplicitDiscard() async throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let draft = FacetCaptureDraft()
        let coordinator = FacetDraftCoordinator()
        draft.registerLifecycle(
            store: store, profileID: FacetSurfaceFixtures.profileID, coordinator: coordinator)
        #expect(await coordinator.flushAll())
        draft.input = "Retained while the reusable panel is hidden"
        #expect(!(await coordinator.flushAll()))
        #expect(draft.input == "Retained while the reusable panel is hidden")
        #expect(await draft.discard(store: store))
        #expect(await coordinator.flushAll())
    }

    @Test func synchronousAdmissionRejectsOverlapAndPreservesNewerText() async throws {
        let context = try await StoreContext.open()
        let profile = try await registerVault(context)
        let draft = FacetCaptureDraft()
        draft.input = "First capture"
        #expect(draft.begin(store: context.store, profileID: profile.id))
        #expect(draft.isSubmitting && !draft.canSubmit)
        #expect(!draft.begin(store: context.store, profileID: profile.id))
        draft.input = "Newer capture"
        #expect(await draft.submit(store: context.store))
        #expect(draft.input == "Newer capture")
        #expect(!draft.hasRetainedSubmission && draft.canSubmit)
        let page = try await snapshot(context.first, profileID: profile.id)
        #expect(page.tasks.count == 1)
        #expect(page.tasks.first?.title == "First capture")
        #expect(draft.begin(store: context.store, profileID: profile.id))
        #expect(await draft.submit(store: context.store))
        #expect(draft.input.isEmpty)
        #expect(try await snapshot(context.first, profileID: profile.id).tasks.count == 2)
        try await context.close()
    }

    @Test func changedOwnerFailsBeforeDurableAdmissionAndRemainsEditable() async throws {
        let context = try await StoreContext.open()
        let profile = try await registerVault(context)
        let draft = FacetCaptureDraft()
        draft.input = "Original owner"
        #expect(draft.begin(store: context.store, profileID: profile.id))
        context.store.selectedProfileID = "other-vault"
        #expect(!(await draft.submit(store: context.store)))
        #expect(draft.admittedMutationID == nil)
        #expect(!draft.hasRetainedSubmission && draft.canSubmit)
        #expect(draft.input == "Original owner")
        #expect(try await context.first.pendingMutations().isEmpty)
        context.store.selectedProfileID = profile.id
        #expect(draft.begin(store: context.store, profileID: profile.id))
        #expect(await draft.submit(store: context.store))
        #expect(try await snapshot(context.first, profileID: profile.id).tasks.count == 1)
        try await context.close()
    }

    @Test func explicitEmptyNotesAndParsedMetadataRemovalFreezeAtAdmission() async throws {
        let context = try await StoreContext.open()
        let profile = try await registerVault(context)
        let draft = FacetCaptureDraft()
        draft.input = "Reviewed tomorrow p:Home #work"
        var overrides: [String: FacetValue] = [
            "title": .string(""), "due": .null, "projects": .array([]), "tags": .array([]),
        ]
        #expect(
            draft.begin(
                store: context.store, profileID: profile.id, properties: overrides, body: ""))
        overrides["due"] = .string("2027-01-01")
        draft.input = "Newer notes and tomorrow p:Work"
        #expect(!(await draft.submit(store: context.store)))
        let pending = try #require(await context.first.pendingMutations().first)
        let command = try #require(pending.mutation.object?.fields["command"]?.object?.fields)
        let properties = try #require(command["properties"]?.object?.fields)
        #expect(command["body"] == .string(""))
        #expect(properties["due"] == .null)
        #expect(properties["projects"] == .array([]) && properties["tags"] == .array([]))
        #expect(draft.input == "Newer notes and tomorrow p:Work")
        #expect(draft.admittedMutationID == pending.id)
        try await context.close()
    }

    @Test func metadataOnlyInputStaysEditableWithoutDurableAdmission() async throws {
        let context = try await StoreContext.open()
        let profile = try await registerVault(context)
        let draft = FacetCaptureDraft()
        draft.input = "tomorrow p:Work"
        #expect(draft.begin(store: context.store, profileID: profile.id))
        #expect(!(await draft.submit(store: context.store)))
        #expect(draft.admittedMutationID == nil && !draft.hasRetainedSubmission)
        #expect(draft.input == "tomorrow p:Work" && draft.canSubmit)
        #expect(try await context.first.pendingMutations().isEmpty)
        #expect(try await snapshot(context.first, profileID: profile.id).tasks.isEmpty)
        try await context.close()
    }

    @Test func admittedRejectedCreateKeepsExactEnvelopeAndRequiresOwnedRecovery() async throws {
        let context = try await StoreContext.open()
        let profile = try await registerVault(context)
        let draft = FacetCaptureDraft()
        draft.input = "Reviewed capture"
        #expect(
            draft.begin(
                store: context.store, profileID: profile.id, properties: ["title": .string("")]))
        #expect(!(await draft.submit(store: context.store)))
        let id = try #require(draft.admittedMutationID)
        let pending = try #require(await context.first.pendingMutations().first)
        #expect(pending.id == id && pending.profileID == profile.id)
        let command = try #require(pending.mutation.object?.fields["command"])
        // The exact submitted action sorts after a complete page of other drafts.
        let drafts = try FacetMutationDrafts(
            directory: context.directory.appendingPathComponent("first/action-drafts"))
        for index in 1...128 {
            let digits = String(index, radix: 16)
            let suffix = String(repeating: "0", count: 12 - digits.count) + digits
            _ = try drafts.envelope(
                profileID: profile.id, id: "00000000-0000-0000-0000-" + suffix,
                command: .object([
                    "kind": .string("create"),
                    "properties": .object(["title": .string("Unrelated retained capture")]),
                ]),
                at: "2026-10-08T12:00:00Z")
        }
        draft.input = "Newer unsent capture"
        #expect(!draft.begin(store: context.store, profileID: profile.id))
        #expect(!(await draft.discard(store: context.store)))
        #expect(draft.input == "Newer unsent capture")
        #expect(
            try drafts.read(id: id).mutation.object?.fields["command"]
                == command)
        try await context.first.retireSavedMutation(id: id)
        #expect(await draft.discard(store: context.store))
        #expect(!draft.hasRetainedSubmission && draft.admittedMutationID == nil)
        #expect(draft.input.isEmpty)
        try await context.close()
    }

    private func snapshot(_ engine: FacetEngine, profileID: String) async throws -> FacetSnapshot {
        try await engine.snapshot(
            profileID: profileID,
            query: .object([
                "schemaVersion": .integer(1), "scope": .string("all"), "offset": .integer(0),
                "limit": .integer(100), "includeArchived": .bool(true),
            ]))
    }

    private func registerVault(_ context: StoreContext) async throws -> FacetProfile {
        let vault = context.directory.appendingPathComponent("capture-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        _ = try await context.first.refresh(profileID: profile.id)
        context.store.selectedProfileID = profile.id
        return profile
    }
}
