import Dispatch
public import Foundation
import TaskNotesUniFFI

internal final class FacetSocketDelegate: NSObject, URLSessionWebSocketDelegate {
    private let opened: @Sendable (URLSessionWebSocketTask) async -> Void
    private let closed: @Sendable () async -> Void
    init(
        opened: @escaping @Sendable (URLSessionWebSocketTask) async -> Void,
        closed: @escaping @Sendable () async -> Void
    ) {
        self.opened = opened
        self.closed = closed
    }
    func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        _Concurrency.Task { await opened(webSocketTask) }
    }
    func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
        _Concurrency.Task { await closed() }
    }
}

/// One serial worker executes Rust effects; callbacks carry a socket epoch.
public actor FacetObsidianSession {
    internal enum Event: Sendable {
        case opened(UInt64)
        case text(UInt64, String)
        case binary(UInt64, Data)
        case lost(UInt64)
        case tick
        #if DEBUG
            case interruption(Bool)
        #endif
    }
    internal let engine: FacetEngine
    internal let account: FacetObsidianAccount
    internal let profileID: String
    internal let access: FacetSyncAccess
    internal let core: FfiObsidianSession
    internal let limits: ObsidianTransportLimits
    internal let sendMessage:
        @Sendable (URLSessionWebSocketTask, URLSessionWebSocketTask.Message) async throws -> Void
    internal let events = FacetSyncEventQueue<Event>(capacity: 8)
    private let changed: @Sendable () async -> Void
    private let remoteChanged: @Sendable () async -> Void
    internal let status: @Sendable (FacetSyncStatus) async -> Void
    internal var transportPhase: FacetSyncTransportPhase = .connecting
    internal var processing = false
    internal var activityRevision: UInt64 = 0
    #if DEBUG
        internal var acceptanceTransportInterrupted = false
    #endif
    internal let transport = URLSession(configuration: .ephemeral)
    internal var delegate: FacetSocketDelegate?
    internal var socket: URLSessionWebSocketTask?
    internal var epoch: UInt64 = 0
    internal var metadata: [UInt64: FacetValue] = [:]
    internal var queued: Set<String> = []
    internal var pendingDownloads: [PendingDownload] = []
    internal var pendingMetadata: [PendingMetadataCompletion] = []
    internal var uploadAdmissions = FacetUploadAdmissions()
    internal var ready = false
    internal var dirty = false
    internal var remoteDirty = false
    internal var stopped = false
    internal var closed = false
    internal var restartableTransportFailure = false
    internal var retirementCompleted = false
    internal var worker: _Concurrency.Task<Void, Never>?
    private var ticker: _Concurrency.Task<Void, Never>?
    internal var reader: _Concurrency.Task<Void, Never>?

    internal init(
        engine: FacetEngine, account: FacetObsidianAccount, profileID: String,
        access: FacetSyncAccess, checkpoint: String, changed: @escaping @Sendable () async -> Void,
        status: @escaping @Sendable (FacetSyncStatus) async -> Void,
        remoteChanged: @escaping @Sendable () async -> Void = {},
        sendMessage:
            @escaping @Sendable (
                URLSessionWebSocketTask, URLSessionWebSocketTask.Message
            ) async throws -> Void = { socket, message in try await socket.send(message) }
    ) throws {
        self.engine = engine
        self.account = account
        self.profileID = profileID
        self.access = access
        self.changed = changed
        self.remoteChanged = remoteChanged
        self.status = status
        self.sendMessage = sendMessage
        limits = try obsidianTransportLimits()
        let vault = access.identity.vault
        core = try FfiObsidianSession(
            options: ObsidianSessionOptions(
                host: vault.host, token: access.token, vaultId: vault.id, deviceName: "Facet Apple",
                encryptionVersion: vault.encryptionVersion, salt: vault.salt, keyBytes: access.key,
                checkpointJson: checkpoint, filterJson: nil))
    }

    public static func open(
        engine: FacetEngine, account: FacetObsidianAccount, profileID: String,
        changed: @escaping @Sendable () async -> Void,
        status: @escaping @Sendable (FacetSyncStatus) async -> Void,
        remoteChanged: @escaping @Sendable () async -> Void = {},
        retain: @escaping @Sendable (FacetObsidianSession) async -> Bool = { _ in true }
    ) async throws -> FacetObsidianSession {
        let authorized = try await account.access(profileID: profileID)
        let checkpoint = try await engine.checkpoint(profileID: profileID)
        let host = try FacetObsidianSession(
            engine: engine, account: account, profileID: profileID, access: authorized,
            checkpoint: checkpoint, changed: changed, status: status, remoteChanged: remoteChanged)
        do {
            try await engine.bindOwnedSession(host.core, profileID: profileID)
            try _Concurrency.Task.checkCancellation()
        } catch {
            await host.stop()
            throw error
        }
        guard await retain(host) else {
            await host.stop()
            throw FacetSyncError.cancelled
        }
        do { try _Concurrency.Task.checkCancellation() } catch {
            await host.stop()
            throw error
        }
        await host.start()
        return host
    }

    internal static func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds / 1_000_000 }
    private func start() {
        guard !stopped else { return }
        worker = _Concurrency.Task { await run() }
        ticker = _Concurrency.Task {
            do {
                while !_Concurrency.Task.isCancelled {
                    try await _Concurrency.Task.sleep(for: .seconds(1))
                    guard await events.send(.tick) else { return }
                }
            } catch is CancellationError {} catch {
                transportPhase = .failed
                await publishStatusWithoutDurableRead()
            }
        }
    }

    public func stop() async {
        stopped = true
        activityRevision += 1
        transportPhase = .stopped
        socket?.cancel(with: .goingAway, reason: nil)
        reader?.cancel()
        worker?.cancel()
        await events.close()
        await worker?.value
        if worker == nil { await close() }
    }
}

