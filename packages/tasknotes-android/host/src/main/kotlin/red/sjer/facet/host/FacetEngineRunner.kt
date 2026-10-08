package red.sjer.facet.host

import android.content.Context
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import uniffi.TaskNotesCore.FacetHostException
import uniffi.TaskNotesCore.FfiFacetEngine
import uniffi.TaskNotesCore.FacetEngineException
import uniffi.TaskNotesCore.ObsidianBoundaryException
import uniffi.TaskNotesCore.FfiFacetPayload
import uniffi.TaskNotesCore.FfiObsidianSession

class FacetEngineRunner private constructor(context: Context) {
    private val applicationContext = context.applicationContext
    private val files = PrivateVaultFiles(context)
    private val callbacks = FacetBoundedCallbacks(files)
    private val state = File(context.noBackupFilesDir, "engine").apply { check(isDirectory || mkdirs()) }
    private val core = FfiFacetEngine(File(state, "facet.sqlite3").absolutePath, callbacks)
    private val mutex = Mutex()
    private var closed = false
    private val schema = FacetSchema(context.assets.open("facet-engine.schema.json").bufferedReader().use { it.readText() })
    private val drafts = FacetMutationDrafts(File(state, "action-drafts"))
    private val transportLimits = uniffi.TaskNotesCore.obsidianTransportLimits()
    init { callbacks.bindRuntimeIdentity(core.identity()); drafts.reconcileObservedPayloads() }


    suspend fun profiles(): List<VaultProfile> = call {
        val envelope = Json.parseToJsonElement(core.profilesJson()).jsonObject
        schema.validate("profiles", envelope)
        FacetContract.validateVersion(envelope)
        envelope.getValue("profiles").jsonArray.map { FacetContract.profile(it.jsonObject) }
    }

    /** Sessions must be stopped/unbound before this call; rejected removal retains all capabilities and drafts. */
    suspend fun removeProfile(profileId: String) = call {
        if (drafts.pending(profileId, null, 1).isNotEmpty()) throw FacetActionError("Resume or retire this vault's saved actions before removing it.")
        core.removeProfile(profileId)
        callbacks.detachProfile(profileId)
        // App-private/imported files are intentionally retained, never inferred disposable.
    }

    suspend fun registerReplica(id: String, name: String, approveStandard: Boolean = false): VaultProfile = call {
        files.createReplica(id)
        val profile = buildJsonObject { put("schemaVersion", 1); put("id", id); put("name", name); put("kind", "obsidian_sync"); put("approveStandard", approveStandard) }
        val registered = Json.parseToJsonElement(core.registerProfile(profile.toString())).jsonObject
        FacetContract.validateVersion(registered)
        FacetContract.profile(registered)
    }

    suspend fun importSnapshot(treeUri: android.net.Uri, name: String, approveStandard: Boolean = false): ImportSnapshotResult {
        require(name.isNotBlank())
        val copy = withContext(Dispatchers.IO) { FacetFolderImport(applicationContext).copy(treeUri) }
        return call {
            files.adoptImported(copy.id, copy.directory)
            val input = buildJsonObject {
                put("schemaVersion", 1); put("id", copy.id); put("name", "$name (imported copy)")
                put("kind", "local_folder"); put("approveStandard", approveStandard)
            }
            schema.validate("profile", input)
            val result = Json.parseToJsonElement(core.registerProfile(input.toString())).jsonObject
            schema.validate("profile", result)
            ImportSnapshotResult(FacetContract.profile(result), copy.files, copy.bytes)
        }
    }

    suspend fun refresh(id: String): VaultSnapshot = call { decodeSnapshot(core.refresh(id)) }
    suspend fun snapshot(id: String, query: JsonObject): VaultSnapshot = call { schema.validate("query", query); decodeSnapshot(core.snapshotJson(id, query.toString())) }
    suspend fun cachedSnapshot(id: String, query: JsonObject): VaultSnapshot? = try { snapshot(id, query) }
    catch (_: uniffi.TaskNotesCore.FacetEngineException.Configuration) { null }

    suspend fun execute(id: String, command: JsonObject, mutationId: String = UUID.randomUUID().toString()) = call {
        val request = drafts.envelope(id, mutationId, command, Instant.now().toString())
        applyMutation(id, request)
    }

