import Foundation
import OSLog
import TaskNotesKit

extension FacetStore {
    /// The OS owns scheduling. This bounded attempt reuses durable checkpoints
    /// and outbox receipts; a foreground resume supersedes the background lease.
    public func runBackgroundSync(budget: Duration = .seconds(20)) async -> Bool {
        guard !foreground, budget > .zero, budget <= .seconds(120) else { return false }
        let lease = UUID()
        backgroundLease = lease
        await start()
        await resumeSync(isForeground: false)
        var completed = false
        do {
            let deadline = ContinuousClock.now.advanced(by: budget)
            while backgroundLease == lease, ContinuousClock.now < deadline {
                try _Concurrency.Task.checkCancellation()
                if try await backgroundProfilesSettled() {
                    completed = true
                    break
                }
                try await _Concurrency.Task.sleep(for: .seconds(1))
            }
        } catch is CancellationError {} catch { reportBackgroundFailure(error) }
        if backgroundLease == lease {
            if completed { await refreshReminders() }
            backgroundLease = nil
            await stopSessions()
        }
        return completed && !_Concurrency.Task.isCancelled
    }

    internal func reportBackgroundFailure(_ failure: any Error) {
        let diagnostic = FacetFailureDiagnostic(failure)
        Logger(subsystem: "red.sjer.facet", category: "BackgroundSync")
            .error("Background Sync failed: \(diagnostic.chain, privacy: .public)")
        error = diagnostic.action
    }

    private func backgroundProfilesSettled() async throws -> Bool {
        guard let engine else { return false }
        let eligible = try await account?.eligibleReminderProfileIDs() ?? []
        let synced = profiles.filter { $0.kind == "obsidian_sync" && eligible.contains($0.id) }
        guard !synced.isEmpty else { return true }
        for profile in synced {
            guard let session = sessions[profile.id], await session.isIdle() else { return false }
            let discovery = try await engine.features(
                profileID: profile.id, request: .object(["kind": .string("discovery")]))
            guard discovery.object?.fields["initialSyncComplete"] == .bool(true),
                try await !engine.hasPendingUploads(profileID: profile.id)
            else { return false }
        }
        return true
    }
}
