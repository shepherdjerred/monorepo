import Foundation
import Testing

@testable import TaskNotesKit

struct FacetProfileRemovalEngineTests {
    @Test func pendingReplicaMutationRejectsRemovalWithoutRevokingFilesOrProfile() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let engine = try await FacetEngine.open(directory: root)
        let profile = try await engine.registerReplica(
            id: UUID().uuidString, name: "Private replica")
        try await engine.approveStandard(profile: profile)
        _ = try await engine.refresh(profileID: profile.id)
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("create"),
                "properties": .object(["title": .string("Retained local edit")]),
            ]))
        #expect(try await engine.hasPendingUploads(profileID: profile.id))
        do {
            _ = try await engine.removeProfile(id: profile.id)
            Issue.record("Pending replica bytes must prevent profile removal.")
        } catch {
            #expect(FacetFailureDiagnostic(error).classification == "conflict")
        }
        #expect(try await engine.profiles().contains { $0.id == profile.id })
        let refreshed = try await engine.refresh(profileID: profile.id)
        #expect(refreshed.tasks.first?.title == "Retained local edit")
        #expect(try await engine.hasPendingUploads(profileID: profile.id))
    }
}
