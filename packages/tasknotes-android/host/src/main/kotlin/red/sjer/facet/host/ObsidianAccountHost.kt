package red.sjer.facet.host

import android.content.Context
import java.util.UUID
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import uniffi.TaskNotesCore.FfiObsidianAccount
import uniffi.TaskNotesCore.ObsidianAccountResponse
import uniffi.TaskNotesCore.ObsidianHttpRequest
import uniffi.TaskNotesCore.ObsidianRemoteVault

data class RemoteVaultChoice(val id: String, val name: String, val managed: Boolean, val shared: Boolean)
sealed interface AccountSignIn { data object NeedsCode : AccountSignIn; data object CodeRejected : AccountSignIn; data class Vaults(val choices: List<RemoteVaultChoice>) : AccountSignIn }

/** HTTP runs away from UI and outside the Rust request lock. No payload logging. */
class ObsidianAccountHost(context: Context, private val engine: FacetEngineRunner) {
    private val applicationContext = context.applicationContext
    private val account = FfiObsidianAccount()
    private val secrets = VaultSecrets(context.applicationContext)
    private val preferences = context.getSharedPreferences("facet.remote-vaults", Context.MODE_PRIVATE)
    private val client = OkHttpClient.Builder().followRedirects(false).build()
    private val mutex = Mutex()
    private var choices: List<ObsidianRemoteVault> = emptyList()
    @Volatile internal var generation = 0L; private set

    fun close() {
        account.close()
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }

    suspend fun signIn(email: String, password: String, code: String): AccountSignIn = withContext(Dispatchers.IO) { mutex.withLock {
        FacetReminders.cancelProfiles(applicationContext, ownedProfileIds())
        FacetBackgroundSync.disableAuthorization(applicationContext)
        FacetBackgroundSync.awaitBackgroundDrain()
        choices = emptyList()
        generation++
        clearActiveAccount()
        when (val response = perform(account.signIn(email, password, code))) {
            is ObsidianAccountResponse.MfaRequired -> AccountSignIn.NeedsCode
            is ObsidianAccountResponse.MfaRejected -> AccountSignIn.CodeRejected
            is ObsidianAccountResponse.SignedIn -> {
                val owner = owner(response.email)
                secrets.put("account.$owner.token", response.token.toByteArray(Charsets.UTF_8))
                check(preferences.edit().putString("activeOwner", owner).commit())
                discover(response.token)
            }
            else -> error("Unexpected account sign-in response.")
        }
    } }

    suspend fun restoreChoices(): AccountSignIn? = withContext(Dispatchers.IO) { mutex.withLock {
        val owner = preferences.getString("activeOwner", null) ?: return@withLock null
        val token = secrets.get("account.$owner.token") ?: return@withLock null
        try { discover(token.toString(Charsets.UTF_8)) } finally { token.fill(0) }
    } }

    suspend fun connect(vaultId: String, password: String?): VaultProfile = withContext(Dispatchers.IO) { mutex.withLock {
        val owner = requireNotNull(preferences.getString("activeOwner", null)) { "Sign in to Obsidian again." }
        val tokenBytes = requireNotNull(secrets.get("account.$owner.token")) { "Sign in to Obsidian again." }
        val prepared = account.prepareVault(vaultId, password)
        try {
            check(perform(account.vaultAccess(tokenBytes.toString(Charsets.UTF_8), vaultId, prepared.keyBytes)) is ObsidianAccountResponse.AccessGranted)
            val profileId = UUID.randomUUID().toString()
            secrets.put("vault.$profileId.key", prepared.keyBytes)
            val vault = prepared.vault
            val metadata = buildJsonObject {
                put("id", vault.id); put("host", vault.host); put("salt", vault.salt); put("encryptionVersion", vault.encryptionVersion.toInt()); put("owner", owner)
            }
            check(preferences.edit().putString(profileId, metadata.toString()).commit())
            val registered = try { engine.registerReplica(profileId, vault.name) }
            catch (failure: Exception) { secrets.remove("vault.$profileId.key"); check(preferences.edit().remove(profileId).commit()); throw failure }
            FacetBackgroundSync.authorize(applicationContext)
            registered
        } finally { tokenBytes.fill(0); prepared.keyBytes.fill(0) }
    } }

