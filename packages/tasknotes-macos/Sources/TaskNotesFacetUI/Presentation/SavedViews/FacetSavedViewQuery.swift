import TaskNotesKit

/// A saved selection retains filters, never the device context of its last read.
internal enum FacetSavedViewQuery {
    static func selection(_ query: [String: FacetValue]) -> [String: FacetValue] {
        query.filter { !["at", "today", "timezone", "offset", "limit"].contains($0.key) }
    }

    static func duplicate(_ view: FacetSavedView) throws -> [String: FacetValue] {
        guard let query = view.view["query"]?.object?.fields else {
            throw FacetContractError.unsupportedResponse
        }
        var copy = view.view
        copy["name"] = .string((view.view["name"]?.text ?? view.id) + " copy")
        copy["query"] = .object(selection(query))
        return copy
    }
}
