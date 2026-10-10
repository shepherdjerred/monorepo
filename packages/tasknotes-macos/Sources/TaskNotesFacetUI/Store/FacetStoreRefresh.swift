import TaskNotesKit

@MainActor
internal struct FacetRefreshOperations {
    let cached: () async throws -> FacetSnapshot?
    let discovery: () async throws -> FacetValue
    let refresh: () async throws -> Void
    let snapshot: () async throws -> FacetSnapshot
    let ownsEngine: () -> Bool
}

extension FacetStore {
    internal func refreshWithOperations(
        profileID: String, logicalQuery: FacetValue, operations: FacetRefreshOperations
    ) async {
        requestGeneration += 1
        let current = presentationOwner(profileID: profileID, ownsEngine: operations.ownsEngine)
        guard current() else { return }
        displayedQuery = nil
        do {
            let cached = try await operations.cached()
            guard current() else { return }
            guard cached == nil || cached?.profileId == profileID else {
                throw FacetContractError.unsupportedResponse
            }
            snapshot = cached
            displayedQuery = cached == nil ? nil : logicalQuery
            let discovery = try await operations.discovery()
            guard current() else { return }
            if shouldWaitForConfiguration(
                profileID: profileID, discovery: discovery, cached: cached)
            {
                return
            }
            try await operations.refresh()
            guard current() else { return }
            let result = try await operations.snapshot()
            guard current() else { return }
            guard result.profileId == profileID else {
                throw FacetContractError.unsupportedResponse
            }
            snapshot = result
            displayedQuery = logicalQuery
        } catch { if current() { reportNativeFailure(error) } }
    }

    private func shouldWaitForConfiguration(
        profileID: String, discovery: FacetValue, cached: FacetSnapshot?
    ) -> Bool {
        let synced = profiles.first(where: { $0.id == profileID })?.kind == "obsidian_sync"
        needsStandardConsent =
            (!synced || discovery.object?.fields["initialSyncComplete"] == .bool(true))
            && discovery.object?.fields["configurationAvailable"] == .bool(false)
        return needsStandardConsent
            || (synced && discovery.object?.fields["initialSyncComplete"] == .bool(false)
                && cached == nil)
    }
}