    suspend fun pendingMutations(profileId: String? = null, afterId: String? = null, limit: Int = 128): List<PendingFacetMutation> = call {
        drafts.pending(profileId, afterId, limit).onEach { schema.validate("mutation", it.mutation) }
    }

    /** Replays the complete persisted envelope in its owning profile; never constructs a new timestamp. */
    suspend fun retryMutation(mutationId: String): JsonObject = call {
        val draft = requireNotNull(drafts.read(mutationId)) { "The saved action is unavailable." }
        applyMutation(draft.profileId, draft.mutation)
    }

    suspend fun executePayload(profileId: String, command: JsonObject, mutationId: String, payload: ByteArray?): JsonObject = call {
        drafts.preparePayload(mutationId, payload)
        val request = drafts.envelope(profileId, mutationId, command, Instant.now().toString())
        applyMutation(profileId, request)
    }

    private fun applyMutation(id: String, request: JsonObject): JsonObject {
        schema.validate("mutation", request)
        val command = request.getValue("command").jsonObject
        val usesPayload = command["kind"]?.jsonPrimitive?.content == "resolve_conflict" && command["resolution"]?.jsonObject?.get("kind")?.jsonPrimitive?.content == "replace_payload"
        val response = if (usesPayload) {
            val mutationId = request.getValue("mutationId").jsonPrimitive.content
            drafts.openPayload(mutationId, transportLimits.defaultFileBytes).use { source ->
                if (source == null) core.executePayloadIdJson(id, request.toString(), null)
                else withPayload(core.beginPayload(id, "draft:$mutationId", source.size, source.revision)) { payload ->
                    var info = payloadInfo(payload.infoJson())
                    require(info.getValue("id") == JsonPrimitive("draft:$mutationId") && info.getValue("size").jsonPrimitive.content.toULong() == source.size && info.getValue("revision") == JsonPrimitive(source.revision))
                    var written = info.getValue("written").jsonPrimitive.content.toULong()
                    when (info.getValue("state").jsonPrimitive.content) {
                        "preparing" -> {
                            while (written < source.size) {
                                val count = minOf(1_048_576uL, source.size - written).toInt()
                                info = payloadInfo(payload.writeChunk(written, source.read(written, count)))
                                require(info.getValue("written").jsonPrimitive.content.toULong() == written + count.toULong())
                                written += count.toULong()
                            }
                            info = payloadInfo(payload.seal())
                        }
                        "sealed" -> Unit
                        "discarded" -> throw FacetActionError("This replacement was explicitly retired. Start a new reviewed action.")
                        else -> error("Unknown shared payload state.")
                    }
                    require(info.getValue("state") == JsonPrimitive("sealed") && info.getValue("written").jsonPrimitive.content.toULong() == source.size)
                    core.executePayloadIdJson(id, request.toString(), payload)
                }
            }
        } else core.execute(id, request.toString())
        val receipt = FacetReceiptWarnings.parse(schema, response, request.getValue("mutationId").jsonPrimitive.content)
        if (!receipt.getValue("applied").jsonPrimitive.boolean) throw FacetActionError("The note changed while you were editing. Your draft is still open; review the conflict inbox before retrying.")
        FacetContract.validateVersion(receipt)
        return receipt
    }

    suspend fun discardObservedMutation(mutationId: String) = call {
        val draft = requireNotNull(drafts.read(mutationId))
        val request = buildJsonObject { put("kind", "mutation_receipt"); put("mutationId", mutationId) }
        schema.validate("featureRequest", request)
        val result = Json.parseToJsonElement(core.featuresJson(draft.profileId, request.toString())).jsonObject
        schema.validate("mutationReceipt", result)
        require(result.getValue("mutationId").jsonPrimitive.content == mutationId)
        if (result.getValue("state").jsonPrimitive.content != "applied" || result["receipt"]?.jsonObject?.get("applied")?.jsonPrimitive?.boolean != true) {
            throw FacetActionError("This saved action is still unresolved. Resume it before clearing its private draft.")
        }
        drafts.recordObserved(mutationId, draft.profileId)
        drafts.discard(mutationId)
    }

