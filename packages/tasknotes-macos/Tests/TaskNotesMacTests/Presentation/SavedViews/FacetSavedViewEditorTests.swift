import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Saved-view editor preservation", .serialized) @MainActor
struct FacetSavedViewEditorTests {
    @Test func newViewStartsFromAllActiveTasksInsteadOfTheBrowseWindowsInbox() throws {
        let editor = try FacetSavedViewEditorModel.fresh(id: "fresh", order: 3)
        #expect(editor.isNew && !editor.hasChanges && !editor.canSave)
        #expect(editor.query["scope"] == .string("all"))
        #expect(editor.query["completed"] == .bool(false))
        #expect(editor.query["hasNoProject"] == nil)
        editor.name = "Project work"
        editor.query["projects"] = .array([.string("[[Launch]]")])
        #expect(editor.canSave && editor.hasChanges)
        #expect(editor.value["query"]?.object?.fields["scope"] == .string("all"))
        #expect(
            editor.value["query"]?.object?.fields["projects"] == .array([.string("[[Launch]]")]))
        #expect(editor.value["symbol"] == .string("tray"))
        #expect(editor.value["tint"] == .string("#0a84ff"))
    }

    @Test func editingMetadataPreservesTheActualViewsQueryAndUnknownMembers() throws {
        let query: [String: FacetValue] = [
            "scope": .string("all"), "projects": .array([.string("[[Launch]]")]),
            "completed": .bool(true), "sortField": .string("priority"),
            "vendorQuery": .object(["enabled": .bool(false)]), "offset": .integer(100),
        ]
        let original: [String: FacetValue] = [
            "name": .string("Completed launch work"), "query": .object(query),
            "symbol": .string("custom.existing.symbol"), "tint": .string("#aabbcc"),
            "favorite": .bool(false), "order": .integer(7),
            "vendorMetadata": .array([.string("keep"), .integer(42)]),
        ]
        let editor = try FacetSavedViewEditorModel(id: "launch", fields: original, isNew: false)
        #expect(!editor.hasChanges)
        editor.name = "Reviewed launch work"
        editor.favorite = true
        let edited = editor.value
        #expect(editor.hasChanges && editor.canSave)
        #expect(edited["order"] == original["order"])
        #expect(edited["vendorMetadata"] == original["vendorMetadata"])
        #expect(edited["symbol"] == original["symbol"] && edited["tint"] == original["tint"])
        #expect(edited["query"]?.object?.fields["projects"] == query["projects"])
        #expect(edited["query"]?.object?.fields["completed"] == .bool(true))
        #expect(edited["query"]?.object?.fields["vendorQuery"] == query["vendorQuery"])
        #expect(edited["query"]?.object?.fields["offset"] == nil)
    }

    @Test func uncertainEditedViewKeepsOriginalQueryAndMetadataOnRetry() async throws {
        let editor = try FacetSavedViewEditorModel(
            id: "launch",
            fields: [
                "name": .string("Launch"), "query": .object(["tags": .array([.string("ship")])]),
                "vendor": .object(["keep": .bool(true)]),
            ], isNew: false)
        editor.favorite = true
        let draft = FacetSavedViewDraft()
        var submissions: [(String, [String: FacetValue])] = []
        let operations = FacetSavedViewOperations(
            ownsProfile: { true },
            execute: { command, id, admission in
                submissions.append((id, command))
                admission.record(id)
                return false
            }, observe: { [] }, isResolved: { _ in false })
        #expect(
            draft.begin(
                [
                    "kind": .string("save_view"), "id": .string(editor.id),
                    "view": .object(editor.value),
                ], operations: operations))
        #expect(await draft.submit() == nil)
        editor.query = ["tags": .array([.string("newer")])]
        editor.favorite = false
        #expect(draft.beginRetry())
        #expect(await draft.submit() == nil)
        #expect(submissions.count == 2)
        #expect(submissions[0].0 == submissions[1].0 && submissions[0].1 == submissions[1].1)
        let retained = try #require(submissions[1].1["view"]?.object?.fields)
        #expect(retained["query"]?.object?.fields["tags"] == .array([.string("ship")]))
        #expect(retained["favorite"] == .bool(true))
        #expect(retained["vendor"] == .object(["keep": .bool(true)]))
    }

    @Test func corruptImportedQueryIsNotReplacedWithAllTasks() {
        #expect(throws: FacetContractError.self) {
            _ = try FacetSavedViewEditorModel(
                id: "broken", fields: ["name": .string("Broken"), "query": .string("invalid")],
                isNew: false)
        }
    }
}
