package red.sjer.facet.host

import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Owning lifecycle has already fenced admission. Rights detach only after drained, successful core deletion. */
public suspend fun finishFacetProfileRemoval(
    drain: suspend () -> Unit,
    remove: suspend () -> Unit,
    detachRights: suspend () -> Unit,
    reconcile: suspend () -> Unit
) {
    var failure: Throwable? = null
    try { drain(); remove(); detachRights() }
    catch (error: Throwable) { failure = error }
    withContext(NonCancellable) {
        try { reconcile() }
        catch (error: Throwable) { if (failure == null) failure = error else failure.addSuppressed(error) }
    }
    failure?.let { throw it }
}
