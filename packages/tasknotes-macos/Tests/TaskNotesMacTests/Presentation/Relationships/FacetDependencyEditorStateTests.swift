import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Dependency metadata belongs to its original editor") @MainActor
struct FacetDependencyEditorStateTests {
    @Test func ownerLossRejectsLateMetadataAndNeverReadsAnotherVault() async throws {
        let state = FacetDependencyEditorState()
        let pause = Suspension()
        var owns = true
        var reads = 0
        let request = _Concurrency.Task {
            await state.load(
                ownsDraft: { owns },
                read: {
                    reads += 1
                    await pause.pause()
                    return metadata(defaultReltype: "STARTTOSTART")
                })
        }
        await pause.waitUntilEntered()
        owns = false
        pause.resume()
        await request.value
        #expect(state.metadata == nil && state.error != nil && !state.isLoading)
        await state.load(
            ownsDraft: { owns },
            read: {
                reads += 1
                return metadata(defaultReltype: nil)
            })
        #expect(reads == 1 && state.metadata == nil)
    }

    @Test func newerEditorAndInvalidationRejectAnOlderRead() async throws {
        let state = FacetDependencyEditorState()
        let pause = Suspension()
        let old = _Concurrency.Task {
            await state.load(
                ownsDraft: { true },
                read: {
                    await pause.pause()
                    return metadata(defaultReltype: "FINISHTOSTART")
                })
        }
        await pause.waitUntilEntered()
        await state.load(ownsDraft: { true }, read: { metadata(defaultReltype: "STARTTOSTART") })
        pause.resume()
        await old.value
        #expect(state.metadata?.defaultReltype?.rawValue == "STARTTOSTART")
        state.invalidate()
        #expect(state.metadata == nil && state.error == nil && !state.isLoading)
    }

    @Test func failureRequiresRetryAndAbsenceOfDefaultStaysExplicit() async throws {
        let state = FacetDependencyEditorState()
        await state.load(
            ownsDraft: { true }, read: { throw FacetContractError.unsupportedResponse })
        #expect(state.error != nil && state.metadata == nil)
        await state.load(ownsDraft: { true }, read: { metadata(defaultReltype: nil) })
        let loaded = try #require(state.metadata)
        #expect(state.error == nil && !state.isLoading)
        #expect(loaded.defaultReltype == nil)
        #expect(loaded.newDependency.object?.fields["reltype"] == .string(""))
    }

    @Test func retiringTheDraftWhileReadingCannotRestoreItsMetadata() async {
        let state = FacetDependencyEditorState()
        let pause = Suspension()
        let request = _Concurrency.Task {
            await state.load(
                ownsDraft: { true },
                read: {
                    await pause.pause()
                    return metadata(defaultReltype: "STARTTOSTART")
                })
        }
        await pause.waitUntilEntered()
        state.invalidate()
        pause.resume()
        await request.value
        #expect(state.metadata == nil && state.error == nil && !state.isLoading)
    }

    @Test func corruptMetadataCannotInventFallbackChoicesOrDefaults() async throws {
        let state = FacetDependencyEditorState()
        var invalid = try #require(metadata(defaultReltype: nil).object?.fields)
        invalid["defaultReltype"] = .string("BLOCKS")
        await state.load(ownsDraft: { true }, read: { .object(invalid) })
        #expect(state.error != nil && state.metadata == nil)
    }

    @Test func unrelatedExtrasKeepUnknownDependencyRecordsAndExtensions() {
        let dependencies: FacetValue = .array([
            .string("opaque-existing-record"),
            .object([
                "uid": .string("[[Target|Alias]]"), "gap": .string("P1D"),
                "reltype": .string("UNSUPPORTED-EXISTING"),
                "vendor": .object(["keep": .bool(false)]),
            ]),
        ])
        let properties: [String: FacetValue] = ["blockedBy": dependencies]
        var extras = FacetTaskExtras(properties: properties)
        extras.tags = "review"
        #expect(extras.dependencies == dependencies)
        #expect(extras.changes(from: properties)["blockedBy"] == nil)
    }

    private func metadata(defaultReltype: String?) -> FacetValue {
        .object([
            "schemaVersion": .integer(1),
            "relationshipTypes": .array(
                [
                    "FINISHTOSTART", "STARTTOSTART", "FINISHTOFINISH", "STARTTOFINISH",
                ].map(FacetValue.string)),
            "defaultReltype": defaultReltype.map(FacetValue.string) ?? .null,
        ])
    }
}