    /** Explicit draft revision is allowed only after the runtime proves no applied/pending action remains. */
    suspend fun retireRejectedMutation(mutationId: String) = call {
        val draft = requireNotNull(drafts.read(mutationId))
        val request = buildJsonObject { put("schemaVersion", 1); put("kind", "mutation_receipt"); put("mutationId", mutationId) }
        schema.validate("featureRequest", request)
        val result = Json.parseToJsonElement(core.featuresJson(draft.profileId, request.toString())).jsonObject
        schema.validate("mutationReceipt", result)
        require(result.getValue("mutationId").jsonPrimitive.content == mutationId)
        val state = result.getValue("state").jsonPrimitive.content
        if (state !in setOf("absent", "parked")) throw FacetActionError("This action is still pending or already saved. Resume it before changing the decision.")
        drafts.discard(mutationId)
    }

    suspend fun conflictsPage(profileId: String, afterId: String? = null): JsonObject = call {
        val page = Json.parseToJsonElement(core.conflictsPageJson(profileId, afterId, 128u)).jsonObject
        schema.validate("conflicts", page)
        FacetContract.validateVersion(page)
        page
    }

    suspend fun conflictPayload(profileId: String, conflictId: String, version: String): ByteArray? = call {
        require(version in setOf("base", "local", "remote"))
        val payload = core.conflictPayload(profileId, conflictId, version) ?: return@call null
        withPayload(payload) {
            val info = payloadInfo(it.infoJson())
            val size = info.getValue("size").jsonPrimitive.content.toULong()
            require(info.getValue("state") == JsonPrimitive("sealed"))
            if (size > 1_048_576uL) throw FacetActionError("This retained version exceeds the text preview limit. Its full bytes remain available to the conflict choices.")
            it.readChunk(0uL, size.toUInt()).also { bytes -> require(bytes.size.toULong() == size) }
        }
    }

    suspend fun features(id: String, request: JsonObject): JsonObject = call {
        schema.validate("featureRequest", request)
        val result = FacetRawJson.parseObject(core.featuresJson(id, request.toString()))
        val definition = when (request.getValue("kind").jsonPrimitive.content) {
            "capture_preview" -> "capturePreview"
            "task_time" -> "taskTime"
            "tracking_sessions" -> "trackingSessions"
            "tracking_history" -> "trackingHistory"
            "time_report" -> "timeReport"
            "pomodoro" -> "pomodoro"
            "discovery" -> "discovery"
            "mutation_receipt" -> "mutationReceipt"
            "resolution_history" -> "resolutionHistory"
            "batch_outcome" -> "batchOutcome"
            "normalization_preview" -> "normalizationPreview"
            "undo_available" -> "undoAvailable"
            "conformance" -> "conformance"
            "reminder_plan" -> "reminderPlan"
            else -> error("Unknown shared feature response.")
        }
        schema.validate(definition, result)
        FacetContract.validateVersion(result)
        result
    }

    suspend fun approveStandard(profile: VaultProfile): VaultProfile = call {
        val json = buildJsonObject { put("schemaVersion", 1); put("id", profile.id); put("name", profile.name); put("kind", profile.kind); put("approveStandard", true) }
        schema.validate("profile", json)
        val result = Json.parseToJsonElement(core.registerProfile(json.toString())).jsonObject
        schema.validate("profile", result)
        FacetContract.profile(result)
    }

    internal suspend fun checkpoint(id: String): String = call { core.loadCheckpoint(id) ?: "" }
    internal suspend fun saveCheckpoint(id: String, json: String) = call { core.saveCheckpoint(id, json) }
    internal suspend fun checkpointDelta(id: String, json: String) = call { core.applySyncCheckpointDelta(id, json) }
    internal suspend fun bindSession(session: FfiObsidianSession, profileId: String) = call { session.bindRuntime(core, profileId) }
    internal suspend fun uploads(id: String): JsonArray = call {
        val response = Json.parseToJsonElement(core.pendingUploadsJson(id)).jsonObject
        schema.validate("uploads", response)
        FacetContract.validateVersion(response)
        response.getValue("uploads").jsonArray
    }
    internal suspend fun acknowledge(id: String, mutationId: String, revision: String) = call { core.acknowledgeUpload(id, mutationId, revision) }
    internal suspend fun directory(id: String, path: String, deleted: Boolean) = call { files.directory(id, path, deleted) }
    suspend fun close() = withContext(Dispatchers.IO) {
        mutex.withLock {
            if (closed) return@withLock
            // Busy leaves the runtime and callback owners intact for exact retry.
            replayFacetBusy({ true }) { core.closeRuntime() }
            closed = true
            var failure: Throwable? = null
            try { callbacks.close() } catch (error: Throwable) { failure = error }
            try { core.close() } catch (error: Throwable) { if (failure == null) failure = error else failure.addSuppressed(error) }
            failure?.let { throw it }
        }
    }