extension FacetObsidianSession {
    public func isIdle() async -> Bool {
        do { return try await currentStatus().phase == .synced } catch {
            transportPhase = .failed
            await publishStatusWithoutDurableRead()
            return false
        }
    }

    private func run() async {
        do {
            let beganAt = Self.now()
            processing = true
            activityRevision += 1
            try await process(admit { try core.begin(nowMs: beganAt) })
            processing = false
            activityRevision += 1
            try await publishStatus()
            while let event = await events.next() {
                guard await account.allows(access) else {
                    transportPhase = .reconnectRequired
                    break
                }
                processing = true
                activityRevision += 1
                let admittedAt = Self.now()
                try await process(admit { try effects(for: event, nowMs: admittedAt) })
                if case .tick = event {
                    try await process(drainMetadataCompletions())
                    try await process(drainOwnedDownloads())
                }
                if case .tick = event { await publishChanges() }
                if ready { try await uploadPendingOwned() }
                processing = false
                activityRevision += 1
                try await publishStatus()
            }
        } catch is CancellationError {} catch {
            recordWorkerFailure(error)
        }
        processing = false
        activityRevision += 1
        await close()
        await publishStatusWithoutDurableRead()
    }

    internal func publishChanges() async {
        let presentationChanged = dirty
        let maintenanceChanged = remoteDirty
        dirty = false
        remoteDirty = false
        if presentationChanged { await changed() }
        if maintenanceChanged { await remoteChanged() }
    }

    private func effects(for event: Event, nowMs: UInt64) throws -> [ObsidianSessionEffect] {
        switch event {
        case .opened(let version):
            return version == epoch ? try core.opened(nowMs: nowMs) : []
        case .text(let version, let text):
            return version == epoch ? try core.receiveText(text: text, nowMs: nowMs) : []
        case .binary(let version, let bytes):
            return version == epoch ? try core.receiveBinary(bytes: bytes, nowMs: nowMs) : []
        case .lost(let version):
            guard version == epoch else { return [] }
            let effects = try core.disconnected(nowMs: nowMs)
            epoch += 1
            ready = false
            transportPhase = .offline
            return effects
        case .tick: return try core.tick(nowMs: nowMs)
        #if DEBUG
            case .interruption(let interrupted):
                acceptanceTransportInterrupted = interrupted
                epoch += 1
                ready = false
                reader?.cancel()
                socket?.cancel(with: .goingAway, reason: nil)
                socket = nil
                transportPhase = interrupted ? .offline : .connecting
                return try core.disconnected(nowMs: nowMs)
        #endif
        }
    }

    internal func close(beforeRetirement: (@Sendable () async -> Void)? = nil) async {
        guard !closed else { return }
        closed = true
        activityRevision += 1
        ready = false
        if transportPhase == .connected || transportPhase == .connecting {
            transportPhase = stopped ? .stopped : .reconnectRequired
        }
        ticker?.cancel()
        reader?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        transport.invalidateAndCancel()
        await events.close()
        await beforeRetirement?()
        // Cancellation and unbinding are the owned-transfer invalidation
        // boundary. An ordinary socket close preserves these receipts.
        let retiredAt = Self.now()
        do { try await retire { _ = try core.cancel(nowMs: retiredAt) } } catch {
            transportPhase = .failed
            restartableTransportFailure = false
        }
        do { try await retire { _ = try core.unbindRuntime(nowMs: retiredAt) } } catch {
            transportPhase = .failed
            restartableTransportFailure = false
        }
        pendingDownloads.removeAll()
        pendingMetadata.removeAll()
        uploadAdmissions = FacetUploadAdmissions()
        metadata.removeAll()
        queued.removeAll()
        retirementCompleted = transportPhase != .failed
    }

    /// Shutdown must finish even when its worker was cancelled. Busy retains
    /// ownership until the current foreign call has drained.
    private func retire(_ operation: () throws -> Void) async throws {
        while true {
            do { return try operation() } catch ObsidianBoundaryError.Busy {
                await withCheckedContinuation { continuation in
                    DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(100)) {
                        continuation.resume()
                    }
                }
            }
        }
    }

    internal func process(_ initial: [ObsidianSessionEffect], cancelling: Bool = false) async throws
    {
        var effects = initial
        var index = 0
        var admittedAt = Self.now()
        while index < effects.count {
            let effect = effects[index]
            if !cancelling {
                try _Concurrency.Task.checkCancellation()
                guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
            }
            do {
                effects.append(contentsOf: try await executeEffect(effect, nowMs: admittedAt))
                index += 1
                admittedAt = Self.now()
            } catch FacetEngineError.Busy {
                try await waitForAdmission()
            } catch ObsidianBoundaryError.Busy {
                try await waitForAdmission()
            }
        }
    }

    /// Busy rejects admission before consuming these exact inputs.
    private func admit<T>(_ operation: () throws -> T) async throws -> T {
        while true {
            try _Concurrency.Task.checkCancellation()
            guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
            do { return try operation() } catch ObsidianBoundaryError.Busy {
                try await waitForAdmission()
            }
        }
    }

    private func waitForAdmission() async throws {
        try _Concurrency.Task.checkCancellation()
        guard !stopped, await account.allows(access) else { throw FacetSyncError.cancelled }
        try await _Concurrency.Task.sleep(for: .milliseconds(100))
    }
}
