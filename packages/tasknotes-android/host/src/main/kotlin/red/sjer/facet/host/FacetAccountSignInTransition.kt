package red.sjer.facet.host

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import uniffi.TaskNotesCore.ObsidianAccountResponse
import uniffi.TaskNotesCore.ObsidianRemoteVault

/** Authentication and discovery prove the replacement before any retained credentials change. */
internal class FacetAccountSignInTransition {
    @Volatile var pending = false; private set

    suspend fun run(
        prepare: suspend () -> Unit,
        authenticate: suspend () -> ObsidianAccountResponse,
        discover: suspend (String) -> List<ObsidianRemoteVault>,
        activeOwner: () -> String?,
        identity: (String) -> String,
        storeToken: (String, String) -> Unit,
        selectOwner: (String) -> Unit,
        retireOwner: suspend (String) -> Unit,
        publish: (List<ObsidianRemoteVault>) -> Unit,
    ): AccountSignIn {
        check(!pending) { "Another account transition is still in progress." }
        pending = true
        try {
            currentCoroutineContext().ensureActive()
            prepare()
            currentCoroutineContext().ensureActive()
            return when (val response = authenticate()) {
                ObsidianAccountResponse.MfaRequired -> AccountSignIn.NeedsCode
                ObsidianAccountResponse.MfaRejected -> AccountSignIn.CodeRejected
                is ObsidianAccountResponse.SignedIn -> {
                    val vaults = discover(response.token)
                    currentCoroutineContext().ensureActive()
                    val previous = activeOwner()
                    val verified = identity(response.email)
                    storeToken(verified, response.token)
                    selectOwner(verified)
                    if (previous != null && previous != verified) retireOwner(previous)
                    publish(vaults)
                    AccountSignIn.Vaults(vaults.map { RemoteVaultChoice(it.id, it.name, it.managed, it.shared) })
                }
                else -> error("Unexpected account sign-in response.")
            }
        } finally { pending = false }
    }
}
