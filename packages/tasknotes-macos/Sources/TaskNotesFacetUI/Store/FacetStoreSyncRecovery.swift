import TaskNotesKit

extension FacetStore {
    internal func ownsSyncAttempt(
        _ attempt: UInt64, account: FacetObsidianAccount, engine: FacetEngine
    ) -> Bool {
        attempt == syncGeneration && !accountTransition
            && self.account === account && self.engine === engine
    }

    internal func retireDisconnectedSessions(
        generation: UInt64, account: FacetObsidianAccount, engine: FacetEngine
    ) async {
        for (profileID, session) in sessions {
            guard ownsSyncAttempt(generation, account: account, engine: engine) else { return }
            let restart = await session.requiresForegroundTransportRestart()
            guard ownsSyncAttempt(generation, account: account, engine: engine) else { return }
            guard restart, sessions[profileID] === session else { continue }
            sessions.removeValue(forKey: profileID)
            syncSessionGenerations.removeValue(forKey: profileID)
        }
    }
}