    /** Replaces account-owned access after authorization without replacing vault state or pending edits. */
    suspend fun reauthorize(profileId: String, vaultId: String, password: String?): VaultProfile = withContext(Dispatchers.IO) { mutex.withLock {
        val previous = sessionMetadata(profileId)
        require(previous.getValue("id").jsonPrimitive.content == vaultId) { "Choose this profile's original remote vault." }
        val profile = requireNotNull(engine.profiles().firstOrNull { it.id == profileId && it.kind == "obsidian_sync" })
        require(choices.any { it.id == vaultId }) { "Refresh the signed-in account's vault list first." }
        val owner = requireNotNull(preferences.getString("activeOwner", null)) { "Sign in to Obsidian again." }
        val token = requireNotNull(secrets.get("account.$owner.token")) { "Sign in to Obsidian again." }
        val prepared = account.prepareVault(vaultId, password)
        try {
            check(perform(account.vaultAccess(token.toString(Charsets.UTF_8), vaultId, prepared.keyBytes)) is ObsidianAccountResponse.AccessGranted)
            generation++
            val metadata = buildJsonObject {
                put("id", prepared.vault.id); put("host", prepared.vault.host); put("salt", prepared.vault.salt)
                put("encryptionVersion", prepared.vault.encryptionVersion.toInt()); put("owner", owner)
            }
            secrets.put("vault.$profileId.key", prepared.keyBytes)
            check(preferences.edit().putString(profileId, metadata.toString()).commit())
            FacetBackgroundSync.authorize(applicationContext)
            profile
        } finally { token.fill(0); prepared.keyBytes.fill(0) }
    } }

    internal fun sessionMetadata(profileId: String): JsonObject = Json.parseToJsonElement(preferences.getString(profileId, null) ?: throw FacetActionError("Reconnect this vault to Obsidian Sync to resume synchronization.")).jsonObject
    internal fun belongsToActiveAccount(profileId: String): Boolean {
        val owner = preferences.getString("activeOwner", null) ?: return false
        val raw = preferences.getString(profileId, null) ?: return false
        return Json.parseToJsonElement(raw).jsonObject.getValue("owner").jsonPrimitive.content == owner
    }

    /** Non-secret ownership projection; grants no credential or file capability. */
    suspend fun authorizedProfileIds(): Set<String> = withContext(Dispatchers.IO) { mutex.withLock { ownedProfileIds() } }

    /** Only called after successful core removal; preserves the shared account token and other vault keys. */
    suspend fun forgetRemovedProfile(profileId: String) = withContext(Dispatchers.IO) { mutex.withLock {
        require(engine.profiles().none { it.id == profileId }) { "An existing profile cannot lose its rights through removal cleanup." }
        generation++
        FacetReminders.cancelProfiles(applicationContext, setOf(profileId))
        secrets.remove("vault.$profileId.key")
        check(preferences.edit().remove(profileId).commit())
    } }

    /** Reconcile a crash after core deletion but before profile-only credential cleanup. */
    suspend fun reconcileRemovedProfiles(existingIds: Set<String>) {
        val orphaned = withContext(Dispatchers.IO) { mutex.withLock { preferences.all.keys.filter { it != "activeOwner" && it !in existingIds } } }
        for (profileId in orphaned) forgetRemovedProfile(profileId)
    }

    /** Check secure capabilities without returning them to presentation. */
    suspend fun eligibleReminderProfileIds(): Set<String> = withContext(Dispatchers.IO) { mutex.withLock {
        val owner = preferences.getString("activeOwner", null) ?: return@withLock emptySet()
        val token = secrets.get("account.$owner.token") ?: return@withLock emptySet()
        try {
            ownedProfileIds().filter { profileId ->
                val key = secrets.get("vault.$profileId.key") ?: return@filter false
                try { check(key.size == 32) { "The stored vault key does not match the secure-storage contract." }; true } finally { key.fill(0) }
            }.toSet()
        } finally { token.fill(0) }
    } }
    internal fun sessionSecrets(profileId: String): Pair<ByteArray, ByteArray> {
        val owner = sessionMetadata(profileId).getValue("owner").jsonPrimitive.content
        return requireNotNull(secrets.get("account.$owner.token")) to requireNotNull(secrets.get("vault.$profileId.key"))
    }

