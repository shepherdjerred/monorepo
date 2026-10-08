public import Foundation
import TaskNotesUniFFI

extension FacetEngine {
    @discardableResult public func execute(
        profileID: String, command: FacetValue, mutationID: String = UUID().uuidString
    ) throws -> FacetMutationReceipt {
        try requireOpen()
        let mutation = try drafts.envelope(
            profileID: profileID, id: mutationID, command: command, at: Date.now.ISO8601Format(),
            executionContext: .object([
                "today": .string(SystemClock().viewerCalendar().today),
                "timezone": .string(TimeZone.current.identifier),
            ]))
        return try applyMutation(profileID: profileID, mutation: mutation)
    }

    public func pendingMutations(profileID: String? = nil, afterID: String? = nil) throws
        -> [FacetPendingMutation]
    {
        let saved = try drafts.pending(profileID: profileID, afterID: afterID)
        for draft in saved { try schema.validate(draft.mutation, definition: "mutation") }
        return saved
    }

    @discardableResult public func retryMutation(id: String) throws -> FacetMutationReceipt {
        let saved = try drafts.read(id: id)
        return try applyMutation(profileID: saved.profileID, mutation: saved.mutation)
    }

    public func applyIntentCapture(_ capture: FacetIntentCapture) throws {
        let state = try features(
            profileID: capture.profileID,
            request: .object([
                "kind": .string("mutation_receipt"), "mutationId": .string(capture.id),
            ]))
        if state.object?.fields["state"] == .string("applied") {
            if try drafts.contains(id: capture.id) {
                try discardObservedMutation(id: capture.id)
            }
            return
        }
        if try drafts.contains(id: capture.id) {
            let saved = try drafts.read(id: capture.id)
            guard saved.profileID == capture.profileID else {
                throw FacetDraftError.changedOperation
            }
            try retryMutation(id: capture.id)
        } else {
            let preview = try features(
                profileID: capture.profileID,
                request: .object([
                    "kind": .string("capture_preview"), "input": .string(capture.title),
                    "at": .string(capture.at), "today": .string(capture.today),
                ]))
            guard let fields = preview.object?.fields, let properties = fields["properties"] else {
                throw FacetContractError.unsupportedResponse
            }
            let command = FacetValue.object([
                "kind": .string("create"), "properties": properties,
                "body": fields["body"] ?? .string(""),
            ])
            let mutation = try drafts.envelope(
                profileID: capture.profileID, id: capture.id, command: command, at: capture.at,
                executionContext: .object([
                    "today": .string(capture.today), "timezone": .string(capture.timezone),
                ]))
            try applyMutation(profileID: capture.profileID, mutation: mutation)
        }
        try discardObservedMutation(id: capture.id)
    }

    public func savedMutationID(profileID: String, command: FacetValue) throws -> String? {
        var cursor: String?
        while true {
            let page = try pendingMutations(profileID: profileID, afterID: cursor)
            if let matching = page.first(where: { $0.mutation.object?.fields["command"] == command }
            ) {
                return matching.id
            }
            guard page.count == 128, let last = page.last else { return nil }
            cursor = last.id
        }
    }

    public func pendingMutation(profileID: String, kind: String) throws -> FacetPendingMutation? {
        var cursor: String?
        while true {
            let page = try pendingMutations(profileID: profileID, afterID: cursor)
            if let matching = page.first(where: {
                $0.mutation.object?.fields["command"]?.object?.fields["kind"] == .string(kind)
            }) {
                return matching
            }
            guard page.count == 128, let last = page.last else { return nil }
            cursor = last.id
        }
    }

    @discardableResult public func executePayload(
        profileID: String, command: FacetValue, mutationID: String, payload: Data?
    ) throws -> FacetMutationReceipt {
        try requireOpen()
        try payloadDrafts.prepare(id: mutationID, bytes: payload)
        let mutation = try drafts.envelope(
            profileID: profileID, id: mutationID, command: command, at: Date.now.ISO8601Format(),
            executionContext: .object([
                "today": .string(SystemClock().viewerCalendar().today),
                "timezone": .string(TimeZone.current.identifier),
            ]))
        return try applyMutation(profileID: profileID, mutation: mutation)
    }

    @discardableResult internal func applyMutation(profileID: String, mutation: FacetValue) throws
        -> FacetMutationReceipt
    {
        try requireOpen()
        try schema.validate(mutation, definition: "mutation")
        let receipt: String
        if mutation.object?.fields["command"]?.object?.fields["kind"]?.text == "resolve_conflict",
            mutation.object?.fields["command"]?.object?.fields["resolution"]?.object?.fields[
                "kind"]?.text
                == "replace_payload"
        {
            let id = try draftsID(mutation)
            receipt = try applyPayloadMutation(profileID: profileID, mutation: mutation, id: id)
        } else {
            receipt = try engine.execute(profileId: profileID, commandJson: encode(mutation))
        }
        let value = try FacetMutationReceipt.read(
            json: receipt, expectedMutationID: draftsID(mutation), schema: schema)
        guard value.applied else {
            throw FacetDraftError.changedNote
        }
        return value
    }

    private func applyPayloadMutation(profileID: String, mutation: FacetValue, id: String) throws
        -> String
    {
        let image = try FacetPayloadDraftImage.open(
            directory: payloadDrafts.directory, id: id,
            maximumSize: obsidianTransportLimits().defaultFileBytes)
        guard let image else {
            return try engine.executePayloadIdJson(
                profileId: profileID, mutationJson: encode(mutation), payload: nil)
        }
        let payloadID = "draft:" + id
        let handle = try engine.beginPayload(
            profileId: profileID, payloadId: payloadID, size: image.size, revision: image.revision)
        defer { handle.closeHandle() }
        try FacetPayloadStaging.resume(payload: handle, id: payloadID, image: image, schema: schema)
        return try engine.executePayloadIdJson(
            profileId: profileID, mutationJson: encode(mutation), payload: handle)
    }

    internal func draftsID(_ mutation: FacetValue) throws -> String {
        guard let id = mutation.object?.fields["mutationId"]?.text else {
            throw FacetContractError.unsupportedResponse
        }
        return id
    }

    public func discardObservedMutation(id: String) throws {
        let saved = try drafts.read(id: id)
        let value = try features(
            profileID: saved.profileID,
            request: .object([
                "kind": .string("mutation_receipt"), "mutationId": .string(id),
            ]))
        guard value.object?.fields["state"] == .string("applied"),
            let receipt = value.object?.fields["receipt"]
        else {
            throw FacetDraftError.changedNote
        }
        try observations.observe(saved, receipt: receipt)
        try drafts.discard(id: id)
    }

    public func lastObservedUndo(profileID: String) throws -> String? {
        try observations.lastUndo(profileID: profileID)
    }
}
