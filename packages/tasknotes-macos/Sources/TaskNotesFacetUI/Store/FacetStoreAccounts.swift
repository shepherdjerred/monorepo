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
            requestID: requestID)
    }

    internal func signInWithOperations(
        prepare: () async -> Void,
        signIn: () async throws -> FacetAccountSignIn,
        connections: () async -> [FacetVaultConnection], ownsAccount: () -> Bool,
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
        accountPresentation.error = nil
        accountPresentation.notice = nil
        accountTransition = true
        syncGeneration += 1
        remoteVaults = []
        requestGeneration += 1
        isLoading = true
        defer { finishAccountRequest(request) }
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
            accountPresentation.error = accountFailureMessage(error)
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
        account?.fenceSessionAccess()
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

    private func accountFailureMessage(_ failure: any Error) -> String {
        if let url = failure as? URLError {
            return url.code == .timedOut
                ? "The account request timed out. Check your connection and try again."
                : "Could not reach Obsidian. Check your connection and try again."
        }
        let classification = FacetFailureDiagnostic(failure).classification
        if classification == "account" { return "Unlock this device and try signing in again." }
        if classification == "network" {
            return "Could not reach Obsidian. Check your connection and try again."
        }
        if classification == "cancelled" {
            return "The account request was cancelled. Try again when ready."
        }
        if classification == "internal_contract" {
            return
                "Facet could not read the Obsidian account response. Reopen or update Facet before retrying."
        }
        return
            "The Obsidian account request could not finish. Check your credentials and try again. "
            + "If this continues, reopen Facet."
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
            await stopSessions()
            guard ownsAccountRequest(request), self.account === account, self.engine === engine
            else { return }
            let profile: FacetProfile
            if let existingProfileID {
                profile = try await account.reauthorize(
                    profileID: existingProfileID, vaultID: vault.id, password: password,
                    engine: engine)
            } else {
                profile = try await account.connect(
                    vaultID: vault.id, password: password, engine: engine)
            }
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
            accountPresentation.error = accountFailureMessage(failure)
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
    }

    public func resumeSync(isForeground: Bool = true) async {
        if isForeground {
            foreground = true
            backgroundLease = nil
            syncGeneration += 1
        }
        guard !accountTransition else { return }
        guard let account, let engine else { return }
        let cleanup = await account.retryDetachedProfileCleanup()
        if let failure = cleanup.first {
            error = "Private profile cleanup is pending. " + failure.action
        }
        let attempt = syncGeneration
        for profile in profiles
        where profile.kind == "obsidian_sync" && sessions[profile.id] == nil
            && !removingProfileIDs.contains(profile.id)
        {
            do {
                _ = try await FacetObsidianSession.open(
                    engine: engine, account: account, profileID: profile.id,
                    changed: { [weak self] in
                        guard let self else { return }
                        if await self.selectedProfileID == profile.id { await self.refresh() }
                    },
                    status: { [weak self] text in
                        await self?.updateSyncState(profileID: profile.id, text: text)
                    },
                    retain: { [weak self] session in
                        await self?.retainSession(
                            session, profileID: profile.id, generation: attempt)
                            ?? false
                    })
            } catch {
                if attempt == syncGeneration {
                    if isForeground {
                        syncStates[profile.id] = error.localizedDescription
                    } else {
                        reportBackgroundFailure(error)
                        syncStates[profile.id] = FacetFailureDiagnostic(error).action
                    }
                }
            }
        }
    }

    public func pauseSync() async {
        foreground = false
        backgroundLease = nil
        await stopSessions()
    }
    internal func stopSessions() async {
        syncGeneration += 1
        let running = sessions
        sessions = [:]
        for session in running.values { await session.stop() }
    }
    internal func canRetainSession(profileID: String, generation: UInt64) -> Bool {
        !accountTransition && generation == syncGeneration && sessions[profileID] == nil
            && !removingProfileIDs.contains(profileID)
            && profiles.contains { $0.id == profileID && $0.kind == "obsidian_sync" }
    }

    private func retainSession(
        _ session: FacetObsidianSession, profileID: String, generation: UInt64
    ) -> Bool {
        guard canRetainSession(profileID: profileID, generation: generation) else { return false }
        sessions[profileID] = session
        return true
    }
    private func updateSyncState(profileID: String, text: String) { syncStates[profileID] = text }
}
