import Foundation
import TaskNotesKit

extension FacetStore {
    internal func restoreAccountSession(startup: Bool = false, requestID: UUID = UUID()) async {
        guard let account else { return }
        await restoreAccountSessionWithOperations(
            restore: { try await account.restoreSession() },
            connections: { await account.connections() }, ownsAccount: { self.account === account },
            startup: startup, requestID: requestID)
    }

    internal func restoreAccountSessionWithOperations(
        restore: () async throws -> FacetAccountSessionRestore,
        connections: () async -> [FacetVaultConnection], ownsAccount: @escaping () -> Bool,
        startup: Bool = false, requestID: UUID = UUID()
    ) async {
        guard !_Concurrency.Task.isCancelled, foreground, !accountTransition,
            startup || !isLoading
        else { return }
        let wasLoading = isLoading
        let lifecycle = syncGeneration
        var settled = false
        accountPresentation.requestID = requestID
        accountPresentation.cancelled = false
        accountPresentation.operation = .restoring
        accountPresentation.restoreFailed = false
        accountPresentation.restoreAttempted = true
        accountPresentation.error = nil
        accountPresentation.notice = nil
        accountNeedsCode = false
        remoteVaults = []
        accountPresentation.stage = .credentials
        isLoading = true
        let owns = {
            self.accountPresentation.requestID == requestID
                && !self.accountPresentation.cancelled && self.foreground
                && self.syncGeneration == lifecycle && ownsAccount()
                && !_Concurrency.Task.isCancelled
        }
        defer {
            if accountPresentation.requestID == requestID {
                if !settled { accountPresentation.restoreAttempted = false }
                accountPresentation.requestID = nil
                accountPresentation.operation = nil
                isLoading = wasLoading
            }
        }
        do {
            let restored = try await restore()
            guard owns() else { return }
            let connected = await connections()
            guard owns() else { return }
            publishRestoredAccount(restored, connections: connected)
            settled = true
        } catch {
            guard owns() else { return }
            accountPresentation.restoreFailed = true
            accountPresentation.error = FacetAccountPresentation.failureMessage(error)
            settled = true
        }
    }

    private func publishRestoredAccount(
        _ restored: FacetAccountSessionRestore, connections: [FacetVaultConnection]
    ) {
        switch restored {
        case .noSession: accountPresentation.stage = .credentials
        case .expired:
            accountPresentation.error = "Your Obsidian session expired. Sign in again to continue."
        case .vaults(let vaults):
            remoteVaults = vaults
            vaultConnections = connections
            accountPresentation.stage = .vaults
            accountPresentation.notice =
                vaults.isEmpty
                ? "Signed in. This account has no Obsidian Sync vaults."
                : "Signed in. Choose a Sync vault to connect."
        }
    }
}
