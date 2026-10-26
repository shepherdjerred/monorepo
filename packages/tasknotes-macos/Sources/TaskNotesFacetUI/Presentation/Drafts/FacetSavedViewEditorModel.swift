import Foundation
import Observation
import TaskNotesKit

/// Editing a view starts from that view, never the list currently behind it.
/// Open metadata and query members survive changes to the visible controls.
@Observable @MainActor internal final class FacetSavedViewEditorModel: Identifiable {
    let id: String
    let isNew: Bool
    var name: String
    var symbol: String
    var tint: String
    var favorite: Bool
    var viewType: String
    var query: [String: FacetValue]
    private let originalFields: [String: FacetValue]
    private var initialValue: [String: FacetValue] = [:]

    init(id: String, fields: [String: FacetValue], isNew: Bool) throws {
        for key in ["name", "symbol", "tint", "viewType"] {
            if let stored = fields[key], stored.text == nil {
                throw FacetContractError.unsupportedResponse
            }
        }
        if let stored = fields["favorite"], stored != .bool(true), stored != .bool(false) {
            throw FacetContractError.unsupportedResponse
        }
        guard let storedQuery = fields["query"]?.object?.fields else {
            throw FacetContractError.unsupportedResponse
        }
        self.id = id
        self.isNew = isNew
        originalFields = fields
        name = fields["name"]?.text ?? ""
        symbol = fields["symbol"]?.text ?? "bookmark"
        tint = fields["tint"]?.text ?? "#6366f1"
        favorite = fields["favorite"] == .bool(true)
        viewType = fields["viewType"]?.text ?? "list"
        query = storedQuery
        initialValue = value
    }

    var value: [String: FacetValue] {
        var result = originalFields
        var storedQuery = query
        for key in ["at", "today", "offset", "limit"] { storedQuery.removeValue(forKey: key) }
        result.merge([
            "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "symbol": .string(symbol), "tint": .string(tint), "favorite": .bool(favorite),
            "viewType": .string(viewType), "query": .object(storedQuery),
        ]) { _, edited in edited }
        return result
    }

    var hasChanges: Bool { value != initialValue }
    var canSave: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    static func fresh(id: String, order: Int) throws -> FacetSavedViewEditorModel {
        try FacetSavedViewEditorModel(
            id: id,
            fields: [
                "schemaVersion": .integer(1), "name": .string(""), "order": .integer(Int64(order)),
                "symbol": .string("tray"), "tint": .string("#0a84ff"), "favorite": .bool(false),
                "viewType": .string("list"),
                "query": .object([
                    "scope": .string("all"), "completed": .bool(false),
                    "sortField": .string("dueDate"), "sortDirection": .string("asc"),
                ]),
            ], isNew: true)
    }
}
