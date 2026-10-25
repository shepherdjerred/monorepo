import Foundation
import TaskNotesKit

extension FacetStore {
    internal func revalidateOccurrenceProfileOwner() {
        guard let owner = occurrenceAdmission else { return }
        if removingProfileIDs.contains(owner.profileID)
            || !profiles.contains(where: { $0.id == owner.profileID })
        {
            owner.permit.cancel()
        }
    }

    internal func changedOccurrenceLifecycle(previous: UInt64) {
        guard syncGeneration != previous else { return }
        occurrenceAdmission?.permit.cancel()
        clearSavedNotice()
    }

    internal func requestOccurrenceMaintenance(profileID: String) {
        occurrenceQueue.request(profileID)
        startOccurrenceWorker()
    }

    private func startOccurrenceWorker() {
        guard occurrenceWorker == nil else { return }
        occurrenceWorker = _Concurrency.Task { [weak self] in
            guard let self else { return }
            while !_Concurrency.Task.isCancelled, let pendingProfile = self.occurrenceQueue.next() {
                await self.maintainOccurrences(profileID: pendingProfile)
                self.occurrenceQueue.finish()
                await _Concurrency.Task.yield()
            }
            self.occurrenceWorker = nil
            if self.foreground, !self.occurrenceQueue.isSettled { self.startOccurrenceWorker() }
        }
    }

    /// Explicit and remote refresh requests enqueue work, but query snapshots and
    /// own upload acknowledgments do not. Each pass captures a single civil day.
    private func maintainOccurrences(profileID: String) async {
        guard let engine, let profile = profiles.first(where: { $0.id == profileID }),
            !removingProfileIDs.contains(profileID)
        else { return }
        let day = clock.viewerCalendar().today
        await maintainOccurrences(
            profileID: profileID, engine: engine,
            operations: FacetOccurrenceMaintenanceOperations(
                ready: { try await self.occurrencesReady(profile: profile, engine: engine) },
                prepare: { owns, admission in
                    await self.prepareOccurrenceMaintenance(
                        profileID: profileID, engine: engine, owns: owns, admission: admission)
                },
                overview: {
                    try await engine.occurrenceOverview(profileID: profileID, referenceDate: day)
                },
                apply: { target, owns, admission in
                    let command = target.command(automatic: true)
                    return await self.applyOccurrenceTarget(
                        profileID: profileID, owns: owns,
                        operations: FacetOccurrenceTargetOperations(
                            savedID: {
                                try await engine.savedMutationID(
                                    profileID: profileID, command: command)
                            },
                            execute: { id in
                                try await engine.execute(
                                    profileID: profileID, command: command, mutationID: id,
                                    occurrenceAdmission: admission)
                            },
                            cleanup: { try await engine.discardObservedMutation(id: $0) }))
                }))
    }

    internal func maintainOccurrences(
        profileID: String, engine: FacetEngine, operations: FacetOccurrenceMaintenanceOperations
    ) async {
        let cancellation = FacetOccurrenceAdmission()
        occurrenceAdmission = (profileID, cancellation)
        defer {
            if occurrenceAdmission?.permit === cancellation { occurrenceAdmission = nil }
        }
        let owns = occurrenceMaintenanceOwner(
            profileID: profileID, engine: engine, cancellation: cancellation)
        await withTaskCancellationHandler {
            await runOccurrenceMaintenance(
                profileID: profileID, owns: owns, admission: cancellation, operations: operations)
        } onCancel: {
            cancellation.cancel()
        }
    }

    private func runOccurrenceMaintenance(
        profileID: String, owns: @escaping () -> Bool, admission: FacetOccurrenceAdmission,
        operations: FacetOccurrenceMaintenanceOperations
    ) async {
        do {
            guard owns(), try await operations.ready(), owns() else { return }
            guard await operations.prepare(owns, admission), owns() else { return }
            // Read every page before writing. A stale snapshot aborts this pass;
            // the next request starts again from the first cursor.
            let overview = try await operations.overview()
            guard owns() else { return }
            occurrenceOverviews[profileID] = overview
            guard
                await applyOccurrenceTargets(
                    overview.targets, owns: owns, admission: admission, operations: operations)
            else { return }
            let completed = try await operations.overview()
            guard owns() else { return }
            occurrenceOverviews[profileID] = completed
            occurrenceIssues.removeValue(forKey: profileID)
            if selectedProfileID == profileID { await reloadQuery(preservingSavedNotice: true) }
        } catch {
            if owns() { occurrenceIssues[profileID] = FacetFailureDiagnostic(error).action }
        }
    }

    private func applyOccurrenceTargets(
        _ targets: [FacetOccurrenceTarget], owns: @escaping () -> Bool,
        admission: FacetOccurrenceAdmission,
        operations: FacetOccurrenceMaintenanceOperations
    ) async -> Bool {
        for target in targets {
            guard owns(), await operations.apply(target, owns, admission) else { return false }
        }
        return owns()
    }

