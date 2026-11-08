package red.sjer.facet.host

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test
import uniffi.TaskNotesCore.ObsidianAccountResponse
import uniffi.TaskNotesCore.ObsidianRemoteVault

class FacetAccountSignInTransitionTest {
    @Test fun mfaAndRejectedCodeKeepExistingOwnerTokenAndVaultKeys() = runBlocking {
        for (response in listOf(ObsidianAccountResponse.MfaRequired, ObsidianAccountResponse.MfaRejected)) {
            val fixture = Credentials()
            val before = fixture.values.toMap()
            val outcome = fixture.attempt(authenticate = { response })
            assertEquals(if (response == ObsidianAccountResponse.MfaRequired) AccountSignIn.NeedsCode else AccountSignIn.CodeRejected, outcome)
            assertEquals("old", fixture.active)
            assertEquals(before, fixture.values)
            assertTrue(fixture.writes.isEmpty())
            assertFalse(fixture.transition.pending)
        }
    }

    @Test fun failedAuthenticationAndVaultDiscoveryNeverCommitReplacementCredentials() = runBlocking {
        for (stage in listOf("authentication", "discovery")) {
            val fixture = Credentials()
            val before = fixture.values.toMap()
            val failure = IOException("Synthetic network rejection")
            try {
                fixture.attempt(
                    authenticate = { if (stage == "authentication") throw failure else signedIn("new") },
                    discover = { throw failure },
                )
                fail("Expected authentication/discovery failure")
            } catch (actual: IOException) { assertSame(failure, actual) }
            assertEquals("old", fixture.active)
            assertEquals(before, fixture.values)
            assertTrue(fixture.writes.isEmpty())
            assertFalse(fixture.transition.pending)
        }
    }

    @Test fun verifiedSameOwnerRefreshesTokenWithoutRemovingAnyVaultKey() = runBlocking {
        val fixture = Credentials()
        assertEquals(AccountSignIn.Vaults(emptyList()), fixture.attempt(authenticate = { signedIn("OLD") }))
        assertEquals("old", fixture.active)
        assertEquals("replacement", fixture.values["account.old.token"])
        assertEquals("old-vault-key", fixture.values["vault.old.key"])
        assertEquals("unrelated-vault-key", fixture.values["vault.unrelated.key"])
        assertEquals(listOf("token:old", "owner:old", "publish"), fixture.writes)
    }

    @Test fun differentVerifiedOwnerCommitsBeforeRetiringOnlyPreviousOwnerCredentials() = runBlocking {
        val fixture = Credentials()
        fixture.attempt(authenticate = { signedIn("NEW") })
        assertEquals("new", fixture.active)
        assertEquals("replacement", fixture.values["account.new.token"])
        assertNull(fixture.values["account.old.token"])
        assertNull(fixture.values["vault.old.key"])
        assertEquals("unrelated-vault-key", fixture.values["vault.unrelated.key"])
        assertEquals(listOf("token:new", "owner:new", "retire:old", "publish"), fixture.writes)
        assertFalse(fixture.transition.pending)
    }

    @Test fun failedOwnerCommitCannotRetireExistingVaultCredentials() = runBlocking {
        val fixture = Credentials()
        val failure = IOException("Synthetic metadata commit failure")
        try {
            fixture.attempt(authenticate = { signedIn("new") }, selectOwner = { throw failure })
            fail("Expected owner commit failure")
        } catch (actual: IOException) { assertSame(failure, actual) }
        assertEquals("old", fixture.active)
        assertEquals("old-token", fixture.values["account.old.token"])
        assertEquals("old-vault-key", fixture.values["vault.old.key"])
        assertFalse(fixture.writes.any { it.startsWith("retire:") || it == "publish" })
    }

    @Test fun suspendedDiscoveryBlocksSessionGrantsAndCancellationRetainsOldAccount() = runBlocking {
        val fixture = Credentials()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val attempt = async {
            fixture.attempt(authenticate = { signedIn("new") }, discover = {
                entered.complete(Unit)
                release.await()
                emptyList()
            })
        }
        entered.await()
        assertTrue(fixture.transition.pending)
        assertEquals("old", fixture.active)
        assertTrue(fixture.writes.isEmpty())
        attempt.cancel()
        release.complete(Unit)
        attempt.join()
        yield()
        assertFalse(fixture.transition.pending)
        assertEquals("old", fixture.active)
        assertEquals("old-token", fixture.values["account.old.token"])
        assertEquals("old-vault-key", fixture.values["vault.old.key"])
        assertTrue(fixture.writes.isEmpty())
    }

    private fun signedIn(email: String) = ObsidianAccountResponse.SignedIn("replacement", "Synthetic", email)

    private class Credentials {
        val transition = FacetAccountSignInTransition()
        var active = "old"
        val values = mutableMapOf("account.old.token" to "old-token", "vault.old.key" to "old-vault-key", "vault.unrelated.key" to "unrelated-vault-key")
        val writes = mutableListOf<String>()

        suspend fun attempt(
            authenticate: suspend () -> ObsidianAccountResponse,
            discover: suspend (String) -> List<ObsidianRemoteVault> = { emptyList() },
            selectOwner: ((String) -> Unit)? = null,
        ): AccountSignIn = transition.run(
            prepare = { assertTrue(transition.pending) },
            authenticate = authenticate,
            discover = discover,
            activeOwner = { active },
            identity = { it.lowercase() },
            storeToken = { owner, token -> assertTrue(transition.pending); writes += "token:$owner"; values["account.$owner.token"] = token },
            selectOwner = selectOwner ?: { owner -> assertTrue(transition.pending); writes += "owner:$owner"; active = owner },
            retireOwner = { owner ->
                assertTrue(transition.pending)
                assertNotEquals(owner, active)
                writes += "retire:$owner"
                values.remove("account.$owner.token")
                values.remove("vault.$owner.key")
            },
            publish = { assertTrue(transition.pending); writes += "publish" },
        )
    }
}
