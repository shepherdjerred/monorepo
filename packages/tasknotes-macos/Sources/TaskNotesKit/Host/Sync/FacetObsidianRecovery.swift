extension FacetObsidianSession {
    internal func recordWorkerFailure(_ error: any Error) {
        restartableTransportFailure = error is FacetSyncSendFailure
        transportPhase = restartableTransportFailure ? .offline : .failed
    }

    /// A new foreground owner may replace a fully retired, authorized transport.
    /// A background poll or an arbitrary failed session must not trigger retries.
    public func requiresForegroundTransportRestart() async -> Bool {
        guard retirementCompleted, !stopped, restartableTransportFailure else { return false }
        let authorized = await account.allows(access)
        return authorized && retirementCompleted && !stopped && restartableTransportFailure
    }
}
