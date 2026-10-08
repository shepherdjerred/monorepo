import AppKit
import Foundation
import SwiftUI
import TaskNotesKit
import Testing

@testable import TaskNotesFacetUI

@Suite(.serialized)
@MainActor
struct FacetConflictPresentationTests {
    enum OwnershipChange: CaseIterable {
        case profile, profileABA, lifecycle, engine, removal, failure
    }

    @Test(arguments: OwnershipChange.allCases)
    func suspendedConflictResultCannotPublishIntoAnotherOwner(change: OwnershipChange) async {
        let store = FacetStore()
        store.selectedProfileID = "owner"
        store.error = "Current presentation"
        var ownsEngine = true
        var published = false
        let current = store.conflictPresentationFence(profileID: "owner") { ownsEngine }
        let result = await store.loadConflictPresentation(
            profileID: "owner", ownsEngine: { ownsEngine },
            load: {
                await Task.yield()
                switch change {
                case .profile: store.selectedProfileID = "different"
                case .profileABA:
                    store.selectedProfileID = "different"
                    store.requestGeneration += 1
                    store.selectedProfileID = "owner"
                case .lifecycle: store.syncGeneration += 1
                case .engine: ownsEngine = false
                case .removal: store.removingProfileIDs.insert("owner")
                case .failure:
                    store.requestGeneration += 1
                    throw CancellationError()
                }
                return "Stale text"
            },
            present: { _ in published = true })
        #expect(result == nil)
        #expect(!current())
        #expect(!published)
        #expect(store.error == "Current presentation")
    }

    @Test func conflictAdmissionReservesIdentityBeforeSuspendingAndRejectsOverlap() async {
        let store = FacetStore()
        let id = UUID().uuidString
        let completed = await store.runConflictDecision(mutationID: id) {
            await Task.yield()
            #expect(store.isSaving && store.activeMutationID == id)
            let overlapping = await store.runConflictDecision(mutationID: UUID().uuidString) {
                Issue.record("Overlapping conflict operation must not start.")
                return true
            }
            #expect(!overlapping)
            #expect(store.activeMutationID == id)
            return false
        }
        #expect(!completed)
        #expect(!store.isSaving && store.activeMutationID == nil)
    }

    @Test func submittedTextFreezesOwnerBytesAndAllRevisionFences() throws {
        let conflict = try fixture()
        let text = "---\nstatus: open\n---\nA resolved note.\n"
        let decision = try FacetConflictDecision(
            profileID: "original-profile", conflict: conflict, text: text)
        let store = FacetStore()
        store.selectedProfileID = "different-profile"
        let command = store.conflictCommand(conflict, resolution: decision.resolution)
        #expect(decision.profileID == "original-profile")
        #expect(decision.payload == Data(text.utf8))
        #expect(
            command["expectedRevisions"]?.object?.fields["current"]
                == .string(conflict.currentRevision ?? ""))
        #expect(command["expectedRevisions"]?.object?.fields["base"] == .null)
        try FacetSchema.bundled().validate(.object(command), definition: "command")
        let both = FacetConflictDecision(
            profileID: "original-profile", conflict: conflict, newPath: "Notes/Other version.md")
        try FacetSchema.bundled().validate(
            .object(store.conflictCommand(conflict, resolution: both.resolution)),
            definition: "command")
        #expect(both.payload == nil)
        #expect(both.conflict.remote?.revision == conflict.remote?.revision)
    }

    @Test func textCapCountsUtf8BeforeAllocatingPayload() throws {
        let conflict = try fixture()
        // Multi-byte characters exceed the byte cap with fewer than 1 MiB characters.
        let oversized = String(repeating: "é", count: Int(FacetRetainedText.maximumBytes / 2) + 1)
        #expect(throws: FacetConflictEditorError.self) {
            try FacetConflictDecision(profileID: "owner", conflict: conflict, text: oversized)
        }
        let exact = String(repeating: "x", count: Int(FacetRetainedText.maximumBytes))
        let decision = try FacetConflictDecision(
            profileID: "owner", conflict: conflict, text: exact)
        #expect(decision.payload?.count == exact.utf8.count)
    }

    @Test(arguments: SnapshotAppearance.allCases)
    func inboxRendersExactExportAndCappedEditing(appearance: SnapshotAppearance) throws {
        let store = FacetStore()
        store.selectedProfileID = "original-profile"
        store.conflicts = [try fixture()]
        try record(
            FacetConflictInbox(store: store)
                .environment(\.locale, Locale(identifier: "en_US_POSIX"))
                .environment(\.timeZone, .gmt),
            named: "facet-conflict-inbox", size: CGSize(width: 760, height: 520),
            appearance: appearance)
    }

    @Test(arguments: [false, true], SnapshotAppearance.allCases)
    func resolutionFormRendersOffscreen(editingText: Bool, appearance: SnapshotAppearance) throws {
        let store = FacetStore()
        let conflict = try fixture()
        let view = FacetConflictForm(
            store: store, profileID: "original-profile", conflict: conflict,
            initialText: editingText ? "---\nstatus: open\n---\nResolved note.\n" : nil,
            saved: {}
        )
        .environment(\.locale, Locale(identifier: "en_US_POSIX"))
        .environment(\.timeZone, .gmt)
        let name = editingText ? "facet-conflict-edit" : "facet-conflict-keep-both"
        for width in [540, 360] {
            try record(
                view, named: "\(name)-\(width)", size: CGSize(width: width, height: 620),
                appearance: appearance)
        }
    }

    private func fixture() throws -> FacetConflict {
        let hash = String(repeating: "a", count: 64)
        let other = String(repeating: "b", count: 64)
        return try JSONDecoder().decode(
            FacetConflict.self,
            from: Data(
                """
                {"id":"conflict-1","path":"Notes/Plan.md","base":null,
                "local":{"size":42,"revision":"\(hash)"},
                "remote":{"size":208666624,"revision":"\(other)"},
                "remoteRevision":"remote-uid","currentRevision":"\(hash)"}
                """.utf8))
    }
}
