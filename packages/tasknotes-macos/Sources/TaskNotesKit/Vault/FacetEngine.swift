public import Foundation
import TaskNotesUniFFI

/// Serial actor boundary. Construction and every synchronous Rust call run
/// away from the UI actor, including filesystem callbacks and recovery.
public actor FacetEngine {
    private struct ProfilesEnvelope: Decodable {
        let schemaVersion: UInt32
        let profiles: [FacetProfile]
    }
    internal let engine: FfiFacetEngine
    private let files: AppleVaultFiles
    internal let directory: URL
    internal let schema: FacetSchema
    internal let drafts: FacetMutationDrafts
    internal let payloadDrafts: FacetPayloadDrafts
    internal let observations: FacetActionObservations
    internal let payloadReaders = FacetPayloadReaders()
    private var closing = false
    private var closed = false

    private init(directory: URL, secrets: any FacetSecureStore) throws {
        self.directory = directory
        schema = try FacetSchema.bundled()
        drafts = try FacetMutationDrafts(
            directory: directory.appendingPathComponent("action-drafts"))
        payloadDrafts = FacetPayloadDrafts(
            directory: directory.appendingPathComponent("action-drafts"))
        observations = try FacetActionObservations(
            directory: directory.appendingPathComponent("observed-actions"))
        files = try AppleVaultFiles(directory: directory.appendingPathComponent("capabilities"))
        engine = try FfiFacetEngine(
            databasePath: directory.appendingPathComponent("facet.sqlite3").path,
            files: FacetVaultAdapter(files: files))
        do { try files.bindEngine(identity: engine.identity(), secrets: secrets) } catch {
            let primary = error
            do { try engine.closeRuntime() } catch {
                throw FacetPayloadConsumptionFailure(primary: primary, cleanup: error)
            }
            throw primary
        }
        for id in try drafts.orphanPayloadIDs() where try observations.hasObserved(id) {
            try drafts.discard(id: id)
        }
    }

    public static func open(
        directory: URL,
        secrets: any FacetSecureStore = FacetKeychainStore(service: "red.sjer.facet.vault-stages")
    ) async throws -> FacetEngine {
        try await _Concurrency.Task.detached {
            try FacetEngine(directory: directory, secrets: secrets)
        }.value
    }

    public func profiles() throws -> [FacetProfile] {
        try requireOpen()
        let json = try engine.profilesJson()
        try schema.validate(json: json, definition: "profiles")
        let response: ProfilesEnvelope = try decode(json)
        guard response.schemaVersion == 1 else { throw FacetContractError.unsupportedResponse }
        for profile in response.profiles { try validateProfile(profile) }
        return response.profiles
    }

    public func registerLocal(directory: URL, approveStandard: Bool) throws -> FacetProfile {
        try requireOpen()
        let profile = FacetProfile(
            id: UUID().uuidString, name: directory.lastPathComponent, kind: "local_folder",
            approveStandard: approveStandard)
        try files.register(profileID: profile.id, directory: directory, external: true)
        do {
            let json = try engine.registerProfile(profileJson: encode(profile))
            try schema.validate(json: json, definition: "profile")
            let registered: FacetProfile = try decode(json)
            try validateProfile(registered)
            return registered
        } catch {
            try files.forget(profileID: profile.id)
            throw error
        }
    }

    public func refresh(profileID: String) throws -> FacetSnapshot {
        try requireOpen()
        return try decodeSnapshot(engine.refresh(profileId: profileID))
    }

    public func registerImported(
        _ imported: FacetVaultImport, directory: URL, approveStandard: Bool
    )
        throws -> FacetProfile
    {
        try requireOpen()
        guard imported.complete, UUID(uuidString: imported.id) != nil else {
            throw FacetContractError.unsupportedResponse
        }
        if let existing = try profiles().first(where: { $0.id == imported.id }) { return existing }
        let profile = FacetProfile(
            id: imported.id, name: imported.name + " (independent copy)", kind: "local_folder",
            approveStandard: approveStandard)
        try files.register(profileID: profile.id, directory: directory, external: false)
        do {
            let json = try engine.registerProfile(profileJson: encode(profile))
            try schema.validate(json: json, definition: "profile")
            return try decode(json)
        } catch {
            try files.forget(profileID: profile.id)
            throw error
        }
    }

    public func registerReplica(id: String, name: String) throws -> FacetProfile {
        try requireOpen()
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
        let replica = directory.appendingPathComponent("replicas").appendingPathComponent(id)
        try FileManager.default.createDirectory(at: replica, withIntermediateDirectories: true)
        try files.register(profileID: id, directory: replica, external: false)
        let profile = FacetProfile(
            id: id, name: name, kind: "obsidian_sync", approveStandard: false)
        let json = try engine.registerProfile(profileJson: encode(profile))
        try schema.validate(json: json, definition: "profile")
        return try decode(json)
    }

    public func approveStandard(profile: FacetProfile) throws {
        try requireOpen()
        let updated = FacetProfile(
            id: profile.id, name: profile.name, kind: profile.kind, approveStandard: true)
        try schema.validate(
            json: engine.registerProfile(profileJson: encode(updated)), definition: "profile")
    }

    public func features(profileID: String, request: FacetValue) throws -> FacetValue {
        try requireOpen()
        try schema.validate(request, definition: "featureRequest")
        let json = try engine.featuresJson(profileId: profileID, requestJson: encode(request))
        let definitions = [
            "capture_preview": "capturePreview",
            "discovery": "discovery",
            "mutation_receipt": "mutationReceipt", "resolution_history": "resolutionHistory",
            "batch_outcome": "batchOutcome", "normalization_preview": "normalizationPreview",
            "undo_available": "undoAvailable",
            "conformance": "conformance",
            "reminder_plan": "reminderPlan",
        ]
        guard let kind = request.object?.fields["kind"]?.text, let definition = definitions[kind]
        else {
            throw FacetContractError.unsupportedResponse
        }
        try schema.validate(json: json, definition: definition)
        let value: FacetValue = try decode(json)
        guard value.object?.fields["schemaVersion"] == .integer(1) else {
            throw FacetContractError.unsupportedResponse
        }
        return value
    }

    internal func checkpoint(profileID: String) throws -> String {
        try requireOpen()
        return try engine.loadCheckpoint(profileId: profileID) ?? ""
    }
    internal func saveCheckpoint(profileID: String, json: String) throws {
        try requireOpen()
        try engine.saveCheckpoint(profileId: profileID, checkpointJson: json)
    }
    internal func checkpointDelta(profileID: String, json: String) throws {
        try requireOpen()
        try engine.applySyncCheckpointDelta(profileId: profileID, deltaJson: json)
    }
    internal func acknowledge(profileID: String, mutationID: String, contentHash: String) throws {
        try requireOpen()
        try engine.acknowledgeUpload(
            profileId: profileID, mutationId: mutationID, revision: contentHash)
    }
    internal func remoteDirectory(profileID: String, path: String, deleted: Bool) throws {
        try requireOpen()
        try files.directory(profileID: profileID, path: path, deleted: deleted)
    }
    internal func uploads(profileID: String) throws -> [FacetValue] {
        try requireOpen()
        let json = try engine.pendingUploadsJson(profileId: profileID)
        try schema.validate(json: json, definition: "uploads")
        let value: FacetValue = try decode(json)
        guard let uploads = value.object?.fields["uploads"]?.array?.elements else {
            throw FacetContractError.unsupportedResponse
        }
        return uploads
    }

    public func hasPendingUploads(profileID: String) throws -> Bool {
        try !uploads(profileID: profileID).isEmpty
    }

    public func snapshot(profileID: String, query: FacetValue) throws -> FacetSnapshot {
        try requireOpen()
        try schema.validate(query, definition: "query")
        return try decodeSnapshot(
            engine.snapshotJson(profileId: profileID, queryJson: encode(query)))
    }

    /// A newly registered profile has no durable index yet. Other failures are
    /// real cached-state failures and must reach the caller.
    public func cachedSnapshot(profileID: String, query: FacetValue) throws -> FacetSnapshot? {
        do { return try snapshot(profileID: profileID, query: query) } catch FacetEngineError
            .Configuration
        { return nil }
    }

    public func removeProfile(id: String) async throws -> FacetFailureDiagnostic? {
        try requireOpen()
        try engine.removeProfile(profileId: id)
        await payloadReaders.closeProfile(id)
        do {
            try files.forget(profileID: id)
            return nil
        } catch { return FacetFailureDiagnostic(error) }
    }

    public func close() async throws {
        guard !closed else { return }
        closing = true
        await payloadReaders.closeAll()
        try engine.closeRuntime()
        try files.closeBoundedFiles()
        closed = true
    }

    internal func requireOpen() throws {
        guard !closing, !closed else { throw FacetEngineError.Closed }
    }

    internal func encode(_ value: some Encodable) throws -> String {
        guard let json = String(data: try JSONEncoder().encode(value), encoding: .utf8) else {
            throw FacetContractError.unsupportedResponse
        }
        return json
    }

    internal func encode(_ value: FacetValue) throws -> String { try FacetJSON.encode(value) }

    internal func decode<T: Decodable>(_ json: String) throws -> T {
        let data = Data(json.utf8)
        return try FacetJSON.decoder(data).decode(T.self, from: data)
    }

    private func validateProfile(_ profile: FacetProfile) throws {
        guard profile.schemaVersion == 1, ["local_folder", "obsidian_sync"].contains(profile.kind),
            !profile.id.isEmpty, !profile.name.isEmpty
        else {
            throw FacetContractError.unsupportedResponse
        }
    }

    private func decodeSnapshot(_ json: String) throws -> FacetSnapshot {
        try schema.validate(json: json, definition: "snapshot")
        let snapshot: FacetSnapshot = try decode(json)
        guard snapshot.schemaVersion == 1 else { throw FacetContractError.unsupportedResponse }
        return snapshot
    }
}

public enum FacetContractError: Error, LocalizedError {
    case unsupportedResponse
    public var errorDescription: String? {
        "The app received data that does not match its installed engine. Your draft is retained. "
            + "Install a matching app build before retrying."
    }
}

public enum FacetDraftError: Error, LocalizedError {
    case changedNote
    case changedOperation
    case retiredFeature
    public var errorDescription: String? {
        switch self {
        case .changedNote:
            "The note changed while you were editing. Your draft is still open; "
                + "review the conflict inbox before retrying."
        case .changedOperation:
            "This saved action belongs to a different draft or vault. Start a new action to save the changed draft."
        case .retiredFeature:
            "This saved action uses a removed feature. Its original request is retained. "
                + "Check its outcome before retiring it."
        }
    }
}
