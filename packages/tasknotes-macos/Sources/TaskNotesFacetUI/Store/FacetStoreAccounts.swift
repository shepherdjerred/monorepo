import Foundation
public import TaskNotesKit

extension FacetStore {
    public func signIn(email: String, password: String, code: String) async {
        guard let account, !isLoading else { return }
        accountTransition = true
        account.fenceSessionAccess()
        syncGeneration += 1
        remoteVaults = []
        requestGeneration += 1
        isLoading = true
        defer {
            isLoading = false
            accountTransition = false
        }
        await stopSessions()
        await reminders.cancel(
            profileIDs: Set(profiles.filter { $0.kind == "obsidian_sync" }.map(\.id)))
        remoteVaults = []
        do {
            switch try await account.signIn(email: email, password: password, code: code) {
            case .needsCode: accountNeedsCode = true
            case .rejectedCode:
                accountNeedsCode = true
                error = "The verification code was rejected. Enter a new code."
            case .vaults(let vaults):
                accountNeedsCode = false
                remoteVaults = vaults
                vaultConnections = await account.connections()
            }
        } catch { self.error = error.localizedDescription }
    }

    public func connectRemote(
        _ vault: FacetRemoteVault, password: String?, existingProfileID: String? = nil
    ) async {
        guard let account, let engine, !isLoading else { return }
        accountTransition = true
        account.fenceSessionAccess()
        syncGeneration += 1
        requestGeneration += 1
        isLoading = true
        defer {
            isLoading = false
            accountTransition = false
        }
        do {
            await stopSessions()
            let profile: FacetProfile
            if let existingProfileID {
                profile = try await account.reauthorize(
                    profileID: existingProfileID, vaultID: vault.id, password: password,
                    engine: engine)
            } else {
                profile = try await account.connect(
                    vaultID: vault.id, password: password, engine: engine)
            }
            profiles = try await engine.profiles()
            remoteVaults = []
            showsAccount = false
            await selectProfile(profile.id)
        } catch { reportNativeFailure(error) }
        await finishAccountConnection { await self.resumeSync() }
    }

    /// Authorization and the previous writer have settled before new effects start.
    /// A rejected reconnect may leave other authorized profiles eligible.
    internal func finishAccountConnection(resume: () async -> Void) async {
        accountTransition = false
        if foreground { await resume() }
    }

    public func signOut() async {
        guard let account, !accountTransition else { return }
        accountTransition = true
        defer { accountTransition = false }
        account.fenceSessionAccess()
        syncGeneration += 1
        requestGeneration += 1
        remoteVaults = []
        await stopSessions()
        await reminders.cancel(
            profileIDs: Set(profiles.filter { $0.kind == "obsidian_sync" }.map(\.id)))
        remoteVaults = []
        vaultConnections = []
        accountNeedsCode = false
        do { try await account.signOut() } catch { self.error = error.localizedDescription }
    }

    public func resumeSync(isForeground: Bool = true) async {
        guard !accountTransition else { return }
        if isForeground {
            foreground = true
            backgroundLease = nil
            syncGeneration += 1
        }
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