    private func occurrencesReady(profile: FacetProfile, engine: FacetEngine) async throws -> Bool {
        if profile.kind == "obsidian_sync" {
            let eligible = try await account?.eligibleReminderProfileIDs() ?? []
            guard eligible.contains(profile.id) else { return false }
        }
        let discovery = try await engine.features(
            profileID: profile.id, request: .object(["kind": .string("discovery")]))
        let fields = discovery.object?.fields
        return (fields?["configurationAvailable"] == .bool(true) || profile.approveStandard)
            && (profile.kind != "obsidian_sync" || fields?["initialSyncComplete"] == .bool(true))
    }

    private func prepareOccurrenceMaintenance(
        profileID: String, engine: FacetEngine, owns: @escaping () -> Bool,
        admission: FacetOccurrenceAdmission
    ) async -> Bool {
        await actionCoordinator.submit {
            guard owns() else { return false }
            do {
                try await engine.resumeOccurrenceMaintenance(
                    profileID: profileID, admission: admission)
                guard owns() else { return false }
                _ = try await engine.refresh(profileID: profileID)
                return owns()
            } catch {
                if owns() {
                    self.occurrenceIssues[profileID] = FacetFailureDiagnostic(error).action
                }
                return false
            }
        }
    }

    internal func applyOccurrenceTarget(
        profileID: String, owns: @escaping () -> Bool,
        operations: FacetOccurrenceTargetOperations
    ) async -> Bool {
        await actionCoordinator.submit {
            guard owns() else { return false }
            do {
                let id = try await operations.savedID() ?? UUID().uuidString
                guard owns() else { return false }
                try await operations.execute(id)
                // Once admitted, finish receipt observation even if presentation
                // ownership changes. Uncertain envelopes stay durable on failure.
                try await operations.cleanup(id)
                return true
            } catch {
                if owns() {
                    self.occurrenceIssues[profileID] = FacetFailureDiagnostic(error).action
                }
                return false
            }
        }
    }

    internal func occurrenceMaintenanceOwner(
        profileID: String, engine: FacetEngine,
        cancellation: FacetOccurrenceAdmission
    ) -> () -> Bool {
        let lifecycle = syncGeneration
        let capturedAccount = account
        let lease = backgroundLease
        return { [weak self] in
            guard let self else { return false }
            return self.engine === engine && self.account === capturedAccount
                && self.syncGeneration == lifecycle && !self.accountTransition
                && self.profiles.contains(where: { $0.id == profileID })
                && !self.removingProfileIDs.contains(profileID)
                && (self.foreground || (lease != nil && self.backgroundLease == lease))
                && !cancellation.isCancelled && !_Concurrency.Task.isCancelled
        }
    }

    public func loadOccurrenceOverview(profileID: String) async {
        guard let engine else { return }
        do {
            let overview = try await engine.occurrenceOverview(
                profileID: profileID, referenceDate: clock.viewerCalendar().today)
            guard self.engine === engine, !removingProfileIDs.contains(profileID) else { return }
            occurrenceOverviews[profileID] = overview
        } catch {
            if self.engine === engine {
                occurrenceIssues[profileID] = FacetFailureDiagnostic(error).action
            }
        }
    }

    internal func settleOccurrenceAction(
        applied: Bool, admission: FacetMutationAdmission?,
        action: (profileID: String, mutationID: String),
        engine: FacetEngine, ownsPresentation: () -> Bool
    ) async {
        let (profileID, mutationID) = action
        if !applied, admission?.mutationID != nil {
            await refreshSavedActions(
                ownsPresentation: { self.engine === engine },
                load: { try await engine.pendingMutations() })
        }
        guard applied else { return }
        await observeOccurrenceSuccessors(
            profileID: profileID, mutationID: mutationID, ownsPresentation: ownsPresentation)
        requestOccurrenceMaintenance(profileID: profileID)
    }

    private func observeOccurrenceSuccessors(
        profileID: String, mutationID: String, ownsPresentation: () -> Bool
    ) async {
        guard let engine else { return }
        do {
            let successors = try FacetFeatureProjection.decode(
                FacetOccurrenceSuccessors.self,
                from: await engine.features(
                    profileID: profileID,
                    request: .object([
                        "kind": .string("occurrence_successors"), "mutationId": .string(mutationID),
                    ])))
            if ownsPresentation(), self.engine === engine,
                successors.items.contains(where: \.needsAttention)
            {
                let notice = "Future occurrences need attention in the task’s Series section."
                savedNotice = [savedNotice, notice].compactMap { $0 }.joined(separator: "\n")
            }
            await loadOccurrenceOverview(profileID: profileID)
        } catch {
            // A successful primary action stays successful if discovery fails.
            if self.engine === engine {
                occurrenceIssues[profileID] = FacetFailureDiagnostic(error).action
            }
        }
    }
}
