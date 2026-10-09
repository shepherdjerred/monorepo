import Foundation

/// Host action identity survives an uncertain response and process restart.
/// The runtime remains responsible for domain validation and receipt deduplication.
internal struct FacetMutationDrafts: Sendable {
    private struct Draft: Codable {
        let profileID: String
        let mutation: FacetValue
    }
    private let directory: URL

    init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func envelope(
        profileID: String, id: String, command: FacetValue, at: String,
        executionContext: FacetValue? = nil
    ) throws -> FacetValue {
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
        let files = try VaultDirectory(url: directory)
        let name = id + ".json"
        if let bytes = try files.read(name) {
            let draft = try decodeDraft(bytes)
            guard draft.profileID == profileID,
                draft.mutation.object?.fields["mutationId"] == .string(id),
                draft.mutation.object?.fields["command"] == command
            else {
                throw FacetDraftError.changedOperation
            }
            return draft.mutation
        }
        var fields: [String: FacetValue] = [
            "schemaVersion": .integer(1), "mutationId": .string(id), "at": .string(at),
            "command": command,
        ]
        if let executionContext { fields["executionContext"] = executionContext }
        let mutation = FacetValue.object(fields)
        try files.writeNewAtomic(
            name,
            bytes: Data(
                FacetJSON.encode(.object(["profileID": .string(profileID), "mutation": mutation]))
                    .utf8))
        try files.synchronize()
        return mutation
    }

    func pending(profileID: String? = nil, afterID: String? = nil, limit: Int = 128) throws
        -> [FacetPendingMutation]
    {
        guard (1...128).contains(limit), afterID == nil || UUID(uuidString: afterID ?? "") != nil
        else {
            throw FacetContractError.unsupportedResponse
        }
        let files = try VaultDirectory(url: directory)
        var result: [FacetPendingMutation] = []
        for name in try files.entries().sorted() {
            if try isSupplementary(name) { continue }
            guard name.hasSuffix(".json") else { throw FacetContractError.unsupportedResponse }
            let id = String(name.dropLast(5))
            guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
            if let afterID, id <= afterID { continue }
            let saved = try read(id: id)
            if let profileID, saved.profileID != profileID { continue }
            result.append(saved)
            if result.count == limit { break }
        }
        return result
    }

    private func isSupplementary(_ name: String) throws -> Bool {
        for suffix in [".temporary", ".payload", ".payload-meta"] where name.hasSuffix(suffix) {
            guard UUID(uuidString: String(name.dropLast(suffix.count))) != nil else {
                throw FacetContractError.unsupportedResponse
            }
            return true
        }
        return false
    }

    func read(id: String) throws -> FacetPendingMutation {
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
        let files = try VaultDirectory(url: directory)
        guard let bytes = try files.read(id + ".json") else {
            throw FacetContractError.unsupportedResponse
        }
        let draft = try decodeDraft(bytes)
        guard !draft.profileID.isEmpty, draft.mutation.object?.fields["mutationId"] == .string(id)
        else {
            throw FacetContractError.unsupportedResponse
        }
        return FacetPendingMutation(profileID: draft.profileID, id: id, mutation: draft.mutation)
    }

    func contains(id: String) throws -> Bool {
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
        return try VaultDirectory(url: directory).read(id + ".json") != nil
    }

    private func decodeDraft(_ bytes: Data) throws -> Draft {
        guard let fields = try FacetJSON.parse(bytes).object?.fields,
            Set(fields.keys) == ["profileID", "mutation"]
        else { throw FacetContractError.unsupportedResponse }
        return try FacetJSON.decoder(bytes).decode(Draft.self, from: bytes)
    }

    /// Called after an applied receipt or explicit receipt-backed retirement.
    func discard(id: String) throws {
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
        let files = try VaultDirectory(url: directory)
        try files.remove(id + ".payload")
        try files.remove(id + ".payload-meta")
        try files.synchronize()
        // The envelope remains discoverable through a crash during blob cleanup.
        try files.remove(id + ".json")
        try files.synchronize()
    }

    func orphanPayloadIDs() throws -> [String] {
        let files = try VaultDirectory(url: directory)
        let names = try files.entries()
        var ids: Set<String> = []
        for name in names where name.hasSuffix(".payload") || name.hasSuffix(".payload-meta") {
            let id = String(name.prefix(while: { $0 != "." }))
            guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
            if !names.contains(id + ".json") { ids.insert(id) }
        }
        return ids.sorted()
    }
}

public struct FacetPendingMutation: Sendable, Identifiable {
    public let profileID: String
    public let id: String
    public let mutation: FacetValue
    public var canResume: Bool { FacetRetainedActions.canResume(mutation) }
}

/// Historical private drafts remain readable without restoring public commands.
internal enum FacetRetainedActions {
    static func canResume(_ mutation: FacetValue) -> Bool {
        guard let command = mutation.object?.fields["command"] else { return false }
        return supports(command)
    }

    private static func supports(_ command: FacetValue) -> Bool {
        guard let kind = command.object?.fields["kind"]?.text else { return false }
        if ["start_time", "stop_time", "set_time_entries", "pomodoro"].contains(kind) {
            return false
        }
        if ["batch", "batch_partial"].contains(kind) {
            return command.object?.fields["commands"]?.array?.elements.allSatisfy(supports) == true
        }
        return true
    }

    static func validateRetirement(
        _ saved: FacetPendingMutation, outcome: FacetValue, schema: FacetSchema
    ) throws {
        try schema.validate(saved.mutation, definition: "retainedMutation")
        try schema.validate(outcome, definition: "mutationReceipt")
        guard outcome.object?.fields["mutationId"] == .string(saved.id)
        else { throw FacetContractError.unsupportedResponse }
        let state = outcome.object?.fields["state"]?.text
        if let receipt = outcome.object?.fields["receipt"]?.object?.fields {
            guard receipt["mutationId"] == .string(saved.id) else {
                throw FacetContractError.unsupportedResponse
            }
        }
        if state == "applied" {
            // Supported applied actions must be observed/resumed, never silently discarded.
            guard !saved.canResume else { throw FacetDraftError.changedNote }
            guard let receipt = outcome.object?.fields["receipt"]?.object?.fields,
                receipt["mutationId"] == .string(saved.id), receipt["applied"] == .bool(true)
            else { throw FacetContractError.unsupportedResponse }
        } else if state != "absent" && state != "parked" {
            throw FacetDraftError.changedNote
        }
    }
}
