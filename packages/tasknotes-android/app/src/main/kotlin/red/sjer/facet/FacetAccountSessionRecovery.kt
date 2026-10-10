package red.sjer.facet

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive

/** A settled authentication attempt must not leave the retained foreground account disconnected. */
internal suspend fun <T> withAccountSessionRecovery(
    attempt: suspend () -> T,
    shouldResume: () -> Boolean,
    resume: suspend () -> Unit,
): T {
    var attemptFailure: Throwable? = null
    try { return attempt() }
    catch (failure: Throwable) { attemptFailure = failure; throw failure }
    finally {
        if (currentCoroutineContext().isActive && shouldResume()) {
            try { resume() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                val original = attemptFailure
                if (original == null) throw failure else original.addSuppressed(failure)
            }
        }
    }
}
