/// Durable Rust state. Transport readiness alone never proves convergence.
public struct FacetDurableSyncStatus: Codable, Equatable, Sendable {
    public let schemaVersion: UInt32
    public let profileId: String
    public let profileKind: String
    public let version: UInt64
    public let initialSyncComplete: Bool
    public let pendingRemoteCount: UInt64
    public let pendingUploadCount: UInt64
    public let conflictCount: UInt64
    public let pendingMutationCount: UInt64

    public var isSettled: Bool {
        initialSyncComplete && pendingRemoteCount == 0 && pendingUploadCount == 0
            && conflictCount == 0 && pendingMutationCount == 0
    }
}

internal struct FacetSyncHostObservation {
    let activityRevision: UInt64
    let queueRevision: UInt64
    let authorized: Bool
    let transport: FacetSyncTransportPhase
    var work: FacetSyncHostWork
}

internal enum FacetSyncStatusObservation {
    static func read(
        observe: () async -> FacetSyncHostObservation,
        durable: () async throws -> FacetDurableSyncStatus
    ) async throws -> FacetSyncStatus {
        let before = await observe()
        let projection = try await durable()
        let confirmed = try await durable()
        let after = await observe()
        let unchanged =
            before.activityRevision == after.activityRevision
            && before.queueRevision == after.queueRevision
            && before.authorized && after.authorized
            && projection == confirmed
        return FacetSyncStatus(
            transport: after.authorized ? after.transport : .reconnectRequired,
            durable: unchanged ? projection : nil, work: after.work)
    }
}

public enum FacetSyncTransportPhase: String, Sendable {
    case connecting, connected, offline, reconnectRequired, failed, stopped
}

public enum FacetSyncPhase: String, Sendable {
    case connecting, syncing, synced, offline, reconnectRequired, conflict, failed, stopped
}

/// Includes retained admissions and completions, not just socket traffic.
public struct FacetSyncHostWork: Equatable, Sendable {
    public var metadata = 0
    public var uploads = 0
    public var downloads = 0
    public var metadataCompletions = 0
    public var uploadAdmissions = 0
    public var queuedEvents = 0
    public var processing = false
    public var dirty = false

    public init() {}

    public var isEmpty: Bool {
        metadata == 0 && uploads == 0 && downloads == 0 && metadataCompletions == 0
            && uploadAdmissions == 0 && queuedEvents == 0 && !processing && !dirty
    }
}

public struct FacetSyncStatus: Equatable, Sendable {
    public let transport: FacetSyncTransportPhase
    public let durable: FacetDurableSyncStatus?
    public let work: FacetSyncHostWork

    public init(
        transport: FacetSyncTransportPhase, durable: FacetDurableSyncStatus? = nil,
        work: FacetSyncHostWork = FacetSyncHostWork()
    ) {
        self.transport = transport
        self.durable = durable
        self.work = work
    }

    public var phase: FacetSyncPhase {
        switch transport {
        case .connecting: return .connecting
        case .offline: return .offline
        case .reconnectRequired: return .reconnectRequired
        case .failed: return .failed
        case .stopped: return .stopped
        case .connected:
            guard let durable else { return .syncing }
            if durable.conflictCount > 0 { return .conflict }
            return durable.isSettled && work.isEmpty ? .synced : .syncing
        }
    }

    public var message: String {
        switch phase {
        case .connecting: "Connecting to Obsidian Sync…"
        case .syncing: "Syncing changes…"
        case .synced: "Synced with Obsidian."
        case .offline: "Offline. Your local changes will sync when connected."
        case .reconnectRequired: "Reconnect this vault to resume Obsidian Sync."
        case .conflict: "Sync conflicts need your attention. Both versions are retained."
        case .failed: "Sync could not continue. Check network and storage access, then reconnect."
        case .stopped: "Sync is paused. Your local tasks are available."
        }
    }
}

extension FacetEngine {
    public func syncStatus(profileID: String) throws -> FacetDurableSyncStatus {
        let value = try features(
            profileID: profileID, request: .object(["kind": .string("sync_status")]))
        let projection: FacetDurableSyncStatus = try decode(encode(value))
        guard projection.profileId == profileID else {
            throw FacetContractError.unsupportedResponse
        }
        return projection
    }
}
