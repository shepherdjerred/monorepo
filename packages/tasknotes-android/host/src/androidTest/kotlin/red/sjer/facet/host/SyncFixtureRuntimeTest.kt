package red.sjer.facet.host

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.*
import org.junit.Test

/** Real account HTTP, Keystore, encrypted WebSockets and two Rust-backed replicas. */
class SyncFixtureRuntimeTest {
    @Test fun encryptedPeersRetryAndDurableOutboxReopenWithoutAnAccount(): Unit = runBlocking {
        withTimeout(240_000) {
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val context = instrumentation.targetContext
            val encoded = requireNotNull(InstrumentationRegistry.getArguments().getString("fixtureConfig")) {
                "Run scripts/verify-sync-runtime.ts; the account-free fixture arguments are required."
            }
            val config = Json.parseToJsonElement(Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP).decodeToString()).jsonObject
            fun setting(name: String) = config.getValue(name).jsonPrimitive.content
            val runID = UUID.fromString(setting("runID")).toString()
            val origin = setting("httpOrigin")
            require(setting("email") == "synthetic@example.test")
            val transport = ObsidianTransport.installFixture(origin)
            val control = OkHttpClient.Builder().callTimeout(5, java.util.concurrent.TimeUnit.SECONDS).build()
            var engine: FacetEngineRunner? = null
            var account: ObsidianAccountHost? = null
            var firstSession: ObsidianReplicaSession? = null
            var secondSession: ObsidianReplicaSession? = null
            suspend fun http(path: String, body: JsonObject? = null): JsonObject = withContext(Dispatchers.IO) {
                val request = Request.Builder().url(origin + path)
                if (body != null) request.post(body.toString().toRequestBody("application/json".toMediaType()))
                control.newCall(request.build()).execute().use { response ->
                    assertEquals(200, response.code)
                    Json.parseToJsonElement(requireNotNull(response.body).string()).jsonObject
                }
            }
            suspend fun inventory() = http("/__fixture/state?runID=$runID")
            suspend fun fault(action: String) {
                assertTrue(http("/__fixture/control", buildJsonObject { put("runID", runID); put("action", action) }).getValue("ok").jsonPrimitive.boolean)
            }
            suspend fun eventually(label: String, condition: suspend () -> Boolean) {
                try { withTimeout(30_000) { while (!condition()) delay(100) } }
                catch (failure: kotlinx.coroutines.TimeoutCancellationException) { throw AssertionError("Android Sync did not settle: $label", failure) }
            }
            suspend fun stopSessions() {
                firstSession?.stop(); firstSession = null
                secondSession?.stop(); secondSession = null
            }
            try {
                // The fixture capability must never turn into a general production-host proxy.
                val scopedClient = ObsidianTransport.client()
                try {
                    withContext(Dispatchers.IO) {
                        try {
                            scopedClient.newCall(Request.Builder().url("https://unknown.obsidian.md/").build()).execute().close()
                            fail("The synthetic transport accepted an unknown production host")
                        } catch (_: IllegalStateException) { }
                    }
                } finally { scopedClient.connectionPool.evictAll(); scopedClient.dispatcher.executorService.shutdown() }
                engine = FacetEngineRunner.open(context)
                account = ObsidianAccountHost(context, requireNotNull(engine))
                assertEquals(AccountSignIn.NeedsCode, requireNotNull(account).signIn(setting("email"), setting("password"), ""))
                assertEquals(AccountSignIn.CodeRejected, requireNotNull(account).signIn(setting("email"), setting("password"), "000000"))
                val signedIn = requireNotNull(account).signIn(setting("email"), setting("password"), setting("verificationCode"))
                assertTrue(signedIn is AccountSignIn.Vaults)
                assertEquals(setting("vaultID"), (signedIn as AccountSignIn.Vaults).choices.single().id)
                val first = requireNotNull(engine).approveStandard(requireNotNull(account).connect(setting("vaultID"), setting("vaultPassword")))
                val second = requireNotNull(engine).approveStandard(requireNotNull(account).connect(setting("vaultID"), setting("vaultPassword")))
                requireNotNull(engine).refresh(first.id); requireNotNull(engine).refresh(second.id)
                suspend fun connect() {
                    firstSession = ObsidianReplicaSession.open(requireNotNull(engine), requireNotNull(account), first.id, {}, {})
                    secondSession = ObsidianReplicaSession.open(requireNotNull(engine), requireNotNull(account), second.id, {}, {})
                    eventually("both encrypted sessions Ready") { requireNotNull(firstSession).isIdle() && requireNotNull(secondSession).isIdle() }
                }
                suspend fun task(profile: VaultProfile) = requireNotNull(engine).snapshot(profile.id, FacetEngineRunner.query()).tasks.singleOrNull()
                suspend fun settled(body: String) {
                    eventually("both replicas have $body and acknowledged outboxes") {
                        task(first)?.body == body && task(second)?.body == body &&
                            requireNotNull(engine).uploads(first.id).isEmpty() && requireNotNull(engine).uploads(second.id).isEmpty() &&
                            requireNotNull(firstSession).isIdle() && requireNotNull(secondSession).isIdle()
                    }
                }
                suspend fun update(profile: VaultProfile, body: String) {
                    val basis = requireNotNull(task(profile))
                    val id = UUID.randomUUID().toString()
                    requireNotNull(engine).execute(profile.id, buildJsonObject {
                        put("kind", "update"); put("path", basis.path); put("expectedRevision", basis.revision); put("body", body)
                        put("properties", buildJsonObject {})
                    }, id)
                    requireNotNull(engine).discardObservedMutation(id)
                }
                connect()
                val created = UUID.randomUUID().toString()
                requireNotNull(engine).execute(first.id, buildJsonObject {
                    put("kind", "create"); put("path", "Tasks/Android synthetic Sync.md"); put("body", "Created through encrypted Android transport.\n")
                    put("properties", buildJsonObject {
                        put("title", "Android synthetic Sync"); put("tags", JsonArray(listOf(JsonPrimitive("task"))))
                        put("externalNumber", Json.parseToJsonElement("9007199254740993"))
                    })
                }, created)
                requireNotNull(engine).discardObservedMutation(created)
                settled("Created through encrypted Android transport.\n")
                assertEquals(Json.parseToJsonElement("9007199254740993"), requireNotNull(task(second)).properties.getValue("externalNumber"))
                update(second, "Edited on the second Android replica.\n")
                settled("Edited on the second Android replica.\n")

                stopSessions()
                update(first, "Offline edit survives an Android engine restart.\n")
                val retained = requireNotNull(engine).uploads(first.id)
                assertEquals(1, retained.size)
                requireNotNull(account).close(); account = null
                requireNotNull(engine).close(); engine = null
                engine = FacetEngineRunner.open(context)
                assertEquals(retained, requireNotNull(engine).uploads(first.id))
                account = ObsidianAccountHost(context, requireNotNull(engine))
                assertTrue(requireNotNull(account).restoreChoices() is AccountSignIn.Vaults)
                connect()
                settled("Offline edit survives an Android engine restart.\n")

                for ((action, body, counter) in listOf(
                    Triple("fail-next-push-before-commit", "Retried before server commit.\n", "beforeCommitDisconnects"),
                    Triple("fail-next-push-after-commit", "Recovered after server commit without an acknowledgement.\n", "afterCommitDisconnects"),
                )) {
                    val before = inventory()
                    fault(action)
                    update(first, body)
                    settled(body)
                    val after = inventory()
                    assertEquals(before.getValue("latestUID").jsonPrimitive.long + 1, after.getValue("latestUID").jsonPrimitive.long)
                    assertEquals(1, after.getValue("counters").jsonObject.getValue(counter).jsonPrimitive.int)
                    if (counter == "beforeCommitDisconnects") assertTrue(after.getValue("counters").jsonObject.getValue("pushAttempts").jsonPrimitive.long >= before.getValue("counters").jsonObject.getValue("pushAttempts").jsonPrimitive.long + 2)
                }
                val final = inventory()
                assertEquals(0, final.getValue("counters").jsonObject.getValue("protocolErrors").jsonPrimitive.int)
                assertTrue(final.getValue("files").jsonArray.isNotEmpty())
                final.getValue("files").jsonArray.forEach { file ->
                    assertTrue(file.jsonObject.getValue("path").jsonPrimitive.content.matches(Regex("(?:[a-f0-9]{2})+")))
                    assertTrue(file.jsonObject.getValue("size").jsonPrimitive.int > 28)
                }
                assertEquals(Json.parseToJsonElement("9007199254740993"), requireNotNull(task(second)).properties.getValue("externalNumber"))
                stopSessions()
                requireNotNull(account).signOut()
                assertTrue(requireNotNull(account).authorizedProfileIds().isEmpty())
                val directory = requireNotNull(context.getExternalFilesDir("acceptance"))
                check(directory.isDirectory || directory.mkdirs())
                File(directory, "sync-$runID.json").writeText(buildJsonObject {
                    put("schemaVersion", 1); put("runID", runID); put("scope", "account-free-android-protocol-fixture")
                    put("retainedUploadCountAcrossReopen", retained.size); put("inventory", final)
                }.toString())
            } finally {
                stopSessions()
                account?.close()
                engine?.close()
                control.connectionPool.evictAll(); control.dispatcher.executorService.shutdown()
                transport.close()
            }
        }
    }
}
