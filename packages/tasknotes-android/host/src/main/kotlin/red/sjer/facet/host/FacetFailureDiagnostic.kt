package red.sjer.facet.host

import java.io.IOException
import java.util.Collections
import java.util.IdentityHashMap
import kotlinx.coroutines.CancellationException
import uniffi.TaskNotesCore.FacetEngineException
import uniffi.TaskNotesCore.FacetHostException
import uniffi.TaskNotesCore.ObsidianBoundaryException

/** Only this explicit transport boundary qualifies an I/O failure for retry. */
internal class FacetNetworkException(cause: IOException) : IOException("The Sync connection failed.", cause)

/** Diagnostics contain closed classifications, never exception messages, paths or response bytes. */
internal data class FacetFailureDiagnostic(val classification: String, val chain: String) {
    companion object {
        fun from(failure: Throwable): FacetFailureDiagnostic {
            val visited = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())
            val pending = ArrayDeque<Pair<String, Throwable>>()
            val entries = mutableListOf<String>()
            pending.add("first" to failure)
            while (pending.isNotEmpty() && entries.size < 16) {
                val (relationship, error) = pending.removeFirst()
                if (!visited.add(error)) continue
                entries.add("$relationship:${classify(error)}")
                error.cause?.let { pending.add("cause" to it) }
                error.suppressed.take(16).forEach { pending.add("suppressed" to it) }
            }
            if (pending.isNotEmpty()) entries.add("truncated")
            return FacetFailureDiagnostic(classify(failure), entries.joinToString(","))
        }

        private fun classify(failure: Throwable): String = when (failure) {
            is FacetNetworkException -> "network"
            is CancellationException -> "cancelled"
            is FacetEngineException.Storage, is FacetHostException.Io -> "storage"
            is IOException -> "io"
            is FacetEngineException.Host, is FacetHostException.Unavailable, is FacetHostException.PermissionDenied -> "provider"
            is FacetEngineException.Configuration -> "configuration"
            is FacetEngineException.Validation -> "validation"
            is FacetEngineException.HostContract, is FacetHostException.Contract -> "internal_contract"
            is FacetEngineException.Busy, is ObsidianBoundaryException.Busy -> "busy"
            is FacetEngineException.Conflict -> "conflict"
            is FacetEngineException.NotFound -> "missing_profile_or_note"
            is FacetEngineException.Closed -> "closed_engine"
            is ObsidianBoundaryException -> "sync_boundary"
            is FacetActionError -> "retained_action"
            is IllegalArgumentException, is IllegalStateException -> "internal_contract"
            else -> "unexpected"
        }
    }
}
