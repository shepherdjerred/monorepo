import Foundation
import TaskNotesKit
import Testing

@testable import TaskNotesFacetUI

@MainActor
struct FacetProfileRemovalTests {
    @Test func settledConnectionResumesForegroundWithOnlyTheNewGeneration() async {
        let store = FacetStore()
        let profile = FacetProfile(
            id: "preserved", name: "Preserved", kind: "obsidian_sync", approveStandard: false)
        store.profiles = [profile]
        let original = store.syncGeneration
        store.accountTransition = true
        store.syncGeneration += 1
        var resumed = false
        await store.finishAccountConnection {
            resumed = true
            #expect(!store.accountTransition)
            #expect(store.canRetainSession(profileID: profile.id, generation: store.syncGeneration))
            #expect(!store.canRetainSession(profileID: profile.id, generation: original))
        }
        #expect(resumed)
        store.foreground = false
        store.accountTransition = true
        await store.finishAccountConnection {
            Issue.record("Background connection must not start foreground effects.")
        }
        #expect(!store.accountTransition)
    }

    @Test func accountIntentFencesBothOldAndNewOpeningGenerationsUntilDrainCompletes() async {
        let store = FacetStore()
        let profile = FacetProfile(
            id: "owned", name: "Owned", kind: "obsidian_sync", approveStandard: false)
        store.profiles = [profile]
        let original = store.syncGeneration
        store.accountTransition = true
        store.syncGeneration += 1
        await Task.yield()
        #expect(!store.canRetainSession(profileID: profile.id, generation: original))
        #expect(!store.canRetainSession(profileID: profile.id, generation: store.syncGeneration))
        store.accountTransition = false
        #expect(!store.canRetainSession(profileID: profile.id, generation: original))
        #expect(store.canRetainSession(profileID: profile.id, generation: store.syncGeneration))
    }

    @Test func delayedOpeningCannotRetainAndRejectedDomainRemovalKeepsRights() async {
        let store = FacetStore()
        let profile = FacetProfile(
            id: "owned", name: "Owned", kind: "obsidian_sync", approveStandard: false)
        store.profiles = [profile]
        let openingGeneration = store.syncGeneration
        var detached = false
        var retired = false
        var reconciled = false
        await store.removeProfileWithOperations(
            profileID: profile.id,
            operations: FacetProfileRemovalOperations(
                stop: {
                    await Task.yield()
                    #expect(
                        !store.canRetainSession(
                            profileID: profile.id, generation: openingGeneration))
                    #expect(
                        !store.canRetainSession(
                            profileID: profile.id, generation: store.syncGeneration))
                },
                removeDomain: { throw FacetDraftError.changedNote },
                detach: { detached = true }, retire: { retired = true },
                reload: {
                    Issue.record("Rejected removal must not reload deleted state.")
                    return []
                },
                ownsEngine: { true },
                reconcile: {
                    reconciled = true
                    #expect(
                        store.canRetainSession(
                            profileID: profile.id, generation: store.syncGeneration))
                    #expect(
                        !store.canRetainSession(
                            profileID: profile.id, generation: openingGeneration))
                }))
        #expect(!detached && !retired && reconciled)
        #expect(store.profiles.map(\.id) == [profile.id])
        #expect(store.error != nil)
    }

    @Test func successfulRemovalRetiresOnlyOwnerAndCompletesCleanupAfterOneFailure() async {
        let store = FacetStore()
        let owned = FacetProfile(
            id: "owned", name: "Owned", kind: "obsidian_sync", approveStandard: false)
        let other = FacetProfile(
            id: "other", name: "Other", kind: "obsidian_sync", approveStandard: false)
        store.profiles = [owned, other]
        let oldGeneration = store.syncGeneration
        var retired = false
        var reconciled = false
        await store.removeProfileWithOperations(
            profileID: owned.id,
            operations: FacetProfileRemovalOperations(
                stop: { await Task.yield() }, removeDomain: { nil },
                detach: { throw POSIXError(.EIO) }, retire: { retired = true },
                reload: { [other] }, ownsEngine: { true }, reconcile: { reconciled = true }))
        #expect(retired && reconciled)
        #expect(store.profiles.map(\.id) == [other.id])
        #expect(!store.canRetainSession(profileID: owned.id, generation: oldGeneration))
        #expect(!store.canRetainSession(profileID: owned.id, generation: store.syncGeneration))
        #expect(store.canRetainSession(profileID: other.id, generation: store.syncGeneration))
        #expect(store.error?.contains("cleanup is pending") == true)
    }
}
