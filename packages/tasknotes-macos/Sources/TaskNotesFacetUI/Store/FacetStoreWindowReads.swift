public import TaskNotesKit

extension FacetStore {
    /// Independent read-only queries do not retire or redirect pending actions.
    public func readWindowSnapshot(profileID: String, query: FacetValue) async throws
        -> FacetSnapshot?
    {
        guard let engine else { return nil }
        let lifecycle = syncGeneration
        let selection = selectionGeneration
        guard selectedProfileID == profileID, !removingProfileIDs.contains(profileID) else {
            return nil
        }
        let result = try await engine.cachedSnapshot(profileID: profileID, query: query)
        guard self.engine === engine, lifecycle == syncGeneration,
            selection == selectionGeneration, selectedProfileID == profileID,
            !removingProfileIDs.contains(profileID)
        else { return nil }
        return result
    }
}
