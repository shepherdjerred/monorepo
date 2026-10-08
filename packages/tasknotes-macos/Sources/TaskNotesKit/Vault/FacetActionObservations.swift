import Foundation

/// Nonsecret host bookkeeping is acknowledged durably before a saved action
/// draft is removed. Receipt eligibility remains the runtime's responsibility.
internal struct FacetActionObservations {
    private struct State: Codable {
        let schemaVersion: UInt32
        let profileID: String
        var observed: [String]
        var undo: [String]
        var undone: [String]
    }
    private let directory: URL

    init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func observe(_ action: FacetPendingMutation, receipt: FacetValue) throws {
        var state = try read(action.profileID)
        if state.observed.contains(action.id) { return }
        guard UUID(uuidString: action.id) != nil,
            let command = action.mutation.object?.fields["command"]?.object?.fields,
            let kind = command["kind"]?.text,
            receipt.object?.fields["applied"] == .bool(true)
        else {
            throw FacetContractError.unsupportedResponse
        }
        if kind == "undo" {
            guard let target = command["receiptId"]?.text else {
                throw FacetContractError.unsupportedResponse
            }
            state.undo.removeAll { $0 == target }
            if !state.undone.contains(target) { state.undone.append(target) }
        } else if kind != "batch_partial",
            receipt.object?.fields["paths"]?.array?.elements.isEmpty == false,
            !state.undone.contains(action.id)
        {
            state.undo.append(action.id)
        }
        state.observed.append(action.id)
        let files = try VaultDirectory(url: directory)
        try files.replaceMetadata(name(action.profileID), bytes: JSONEncoder().encode(state))
    }

    func lastUndo(profileID: String) throws -> String? { try read(profileID).undo.last }

    func hasObserved(_ id: String) throws -> Bool {
        let files = try VaultDirectory(url: directory)
        for name in try files.entries() {
            if name.hasSuffix(".temporary") {
                guard UUID(uuidString: String(name.dropLast(".temporary".count))) != nil else {
                    throw FacetContractError.unsupportedResponse
                }
                continue
            }
            guard name.hasSuffix(".json"), let bytes = try files.read(name) else {
                throw FacetContractError.unsupportedResponse
            }
            let profileID = try JSONDecoder().decode(State.self, from: bytes).profileID
            guard name == self.name(profileID) else { throw FacetContractError.unsupportedResponse }
            if try read(profileID).observed.contains(id) { return true }
        }
        return false
    }

    private func name(_ profileID: String) -> String {
        AppleVaultFiles.revision(Data(profileID.utf8)) + ".json"
    }

    private func read(_ profileID: String) throws -> State {
        let files = try VaultDirectory(url: directory)
        guard let bytes = try files.read(name(profileID)) else {
            return State(schemaVersion: 1, profileID: profileID, observed: [], undo: [], undone: [])
        }
        let fields = try FacetJSON.parse(bytes).object?.fields
        guard let fields,
            Set(fields.keys) == ["schemaVersion", "profileID", "observed", "undo", "undone"],
            fields["schemaVersion"] == .integer(1)
        else { throw FacetContractError.unsupportedResponse }
        let state = try JSONDecoder().decode(State.self, from: bytes)
        guard state.profileID == profileID, !profileID.isEmpty else {
            throw FacetContractError.unsupportedResponse
        }
        for values in [state.observed, state.undo, state.undone] {
            guard Set(values).count == values.count,
                values.allSatisfy({ UUID(uuidString: $0) != nil })
            else {
                throw FacetContractError.unsupportedResponse
            }
        }
        return state
    }
}
