public import Foundation
public import TaskNotesKit

extension FacetStore {
    public func signIn(email: String, password: String, code: String, requestID: UUID = UUID())
        async
    {
        guard let account else {
            accountPresentation.error =
                "Obsidian sign-in is unavailable. Close this sheet and reopen Facet to finish startup."
            return
        }
        await signInWithOperations(
            prepare: {
                account.fenceSessionAccess()
                await self.stopSessions()
                await self.reminders.cancel(
                    profileIDs: Set(self.profiles.filter { $0.kind == "obsidian_sync" }.map(\.id)))
            },
            signIn: { try await account.signIn(email: email, password: password, code: code) },
            connections: { await account.connections() }, ownsAccount: { self.account === account },
            resume: { await self.resumeSync() },
            requestID: requestID)
    }

    internal func signInWithOperations(
        prepare: () async -> Void,
        signIn: () async throws -> FacetAccountSignIn,
        connections: () async -> [FacetVaultConnection],
        ownsAccount: @escaping @MainActor () -> Bool,
        resume: @escaping @MainActor () async -> Void,
        requestID: UUID = UUID()
    ) async {
        guard !_Concurrency.Task.isCancelled else { return }
        guard !accountTransition, !isLoading else {
            accountPresentation.error =
                "Facet is finishing another operation. Try again shortly."
            return
        }
        let request = requestID
        accountPresentation.requestID = request
        accountPresentation.cancelled = false
        accountPresentation.operation = .signingIn
        accountPresentation.restoreFailed = false
        accountPresentation.error = nil
        accountPresentation.notice = nil
        accountTransition = true
        syncGeneration += 1
        remoteVaults = []
        requestGeneration += 1
        isLoading = true
        await performAccountSignIn(
            request: request, prepare: prepare, signIn: signIn,
            connections: connections, ownsAccount: ownsAccount)
        guard accountPresentation.requestID == request else { return }
        finishAccountRequest(request)
        // A dismissed challenge still leaves the previous credentials usable.
        // Drain authentication before reopening only the current foreground owner.
        let settledGeneration = syncGeneration
        await _Concurrency.Task { @MainActor in
            guard self.foreground, !self.accountTransition,
                self.accountPresentation.requestID == nil,
                self.syncGeneration == settledGeneration, ownsAccount()
            else { return }
            await resume()
        }.value
    }

    private func performAccountSignIn(
        request: UUID, prepare: () async -> Void,
        signIn: () async throws -> FacetAccountSignIn,
        connections: () async -> [FacetVaultConnection], ownsAccount: () -> Bool
    ) async {
        await prepare()
        guard ownsAccountRequest(request), ownsAccount() else { return }
        do {
            let result = try await signIn()
            guard ownsAccountRequest(request), ownsAccount() else { return }
            switch result {
            case .needsCode:
                accountNeedsCode = true
                accountPresentation.stage = .verification
                accountPresentation.notice =
                    "Enter the verification code from your authenticator app."
            case .rejectedCode:
                accountNeedsCode = true
                accountPresentation.stage = .verification
                accountPresentation.error = "The verification code was rejected. Enter a new code."
            case .vaults(let vaults):
                let connected = await connections()
                guard ownsAccountRequest(request), ownsAccount() else { return }
                accountNeedsCode = false
                accountPresentation.stage = .vaults
                remoteVaults = vaults
                vaultConnections = connected
                accountPresentation.notice =
                    vaults.isEmpty
                    ? "Signed in. This account has no Obsidian Sync vaults. "
                        + "Create a remote vault in Obsidian, then sign in again to refresh this list."
                    : "Signed in. Choose a Sync vault to connect."
            }
        } catch {
            guard ownsAccountRequest(request), ownsAccount() else { return }
            accountPresentation.error = FacetAccountPresentation.failureMessage(error)
        }
    }

    internal func resetAccountChallenge() {
        guard !accountPresentation.isBusy else { return }
        accountNeedsCode = false
        accountPresentation.stage = .credentials
        accountPresentation.error = nil
        accountPresentation.notice = nil
    }

    internal func accountCredentialsChanged() {
        if accountPresentation.stage != .vaults { resetAccountChallenge() }
    }

    internal func cancelAccountRequest(id: UUID) {
        guard accountPresentation.isBusy, accountPresentation.requestID == id else { return }
        accountPresentation.cancelled = true
        if accountPresentation.operation != .restoring { account?.fenceSessionAccess() }
        accountPresentation.notice = "Account request cancelled. You can try again."
        accountPresentation.error = nil
    }

    private func ownsAccountRequest(_ request: UUID) -> Bool {
        accountPresentation.requestID == request && !accountPresentation.cancelled
            && foreground && !_Concurrency.Task.isCancelled
    }

    private func finishAccountRequest(_ request: UUID) {
        guard accountPresentation.requestID == request else { return }
        accountPresentation.requestID = nil
        accountPresentation.operation = nil
        accountTransition = false
        isLoading = false
    }

