import Foundation
import TaskNotesUniFFI

extension FacetObsidianSession {
    internal func currentStatus() async throws -> FacetSyncStatus {
        do {
            return try await FacetSyncStatusObservation.read(
                observe: { await self.observeHost() },
                durable: { try await self.engine.syncStatus(profileID: self.profileID) })
        } catch FacetEngineError.Busy {
            return FacetSyncStatus(transport: transportPhase)
        } catch ObsidianBoundaryError.Busy {
            return FacetSyncStatus(transport: transportPhase)
        }
    }

    private func observeHost() async -> FacetSyncHostObservation {
        let beganAt = activityRevision
        let queue = await events.observation()
        let authorized = await account.allows(access)
        var work = FacetSyncHostWork()
        work.metadata = metadata.count
        work.uploads = queued.count
        work.downloads = pendingDownloads.count
        work.metadataCompletions = pendingMetadata.count
        work.uploadAdmissions = uploadAdmissions.pendingCount
        work.queuedEvents = queue.count
        work.processing = processing || beganAt != activityRevision
        work.dirty = dirty || remoteDirty
        let phase: FacetSyncTransportPhase
        if stopped || closed {
            if transportPhase == .failed {
                phase = .failed
            } else {
                phase = restartableTransportFailure && !stopped ? .offline : .stopped
            }
        } else if !authorized {
            phase = .reconnectRequired
        } else {
            phase =
                ready
                ? transportPhase : (transportPhase == .connected ? .connecting : transportPhase)
        }
        return FacetSyncHostObservation(
            activityRevision: activityRevision, queueRevision: queue.revision,
            authorized: authorized, transport: phase, work: work)
    }

    internal func publishStatus() async throws {
        await status(try await currentStatus())
    }

    internal func publishStatusWithoutDurableRead() async {
        await status(FacetSyncStatus(transport: transportPhase))
    }

    #if DEBUG
        public func currentAcceptanceStatus() async throws -> FacetSyncStatus {
            try await currentStatus()
        }

        public func prepareAcceptanceTransportInterruption(allowedVaultID: String) async throws {
            guard worker == nil, allowedVaultID == access.identity.vault.id, !stopped, !closed,
                await account.allows(access)
            else { throw FacetSyncError.cancelled }
            acceptanceTransportInterrupted = true
            transportPhase = .offline
        }

        /// Available only to a run whose descriptor names this exact remote vault.
        /// Interruption cancels real transport; it never changes system networking.
        public func setAcceptanceTransportInterrupted(_ interrupted: Bool, allowedVaultID: String)
            async throws
        {
            guard allowedVaultID == access.identity.vault.id, !stopped, !closed,
                await account.allows(access)
            else { throw FacetSyncError.cancelled }
            guard await events.send(.interruption(interrupted)) else {
                throw FacetSyncError.cancelled
            }
        }
    #endif
}
