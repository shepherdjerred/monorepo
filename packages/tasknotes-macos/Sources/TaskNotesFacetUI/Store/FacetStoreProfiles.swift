import Foundation
public import TaskNotesKit

extension FacetStore {
    public func processIntentCaptures(_ queue: FacetIntentQueue) async {
        guard let engine, !isSaving else { return }
        do {
            var page = try queue.pending()
            // Widget publication also polls this queue during initial refresh.
            // An empty poll must not retire that refresh or its presentation.
            guard !page.isEmpty else { return }
            activeMutationID = "intent-queue"
            isSaving = true
            defer {
                activeMutationID = nil
                isSaving = false
            }
            while true {
                for capture in page {
                    try await engine.applyIntentCapture(capture)
                    try queue.acknowledge(id: capture.id)
                }
                guard page.count == 128, let last = page.last else { break }
                page = try queue.pending(afterID: last.id)
            }
            pendingActions = try await engine.pendingMutations()
            // Processing can supersede the initial refresh. Scan the vault as
            // well as observing the capture so existing files remain visible.
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    public func selectProfile(_ id: String) async {
        _ = await FacetDraftCoordinator.shared.transition(owner: self) {
            self.selectProfilePresentation(id)
            UserDefaults.standard.set(id, forKey: "Facet.selectedProfile")
            await self.refresh()
        }
    }

    internal func selectProfilePresentation(_ id: String) {
        requestGeneration += 1
        selectedProfileID = id
        snapshot = nil
        displayedQuery = nil
        savedQuery = [:]
        selectedViewID = nil
        savedNotice = nil
    }

    public func refresh() async {
        guard let engine, let profileID = selectedProfileID else { return }
        let logicalQuery = query()
        await refreshWithOperations(
            profileID: profileID, logicalQuery: logicalQuery,
            operations: FacetRefreshOperations(
                cached: {
                    try await engine.cachedSnapshot(profileID: profileID, query: logicalQuery)
                },
                discovery: {
                    try await engine.features(
                        profileID: profileID,
                        request: .object([
                            "schemaVersion": .integer(1), "kind": .string("discovery"),
                        ]))
                }, refresh: { _ = try await engine.refresh(profileID: profileID) },
                snapshot: { try await engine.snapshot(profileID: profileID, query: logicalQuery) },
                ownsEngine: { self.engine === engine }))
    }

    public func reloadQuery() async {
        await reloadQuery(preservingSavedNotice: false)
    }

    internal func reloadQuery(preservingSavedNotice: Bool) async {
        guard let engine, let profileID = selectedProfileID else { return }
        let logicalQuery = query()
        await loadQuerySnapshot(
            profileID: profileID, logicalQuery: logicalQuery,
            preservingSavedNotice: preservingSavedNotice,
            ownsEngine: { self.engine === engine },
            load: { try await engine.snapshot(profileID: profileID, query: logicalQuery) })
    }

    internal func loadQuerySnapshot(
        profileID: String, logicalQuery: FacetValue, preservingSavedNotice: Bool = false,
        ownsEngine: @escaping () -> Bool,
        load: () async throws -> FacetSnapshot
    ) async {
        let notice = preservingSavedNotice ? savedNotice : nil
        requestGeneration += 1
        if preservingSavedNotice { savedNotice = notice }
        let current = presentationOwner(profileID: profileID, ownsEngine: ownsEngine)
        guard current() else { return }
        displayedQuery = nil
        do {
            let result = try await load()
            guard current() else { return }
            guard result.profileId == profileID else {
                throw FacetContractError.unsupportedResponse
            }
            snapshot = result
            displayedQuery = logicalQuery
        } catch { if current() { reportNativeFailure(error) } }
    }

    public func loadMore() async {
        guard let engine, let profileID = selectedProfileID else { return }
        await loadMoreWithOperations(
            profileID: profileID, ownsEngine: { self.engine === engine },
            load: { try await engine.snapshot(profileID: profileID, query: $0) },
            reload: { await self.reloadQuery() })
    }

    internal func loadMoreWithOperations(
        profileID: String, ownsEngine: @escaping () -> Bool,
        load: (FacetValue) async throws -> FacetSnapshot, reload: () async -> Void
    ) async {
        guard let previous = snapshot,
            previous.totalCount > UInt64(previous.tasks.count), !isLoading
        else { return }
        let current = presentationOwner(profileID: profileID, ownsEngine: ownsEngine)
        guard current() else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            guard previous.profileId == profileID else {
                throw FacetContractError.unsupportedResponse
            }
            let page = try await load(displayedPageQuery(offset: previous.tasks.count))
            guard current() else { return }
            if page.version != previous.version {
                await reload()
                return
            }
            guard !page.tasks.isEmpty else { throw FacetContractError.unsupportedResponse }
            snapshot = try previous.appending(page)
        } catch { if current() { reportNativeFailure(error) } }
    }
}