    public func connectRemote(
        _ vault: FacetRemoteVault, password: String?, existingProfileID: String? = nil,
        requestID: UUID = UUID()
    ) async {
        guard let account, let engine else {
            accountPresentation.error =
                "Vault connection is unavailable. Reopen Facet to finish startup."
            return
        }
        guard !_Concurrency.Task.isCancelled else { return }
        guard !accountTransition, !isLoading else {
            accountPresentation.error = "Facet is finishing another operation. Try again shortly."
            return
        }
        let request = requestID
        accountPresentation.requestID = request
        accountPresentation.cancelled = false
        accountPresentation.operation = .connecting
        accountPresentation.error = nil
        accountTransition = true
        account.fenceSessionAccess()
        syncGeneration += 1
        requestGeneration += 1
        isLoading = true
        defer { finishAccountRequest(request) }
        do {
            try requireAcceptanceRemoteVault(vault.id)
            await stopSessions()
            guard ownsAccountRequest(request), self.account === account, self.engine === engine
            else { return }
            let profile = try await connectedProfile(
                account: account, engine: engine, vaultID: vault.id,
                password: password, existingProfileID: existingProfileID)
            let connectedProfiles = try await engine.profiles()
            if self.engine === engine { profiles = connectedProfiles }
            guard ownsAccountRequest(request), self.account === account, self.engine === engine
            else { return }
            remoteVaults = []
            await completeAccountConnection(
                requestID: request, select: { await self.selectProfile(profile.id) },
                resume: { await self.resumeSync() },
                ownsAccount: { self.account === account && self.engine === engine })
            return
        } catch {
            await settleAccountConnectionFailure(
                error, requestID: request, reload: { try await engine.profiles() },
                ownsEngine: { self.engine === engine }, ownsAccount: { self.account === account })
        }
        await finishAccountConnection { await self.resumeSync() }
    }

    internal func completeAccountConnection(
        requestID: UUID, select: () async -> Void, resume: () async -> Void,
        ownsAccount: () -> Bool
    ) async {
        await select()
        guard ownsAccountRequest(requestID), ownsAccount() else { return }
        await finishAccountConnection(resume: resume)
        guard ownsAccountRequest(requestID), ownsAccount() else { return }
        finishAccountRequest(requestID)
        accountPresentation = FacetAccountPresentation()
        accountNeedsCode = false
        showsAccount = false
    }

    private func requireAcceptanceRemoteVault(_ vaultID: String) throws {
        #if DEBUG
            try acceptanceConfiguration?.requireRemoteVault(vaultID)
        #endif
    }

    private func connectedProfile(
        account: FacetObsidianAccount, engine: FacetEngine, vaultID: String,
        password: String?, existingProfileID: String?
    ) async throws -> FacetProfile {
        if let existingProfileID {
            return try await account.reauthorize(
                profileID: existingProfileID, vaultID: vaultID, password: password, engine: engine)
        }
        return try await account.connect(vaultID: vaultID, password: password, engine: engine)
    }

    internal func settleAccountConnectionFailure(
        _ failure: any Error, requestID: UUID, reload: () async throws -> [FacetProfile],
        ownsEngine: () -> Bool, ownsAccount: () -> Bool
    ) async {
        // Cancellation may follow registration of a durable private replica.
        do {
            let registered = try await reload()
            if ownsEngine() { profiles = registered }
        } catch {
            if ownsEngine(), ownsAccountRequest(requestID) { reportNativeFailure(error) }
        }
        if ownsAccountRequest(requestID), ownsAccount() {
            accountPresentation.error = FacetAccountPresentation.failureMessage(failure)
        }
    }

    /// Authorization and the previous writer have settled before new effects start.
    /// A rejected reconnect may leave other authorized profiles eligible.
    internal func finishAccountConnection(resume: () async -> Void) async {
        accountTransition = false
        if foreground { await resume() }
    }

    public func signOut() async {
        _ = await FacetDraftCoordinator.shared.transition(owner: self) {
            await self.signOutAfterDrafts {
                await self.reminders.cancel(
                    profileIDs: Set(self.profiles.filter { $0.kind == "obsidian_sync" }.map(\.id)))
            }
        }
    }

    internal func signOutAfterDrafts(cancelReminders: @MainActor () async -> Void) async {
        guard let account, !accountTransition else { return }
        accountTransition = true
        defer { accountTransition = false }
        account.fenceSessionAccess()
        syncGeneration += 1
        requestGeneration += 1
        remoteVaults = []
        await stopSessions()
        await cancelReminders()
        remoteVaults = []
        vaultConnections = []
        accountNeedsCode = false
        accountPresentation = FacetAccountPresentation()
        do { try await account.signOut() } catch { self.error = error.localizedDescription }
        for profile in profiles where profile.kind == "obsidian_sync" {
            let state = FacetSyncStatus(transport: .reconnectRequired)
            syncStatuses[profile.id] = state
            syncStates[profile.id] = state.message
        }
    }

