package red.sjer.facet.host

import android.system.ErrnoException
import android.system.OsConstants
import java.io.IOException
import uniffi.TaskNotesCore.FacetHostException

/** Expected provider boundaries only. Corrupt private metadata/internal contracts retain their original failure. */
internal fun facetHostFailure(failure: Exception): FacetHostException? {
    val mapped = when (failure) {
        is FacetHostException -> return failure
        is LegacyRecoveryProofException -> FacetHostException.Unavailable(failure.message!!)
        is SecurityException -> FacetHostException.PermissionDenied("Restore access to the private vault files.")
        is ErrnoException -> when (failure.errno) {
            OsConstants.EACCES, OsConstants.EPERM -> FacetHostException.PermissionDenied("Restore access to the private vault files.")
            OsConstants.EOPNOTSUPP, OsConstants.ENOSYS -> FacetHostException.Unavailable("The vault filesystem does not support the required atomic file operation.")
            OsConstants.ENOENT, OsConstants.EEXIST, OsConstants.EAGAIN, OsConstants.ENOSPC, OsConstants.EDQUOT,
            OsConstants.EROFS, OsConstants.ENOTDIR, OsConstants.EIO, OsConstants.EBUSY, OsConstants.EMFILE, OsConstants.ENFILE ->
                FacetHostException.Io("The private vault could not complete its durable file operation.")
            else -> return null
        }
        is IOException -> FacetHostException.Io("The private vault could not complete its durable file operation.")
        else -> return null
    }
    mapped.initCause(failure)
    return mapped
}
