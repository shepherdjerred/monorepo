package red.sjer.facet.host

/** The actual VM work boundary fences stale failures before classifying current contracts. */
object FacetWorkFailure {
    fun present(failure: Exception, ownAppliedAction: Boolean, currentAction: Boolean): String? {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        if (!currentAction) return null
        if (failure is FacetTrackingContractException || failure is FacetReceiptContractException) throw failure
        return if (failure is java.io.IOException && ownAppliedAction)
            "Saved. Refresh the vault to update the list."
        else FacetEngineRunner.failureMessage(failure)
    }
}