    private fun decodeSnapshot(json: String): VaultSnapshot {
        schema.validate("snapshot", Json.parseToJsonElement(json))
        return FacetContract.snapshot(json)
    }

    private suspend fun <T> call(block: () -> T): T = withContext(Dispatchers.IO) { mutex.withLock { if (closed) throw FacetEngineException.Closed(); block() } }

    private fun payloadInfo(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject.also { schema.validate("payloadInfo", it) }
    private inline fun <T> withPayload(payload: FfiFacetPayload, block: (FfiFacetPayload) -> T): T {
        var failure: Throwable? = null
        try { return block(payload) }
        catch (error: Throwable) { failure = error; throw error }
        finally {
            var cleanup: Throwable? = null
            try { payload.closeHandle() } catch (error: Throwable) { cleanup = error }
            try { payload.close() } catch (error: Throwable) { if (cleanup == null) cleanup = error else cleanup.addSuppressed(error) }
            cleanup?.let { if (failure == null) throw it else failure.addSuppressed(it) }
        }
    }

    companion object {
        fun expectedReminderFailureMessage(failure: Exception): String? = when (failure) {
            is FacetActionError -> failure.explanation
            is FacetEngineException.Configuration -> failure.detail
            is FacetEngineException.Host, is FacetHostException.Unavailable, is FacetHostException.PermissionDenied ->
                "Restore folder access before refreshing this vault's reminders."
            is FacetReminderPermissionException, is SecurityException ->
                "Allow notifications in Android settings before enabling reminders."
            else -> null
        }
        fun failureMessage(failure: Exception): String = when (failure) {
            is FacetActionError -> failure.explanation
            is FacetEngineException.Configuration -> failure.detail
            is FacetEngineException.Validation -> failure.detail
            is FacetEngineException.Host -> "The vault provider is unavailable. Restore folder access and retry your saved draft."
            is FacetEngineException.Storage -> "Facet could not save private state. Check available storage before retrying your saved draft."
            is FacetEngineException.Busy, is ObsidianBoundaryException.Busy -> "Facet is finishing another durable operation. Retry this saved action after it finishes."
            is FacetEngineException.HostContract, is FacetHostException.Contract -> "Facet found inconsistent private recovery state. Your draft and retained versions remain preserved; reopen the app and review its diagnostics."
            is FacetEngineException.Conflict -> "The note changed. Review the conflict inbox before retrying your saved draft."
            is ObsidianBoundaryException.Boundary -> failure.detail
            is FacetNetworkException -> "The connection could not complete. Check your network and retry."
            is java.io.IOException -> "Facet could not access private storage. Check available storage before retrying."
            else -> "Facet could not complete this action. Your draft is still open; retry after reopening the vault."
        }
        suspend fun open(context: Context, retain: (FacetEngineRunner) -> Boolean = { true }): FacetEngineRunner = withContext(Dispatchers.IO) {
            val opened = FacetEngineRunner(context.applicationContext)
            if (!retain(opened)) {
                withContext(kotlinx.coroutines.NonCancellable) { opened.close() }
                throw kotlinx.coroutines.CancellationException("The owning writer stopped during construction.")
            }
            opened
        }
        fun query(text: String = "", scope: String = "all", statuses: List<String> = emptyList(), showCompleted: Boolean = false): JsonObject = buildJsonObject {
            put("schemaVersion", 1); put("offset", 0); put("limit", 100); put("scope", scope); put("today", LocalDate.now().toString())
            if (text.isNotEmpty()) put("text", text)
            if (statuses.isNotEmpty()) put("statuses", JsonArray(statuses.map(::JsonPrimitive)))
            if (!showCompleted && scope != "completed") put("completed", false)
        }
    }
}

class FacetActionError(val explanation: String) : Exception(explanation)