    public func resumeSync(isForeground: Bool = true) async {
        await resumeSync(isForeground: isForeground) { [weak self] profileID, generation in
            await self?.openSyncSession(
                profileID: profileID, generation: generation, isForeground: isForeground)
        }
        if isForeground {
            for profile in profiles { requestOccurrenceMaintenance(profileID: profile.id) }
        }
    }

    internal func resumeSync(
        isForeground: Bool, openSession: (String, UInt64) async -> Void
    ) async {
        if isForeground {
            foreground = true
            backgroundLease = nil
            syncGeneration += 1
        }
        guard !accountTransition else { return }
        guard let account, let engine else { return }
        let attempt = syncGeneration
        let cleanup = await account.retryDetachedProfileCleanup()
        guard ownsSyncAttempt(attempt, account: account, engine: engine) else { return }
        if let failure = cleanup.first {
            error = "Private profile cleanup is pending. " + failure.action
        }
        if isForeground {
            await retireDisconnectedSessions(
                generation: attempt, account: account, engine: engine)
        }
        for profile in profiles
        where profile.kind == "obsidian_sync" && sessions[profile.id] == nil
            && !removingProfileIDs.contains(profile.id)
        {
            guard ownsSyncAttempt(attempt, account: account, engine: engine) else { return }
            await openSession(profile.id, attempt)
        }
    }

    private func openSyncSession(profileID: String, generation: UInt64, isForeground: Bool) async {
        guard let engine, let account else { return }
        do {
            _ = try await FacetObsidianSession.open(
                engine: engine, account: account, profileID: profileID,
                changed: { [weak self] in
                    await self?.refreshSyncOwner(profileID: profileID, generation: generation)
                },
                status: { [weak self] state in
                    await self?.updateSyncState(
                        profileID: profileID, state: state, generation: generation)
                },
                remoteChanged: { [weak self] in
                    guard let self,
                        await self.ownsSyncCallback(profileID: profileID, generation: generation)
                    else { return }
                    await self.requestOccurrenceMaintenance(profileID: profileID)
                },
                retain: { [weak self] session in
                    await self?.retainSession(
                        session, profileID: profileID, generation: generation) ?? false
                })
        } catch {
            reportSyncFailure(
                error, profileID: profileID, generation: generation, isForeground: isForeground)
        }
    }

    private func reportSyncFailure(
        _ failure: any Error, profileID: String, generation: UInt64, isForeground: Bool
    ) {
        guard generation == syncGeneration else { return }
        if isForeground {
            syncStates[profileID] = failure.localizedDescription
        } else {
            reportBackgroundFailure(failure)
            syncStates[profileID] = FacetFailureDiagnostic(failure).action
        }
        syncStatuses[profileID] = FacetSyncStatus(transport: .reconnectRequired)
    }

    public func pauseSync() async {
        foreground = false
        backgroundLease = nil
        occurrenceWorker?.cancel()
        await stopSessions()
    }
    internal func stopSessions() async {
        syncGeneration += 1
        let running = sessions
        sessions = [:]
        syncSessionGenerations = [:]
        for id in running.keys {
            let state = FacetSyncStatus(transport: .stopped)
            syncStatuses[id] = state
            syncStates[id] = state.message
        }
        for session in running.values { await session.stop() }
    }
    internal func canRetainSession(profileID: String, generation: UInt64) -> Bool {
        !accountTransition && generation == syncGeneration && sessions[profileID] == nil
            && !removingProfileIDs.contains(profileID)
            && profiles.contains { $0.id == profileID && $0.kind == "obsidian_sync" }
    }

    private func retainSession(
        _ session: FacetObsidianSession, profileID: String, generation: UInt64
    ) async -> Bool {
        guard canRetainSession(profileID: profileID, generation: generation) else { return false }
        #if DEBUG
            do {
                try await prepareAcceptanceInterruption(session, profileID: profileID)
            } catch { return false }
            guard canRetainSession(profileID: profileID, generation: generation) else {
                return false
            }
        #endif
        sessions[profileID] = session
        syncSessionGenerations[profileID] = generation
        return true
    }

    internal func ownsSyncCallback(profileID: String, generation: UInt64) -> Bool {
        !accountTransition && sessions[profileID] != nil
            && syncSessionGenerations[profileID] == generation
            && !removingProfileIDs.contains(profileID)
    }

    internal func updateSyncState(profileID: String, state: FacetSyncStatus, generation: UInt64) {
        guard ownsSyncCallback(profileID: profileID, generation: generation) else { return }
        let becameReady =
            state.durable?.initialSyncComplete == true
            && occurrenceReadySessions[profileID] != generation
        syncStatuses[profileID] = state
        syncStates[profileID] = state.message
        if becameReady {
            occurrenceReadySessions[profileID] = generation
            requestOccurrenceMaintenance(profileID: profileID)
        }
    }

    private func refreshSyncOwner(profileID: String, generation: UInt64) async {
        guard ownsSyncCallback(profileID: profileID, generation: generation),
            selectedProfileID == profileID
        else { return }
        await refresh(schedulingOccurrences: false)
    }
}
