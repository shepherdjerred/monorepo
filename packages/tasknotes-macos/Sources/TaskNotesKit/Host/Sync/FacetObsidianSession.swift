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
    }
    internal let engine: FacetEngine
    internal let account: FacetObsidianAccount
    internal let profileID: String
    internal let access: FacetSyncAccess
    internal let core: FfiObsidianSession
    internal let limits: ObsidianTransportLimits
    internal let events = FacetSyncEventQueue<Event>(capacity: 8)
    private let changed: @Sendable () async -> Void
    internal let status: @Sendable (String) async -> Void
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
    internal var stopped = false
    private var closed = false
    private var worker: _Concurrency.Task<Void, Never>?
    private var ticker: _Concurrency.Task<Void, Never>?
    internal var reader: _Concurrency.Task<Void, Never>?

    private init(
        engine: FacetEngine, account: FacetObsidianAccount, profileID: String,
        access: FacetSyncAccess, checkpoint: String, changed: @escaping @Sendable () async -> Void,
        status: @escaping @Sendable (String) async -> Void
    ) throws {
        self.engine = engine
        self.account = account
        self.profileID = profileID
        self.access = access
        self.changed = changed
        self.status = status
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
        status: @escaping @Sendable (String) async -> Void,
        retain: @escaping @Sendable (FacetObsidianSession) async -> Bool = { _ in true }
    ) async throws -> FacetObsidianSession {
        let authorized = try await account.access(profileID: profileID)
        let checkpoint = try await engine.checkpoint(profileID: profileID)
        let host = try FacetObsidianSession(
            engine: engine, account: account, profileID: profileID, access: authorized,
            checkpoint: checkpoint, changed: changed, status: status)
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
                await status("Sync timing could not continue.")
            }
        }
    }

    public func stop() async {
        stopped = true
        socket?.cancel(with: .goingAway, reason: nil)
        reader?.cancel()
        worker?.cancel()
        await events.close()
        await worker?.value
        if worker == nil { await close() }
    }

    public func isIdle() -> Bool { ready && !stopped && metadata.isEmpty && queued.isEmpty }

    private func run() async {
        do {
            let beganAt = Self.now()
            try await process(admit { try core.begin(nowMs: beganAt) })
            while let event = await events.next() {
                guard await account.allows(access) else {
                    break
                }
                let admittedAt = Self.now()
                try await process(admit { try effects(for: event, nowMs: admittedAt) })
                if case .tick = event {
                    try await process(drainMetadataCompletions())
                    try await process(drainOwnedDownloads())
                }
                if case .tick = event, dirty {
                    dirty = false
                    await changed()
                }
                if ready { try await uploadPendingOwned() }
            }
        } catch is CancellationError {} catch { await status(Self.failureMessage(error)) }
        await close()
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
            return effects
        case .tick: return try core.tick(nowMs: nowMs)
        }
    }

    private func close() async {
        guard !closed else { return }
        closed = true
        ready = false
        ticker?.cancel()
        reader?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        transport.invalidateAndCancel()
        await events.close()
        // Cancellation and unbinding are the owned-transfer invalidation
        // boundary. An ordinary socket close preserves these receipts.
        let retiredAt = Self.now()
        do { try await retire { _ = try core.cancel(nowMs: retiredAt) } } catch {
            await status(Self.failureMessage(error))
        }
        do { try await retire { _ = try core.unbindRuntime(nowMs: retiredAt) } } catch {
            await status(Self.failureMessage(error))
        }
        pendingDownloads.removeAll()
        pendingMetadata.removeAll()
        uploadAdmissions = FacetUploadAdmissions()
        metadata.removeAll()
        queued.removeAll()
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

    private static func failureMessage(_ error: any Error) -> String {
        if let failure = error as? FacetSyncError { return failure.localizedDescription }
        if let failure = error as? ObsidianBoundaryError, case .Boundary(_, let detail) = failure {
            return detail
        }
        return
            "Facet could not continue Sync. Reconnect this vault after checking network and storage access."
    }
}
