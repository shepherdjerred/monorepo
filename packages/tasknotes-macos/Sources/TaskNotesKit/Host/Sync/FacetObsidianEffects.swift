import Foundation
import TaskNotesUniFFI

extension FacetObsidianSession {
    internal func executeEffect(_ effect: ObsidianSessionEffect, nowMs: UInt64) async throws
        -> [ObsidianSessionEffect]
    {
        switch effect {
        case .connect, .sendText, .sendBinary, .close:
            try await transportEffect(effect)
            return []
        case .persistCheckpoint, .persistCheckpointDelta:
            return try await checkpointEffect(effect, nowMs: nowMs)
        case .remoteChange, .downloadedPayload:
            return try await downloadEffect(effect, nowMs: nowMs)
        case .uploaded, .cancelled, .failed, .ready:
            try await completionEffect(effect)
            return []
        }
    }

    private func transportEffect(_ effect: ObsidianSessionEffect) async throws {
        switch effect {
        case .connect(let address): try await connectSocket(address)
        case .sendText(let text):
            guard let socket else { throw FacetSyncError.transport }
            try await socket.send(.string(text))
        case .sendBinary(let bytes):
            guard let socket else { throw FacetSyncError.transport }
            try await socket.send(.data(bytes))
        case .close:
            epoch += 1
            ready = false
            reader?.cancel()
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
        case .persistCheckpoint, .persistCheckpointDelta, .remoteChange, .downloadedPayload,
            .uploaded, .cancelled, .failed, .ready:
            throw FacetContractError.unsupportedResponse
        }
    }

    private func connectSocket(_ address: String) async throws {
        guard let url = URL(string: address), url.scheme == "wss" else {
            throw FacetSyncError.transport
        }
        reader?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        epoch += 1
        let current = epoch
        let queue = events
        let connectionDelegate = FacetSocketDelegate(
            opened: { [weak self] socket in await self?.beginReading(socket, epoch: current) },
            closed: { _ = await queue.send(.lost(current)) })
        delegate = connectionDelegate
        let connection = transport.webSocketTask(with: url)
        try FacetSocketLimits.configure(connection, limits: limits)
        connection.delegate = connectionDelegate
        socket = connection
        connection.resume()
        await status("Connecting to Obsidian Sync…")
    }

    private func checkpointEffect(_ effect: ObsidianSessionEffect, nowMs: UInt64) async throws
        -> [ObsidianSessionEffect]
    {
        let revision: UInt64
        switch effect {
        case .persistCheckpoint(let value, let json):
            try await engine.saveCheckpoint(profileID: profileID, json: json)
            revision = value
        case .persistCheckpointDelta(let value, let json):
            try await engine.checkpointDelta(profileID: profileID, json: json)
            revision = value
        case .connect, .sendText, .sendBinary, .close, .remoteChange, .downloadedPayload,
            .uploaded, .cancelled, .failed, .ready:
            throw FacetContractError.unsupportedResponse
        }
        return try core.checkpointPersisted(revision: revision, nowMs: nowMs)
    }

    private func downloadEffect(_ effect: ObsidianSessionEffect, nowMs: UInt64) async throws
        -> [ObsidianSessionEffect]
    {
        switch effect {
        case .remoteChange(let json): return try await noticeOwned(json, nowMs: nowMs)
        case .downloadedPayload(let uid, let transferID, _, _, _):
            return try await retainOwnedDownload(uid: uid, transferID: transferID)
        case .connect, .sendText, .sendBinary, .close, .persistCheckpoint, .persistCheckpointDelta,
            .uploaded, .cancelled, .failed, .ready:
            throw FacetContractError.unsupportedResponse
        }
    }

    private func completionEffect(_ effect: ObsidianSessionEffect) async throws {
        switch effect {
        case .uploaded(let id, let hash):
            guard queued.contains(id) else { throw FacetContractError.unsupportedResponse }
            try await engine.acknowledge(profileID: profileID, mutationID: id, contentHash: hash)
            queued.remove(id)
            dirty = true
        case .cancelled(let id): queued.remove(id)
        case .failed(_, let message, _, let operationID):
            if let operationID { queued.remove(operationID) }
            await status(message)
        case .ready:
            ready = true
            dirty = true
            await status("Downloading pending changes…")
        case .connect, .sendText, .sendBinary, .close, .persistCheckpoint, .persistCheckpointDelta,
            .remoteChange, .downloadedPayload:
            throw FacetContractError.unsupportedResponse
        }
    }
}
