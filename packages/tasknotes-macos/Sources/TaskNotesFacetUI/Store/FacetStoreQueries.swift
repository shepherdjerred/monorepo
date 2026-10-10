import Foundation
public import TaskNotesKit

extension FacetStore {
    public var statuses: [(value: String, label: String)] { definitions("statuses") }
    public var priorities: [(value: String, label: String)] { definitions("priorities") }

    public func applyView(_ view: FacetSavedView) async {
        guard let fields = view.view["query"]?.object?.fields else {
            error = "This saved view has no valid query. Edit the view before opening it."
            return
        }
        selectedViewID = view.id
        isApplyingView = true
        savedQuery = fields
        scope = fields["scope"]?.text ?? "all"
        search = fields["text"]?.text ?? ""
        status = singleChoice(fields["statuses"])
        priority = singleChoice(fields["priorities"])
        showCompleted = fields["completed"] != .bool(false)
        includeArchived = fields["includeArchived"] == .bool(true)
        isApplyingView = false
        await reloadQuery()
    }

    public func currentView(name: String, board: Bool) -> [String: FacetValue] {
        var fields = query().object?.fields ?? [:]
        for key in ["schemaVersion", "offset", "limit", "today", "at"] {
            fields.removeValue(forKey: key)
        }
        return [
            "schemaVersion": .integer(1), "name": .string(name),
            "viewType": .string(board ? "board" : "list"), "query": .object(fields),
        ]
    }

    private func definitions(_ key: String) -> [(value: String, label: String)] {
        guard let definitions = snapshot?.configuration.object?.fields[key]?.array?.elements else {
            return []
        }
        return definitions.compactMap { definition in
            guard let value = definition.object?.fields["value"]?.text,
                let label = definition.object?.fields["label"]?.text
            else { return nil }
            return (value, label)
        }
    }

    private func singleChoice(_ value: FacetValue?) -> String {
        guard let choices = value?.array?.elements, choices.count == 1 else { return "" }
        return choices.first?.text ?? ""
    }

    internal func query() -> FacetValue {
        var fields = savedQuery
        let calendar = clock.viewerCalendar()
        fields["offset"] = .integer(0)
        fields["limit"] = .integer(100)
        fields["includeArchived"] = .bool(includeArchived)
        fields["schemaVersion"] = .integer(1)
        fields["scope"] = .string(scope)
        fields["today"] = .string(calendar.today)
        fields["at"] = .string(calendar.instant.ISO8601Format())
        fields["text"] = search.isEmpty ? nil : .string(search)
        if !status.isEmpty { fields["statuses"] = .array([.string(status)]) }
        if !priority.isEmpty { fields["priorities"] = .array([.string(priority)]) }
        if !showCompleted, scope != "completed" { fields["completed"] = .bool(false) }
        return .object(fields)
    }

    internal func displayedPageQuery(offset: Int) throws -> FacetValue {
        guard offset >= 0, UInt32(exactly: offset) != nil,
            case .object(var fields) = displayedQuery
        else { throw FacetContractError.unsupportedResponse }
        fields["offset"] = .integer(Int64(offset))
        fields["limit"] = .integer(100)
        return .object(fields)
    }
}