    suspend fun signOut() = withContext(Dispatchers.IO) { mutex.withLock {
        FacetReminders.cancelProfiles(applicationContext, ownedProfileIds())
        FacetBackgroundSync.disableAuthorization(applicationContext)
        FacetBackgroundSync.awaitBackgroundDrain()
        choices = emptyList(); generation++
        val owner = preferences.getString("activeOwner", null)
        val token = owner?.let { secrets.get("account.$it.token") }
        clearActiveAccount()
        if (token != null) try { perform(account.signOut(token.toString(Charsets.UTF_8))) } finally { token.fill(0) }
    } }

    private fun clearActiveAccount() {
        val owner = preferences.getString("activeOwner", null) ?: return
        secrets.remove("account.$owner.token")
        preferences.all.filterKeys { it != "activeOwner" }.forEach { (profileId, raw) ->
            require(raw is String)
            val metadata = Json.parseToJsonElement(raw).jsonObject
            if (metadata.getValue("owner").jsonPrimitive.content == owner) secrets.remove("vault.$profileId.key")
        }
        check(preferences.edit().remove("activeOwner").commit())
    }

    private fun ownedProfileIds(): Set<String> {
        val owner = preferences.getString("activeOwner", null) ?: return emptySet()
        return preferences.all.filter { (profileId, raw) ->
            profileId != "activeOwner" && raw is String &&
                Json.parseToJsonElement(raw).jsonObject.getValue("owner").jsonPrimitive.content == owner
        }.keys
    }

    private fun owner(email: String): String = MessageDigest.getInstance("SHA-256").digest(email.lowercase().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private suspend fun discover(token: String): AccountSignIn {
        val response = perform(account.listVaults(token))
        check(response is ObsidianAccountResponse.Vaults)
        choices = response.vaults
        return AccountSignIn.Vaults(choices.map { RemoteVaultChoice(it.id, it.name, it.managed, it.shared) })
    }

    private suspend fun perform(request: ObsidianHttpRequest): ObsidianAccountResponse {
        try {
            if (request.preflight) {
                val preflight = Request.Builder().url(request.url).method("OPTIONS", null)
                request.headers.filter { it.name.equals("Origin", ignoreCase = true) }.forEach { preflight.header(it.name, it.value) }
                val response = send(preflight.build())
                check(response.first in 200..299) { "Obsidian sign-in preflight failed." }
            }
            val post = Request.Builder().url(request.url).post(request.body.toRequestBody("application/json".toMediaType()))
            request.headers.forEach { post.header(it.name, it.value) }
            val response = send(post.build())
            return account.response(request.requestId, response.first.toUShort(), response.second)
        } catch (failure: Exception) {
            // A decoded response consumes its request ID; cancellation is best
            // effort only for the already-released correlation record.
            runCatching { account.cancelRequest(request.requestId) }
            throw failure
        }
    }

    private suspend fun send(request: Request): Pair<Int, String> = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { continuation.resumeWithException(FacetNetworkException(e)) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    val result = response.use {
                        val body = requireNotNull(it.body)
                        val maximum = 4 * 1024 * 1024
                        require(body.contentLength() <= maximum) { "Obsidian account response exceeds the supported size." }
                        val bytes = ByteArrayOutputStream()
                        body.byteStream().use { input ->
                            val buffer = ByteArray(8192)
                            while (true) {
                                val count = input.read(buffer)
                                if (count == -1) break
                                require(bytes.size() + count <= maximum) { "Obsidian account response exceeds the supported size." }
                                bytes.write(buffer, 0, count)
                            }
                        }
                        it.code to bytes.toByteArray().decodeToString(throwOnInvalidSequence = true)
                    }
                    continuation.resume(result)
                } catch (failure: IOException) { continuation.resumeWithException(FacetNetworkException(failure)) }
                catch (failure: Exception) { continuation.resumeWithException(failure) }
            }
        })
    }
}
