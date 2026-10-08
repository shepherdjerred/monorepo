package red.sjer.facet.host

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import uniffi.TaskNotesCore.FacetEngineException
import uniffi.TaskNotesCore.ObsidianBoundaryException

/** Exact caller-owned input is retained; every non-Busy failure escapes without replay. */
internal suspend fun <T> replayFacetBusy(
    isCurrent: () -> Boolean,
    wait: suspend () -> Unit = { delay(25) },
    operation: suspend () -> T,
): T {
    while (true) {
        currentCoroutineContext().ensureActive()
        if (!isCurrent()) throw CancellationException("The owning Sync session stopped.")
        try { return operation() }
        catch (_: ObsidianBoundaryException.Busy) { wait() }
        catch (_: FacetEngineException.Busy) { wait() }
    }
}
