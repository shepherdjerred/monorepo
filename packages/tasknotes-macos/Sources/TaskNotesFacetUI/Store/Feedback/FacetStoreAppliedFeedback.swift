extension FacetStore {
    internal func clearAppliedFeedback(ifMatching expected: FacetAppliedFeedback) {
        guard appliedFeedback == expected else { return }
        appliedFeedback = nil
    }
}
