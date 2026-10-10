package red.sjer.facet.host

import android.os.SystemClock
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedSendChannelException
import kotlinx.coroutines.selects.select
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import uniffi.TaskNotesCore.*

/** A serial off-UI executor of Rust effects with socket/profile epoch fences. */
class ObsidianReplicaSession private constructor(
    private val engine: FacetEngineRunner,
    private val account: ObsidianAccountHost,
    private val profileId: String,
    private val session: FfiObsidianSession,
    private val changed: suspend () -> Unit,
    private val state: suspend (String) -> Unit,
    private val accountGeneration: Long,
) {
    private sealed interface Event {
        data class Opened(val epoch: Long) : Event
        data class Text(val epoch: Long, val value: String) : Event
        data class Binary(val epoch: Long, val value: ByteArray) : Event
        data class Lost(val epoch: Long) : Event
        data object Tick : Event
        data object Stop : Event
        data class Inspect(val reply: CompletableDeferred<Boolean>) : Event
    }
    private val events = Channel<Event>(8)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder().followRedirects(false).build()
    private val nonce = SecureRandom()
    private val limits = obsidianTransportLimits()
    private val metadata = mutableMapOf<ULong, JsonObject>()
    private val queued = mutableSetOf<String>()
    private data class UploadAdmission(val nonce: ByteArray, val at: ULong)
    private val admissions = mutableMapOf<String, UploadAdmission>()
    private var epoch = 0L
    @Volatile private var socket: WebSocket? = null
    private val stopped = AtomicBoolean(false)
    private var ready = false
    private var dirty = false
    private lateinit var runner: Deferred<Unit>

    private fun now(): ULong = SystemClock.elapsedRealtime().toULong()

    private fun start() {
        if (stopped.get()) { session.unbindRuntime(now()); session.close(); scope.cancel(); return }
        runner = scope.async {
            var original: Throwable? = null
            try {
                process(clockInput { session.begin(it) })
                launch { while (isActive) { delay(1000); events.send(Event.Tick) } }
                for (event in events) {
                    if (account.generation != accountGeneration || event == Event.Stop) { process(session.cancel(now())); break }
                    val effects = when (event) {
                        is Event.Opened -> if (event.epoch == epoch) clockInput { session.opened(it) } else emptyList()
                        is Event.Text -> if (event.epoch == epoch) { val receivedAt = now(); busyRetry { session.receiveText(event.value, receivedAt) } } else emptyList()
                        is Event.Binary -> if (event.epoch == epoch) { val receivedAt = now(); busyRetry { session.receiveBinary(event.value, receivedAt) } } else emptyList()
                        is Event.Lost -> if (event.epoch == epoch) { ready = false; clockInput { session.disconnected(it) } } else emptyList()
                        Event.Tick -> clockInput { session.tick(it) }
                        Event.Stop -> emptyList()
                        is Event.Inspect -> { event.reply.complete(ready && !stopped.get() && metadata.isEmpty() && queued.isEmpty()); emptyList() }
                    }
                    process(effects)
                    if (event == Event.Tick && dirty) { dirty = false; changed() }
                    if (ready) uploadPending()
                }
            } catch (cancelled: CancellationException) {
                original = cancelled
                throw cancelled
            } catch (failure: Exception) {
                original = failure
                android.util.Log.e("FacetSync", "phase=session; ${FacetFailureDiagnostic.from(failure).chain}")
                state(FacetEngineRunner.failureMessage(failure))
                if (failure !is FacetNetworkException && failure !is FacetEngineException.Host && failure !is ObsidianBoundaryException.Boundary) throw failure
            } finally {
                withContext(NonCancellable) {
                    events.close()
                    val cleanup = cleanupBackgroundResources(listOf(
                        { socket?.cancel(); socket = null },
                        { session.unbindRuntime(now()) },
                        { session.close() },
                    )) { scope.cancel() }
                    cleanup?.let { if (original == null) throw it else original.addSuppressed(it) }
                }
            }
        }
        if (stopped.get()) runner.cancel()
    }

    suspend fun stop() { requestStop(); if (::runner.isInitialized) try { runner.await() } catch (cancelled: CancellationException) { if (!stopped.get()) throw cancelled } }
    suspend fun isIdle(): Boolean {
        val reply = CompletableDeferred<Boolean>()
        try { events.send(Event.Inspect(reply)) }
        catch (_: ClosedSendChannelException) { return false }
        return select { reply.onAwait { it }; runner.onJoin { false } }
    }
    /** Immediately fences network effects even while a durable engine call is finishing. */
    fun requestStop() {
        if (!stopped.compareAndSet(false, true)) return
        socket?.cancel()
        if (::runner.isInitialized) runner.cancel()
    }

    private suspend fun process(initial: List<ObsidianSessionEffect>) {
        val effects = ArrayDeque(initial)
        while (effects.isNotEmpty()) {
            if (stopped.get() || account.generation != accountGeneration) throw CancellationException("The Sync session stopped.")
            currentCoroutineContext().ensureActive()
            when (val effect = effects.removeFirst()) {
                is ObsidianSessionEffect.Connect -> {
                    socket?.cancel(); epoch++
                    val generation = epoch
                    socket = client.newWebSocket(Request.Builder().url(effect.url).build(), object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) { enqueue(Event.Opened(generation)) }
                        override fun onMessage(webSocket: WebSocket, text: String) {
                            if (text.codePoints().mapToLong { scalar ->
                                    when { scalar <= 0x7f -> 1L; scalar <= 0x7ff -> 2L; scalar <= 0xffff -> 3L; else -> 4L }
                                }.sum().toULong() > limits.textMessageBytes) { webSocket.cancel(); enqueue(Event.Lost(generation)); return }
                            enqueue(Event.Text(generation, text))
                        }
                        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                            if (bytes.size.toULong() > limits.binaryMessageBytes) { webSocket.cancel(); enqueue(Event.Lost(generation)); return }
                            enqueue(Event.Binary(generation, bytes.toByteArray()))
                        }
                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { response?.close(); enqueue(Event.Lost(generation)) }
                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { enqueue(Event.Lost(generation)) }
                    })
                    state("Connecting to Obsidian Sync…")
                }
                is ObsidianSessionEffect.SendText -> if (socket?.send(effect.text) != true) throw FacetNetworkException(java.io.IOException("Sync frame send failed."))
                is ObsidianSessionEffect.SendBinary -> if (socket?.send(effect.bytes.toByteString()) != true) throw FacetNetworkException(java.io.IOException("Sync frame send failed."))
                ObsidianSessionEffect.Close -> { epoch++; socket?.cancel(); socket = null; ready = false }
                is ObsidianSessionEffect.PersistCheckpoint -> {
                    busyRetry { engine.saveCheckpoint(profileId, effect.checkpointJson) }
                    effects.addAll(clockInput { session.checkpointPersisted(effect.revision, it) })
                }
                is ObsidianSessionEffect.PersistCheckpointDelta -> {
                    busyRetry { engine.checkpointDelta(profileId, effect.deltaJson) }
                    effects.addAll(clockInput { session.checkpointPersisted(effect.revision, it) })
                }
                is ObsidianSessionEffect.RemoteChange -> {
                    val file = Json.parseToJsonElement(effect.metadataJson).jsonObject
                    val uid = file.getValue("uid").jsonPrimitive.content.toULong()
                    metadata[uid] = file
                    if (!file.getValue("selected").jsonPrimitive.boolean) {
                        effects.addAll(busyRetry { session.completeRemote(uid) }); metadata.remove(uid)
                    } else if (file.getValue("folder").jsonPrimitive.boolean) {
                        engine.directory(profileId, file.getValue("path").jsonPrimitive.content, file.getValue("deleted").jsonPrimitive.boolean)
                        effects.addAll(busyRetry { session.completeRemote(uid) }); metadata.remove(uid)
                    } else { val queuedAt = now(); effects.addAll(busyRetry { session.queueDownload(uid, queuedAt) }) }
                }
                is ObsidianSessionEffect.DownloadedPayload -> {
                    check(metadata.containsKey(effect.uid)) { "The download has no owning remote notice." }
                    // Native never sees whole plaintext bytes or reconstructs ingest metadata.
                    busyRetry { session.applyDownload(effect.transferId) }
                    effects.addAll(busyRetry { session.completeRemote(effect.uid) }); metadata.remove(effect.uid)
                    dirty = true
                }
                is ObsidianSessionEffect.Uploaded -> {
                    check(queued.contains(effect.operationId)) { "Sync acknowledged an unknown local receipt." }
                    busyRetry { engine.acknowledge(profileId, effect.operationId, effect.contentHash) }
                    queued.remove(effect.operationId)
                    dirty = true
                }
                is ObsidianSessionEffect.Cancelled -> queued.remove(effect.operationId)
                is ObsidianSessionEffect.Failed -> { effect.operationId?.let { queued.remove(it) }; state(effect.message) }
                is ObsidianSessionEffect.Ready -> { ready = true; state("Downloading pending changes…"); dirty = true }
            }
        }
    }

    private suspend fun <T> clockInput(operation: (ULong) -> T): T {
        val at = now()
        return busyRetry { operation(at) }
    }

    /** Busy is pre-consumption for receive/queue and retains the exact transfer for apply. */
    private suspend fun <T> busyRetry(operation: suspend () -> T): T {
        return replayFacetBusy({ !stopped.get() && account.generation == accountGeneration }, operation = operation)
    }

    private suspend fun uploadPending() {
        for (entry in engine.uploads(profileId).take(8)) {
            if (stopped.get() || account.generation != accountGeneration) throw CancellationException("The Sync session stopped.")
            val upload = entry.jsonObject
            val id = upload.getValue("mutationId").jsonPrimitive.content
            if (queued.contains(id)) continue
            val admission = admissions.getOrPut(id) { UploadAdmission(ByteArray(12).also(nonce::nextBytes), now()) }
            val effects = try {
                busyRetry { session.queueDurableUpload(id, admission.nonce, admission.at) }
            } catch (failure: ObsidianBoundaryException.Boundary) {
                if (failure.code == "queue_full") break
                throw failure
            }
            check(queued.add(id)) { "A durable upload was admitted twice." }
            admissions.remove(id)
            // Admission ownership survives every later process/effect failure.
            process(effects)
        }
    }

    private fun enqueue(event: Event) {
        // OkHttp's reader callback is already off UI. Backpressure preserves
        // exact frame order and bounds retained encrypted pieces.
        try { runBlocking { events.send(event) } }
        catch (_: ClosedSendChannelException) { }
        catch (_: CancellationException) { }
    }

    companion object {
        suspend fun open(engine: FacetEngineRunner, account: ObsidianAccountHost, profileId: String, changed: suspend () -> Unit, state: suspend (String) -> Unit,
            retain: (ObsidianReplicaSession) -> Boolean = { true }): ObsidianReplicaSession {
            val candidate = withContext(Dispatchers.IO) { construct(engine, account, profileId, changed, state) }
            try {
                currentCoroutineContext().ensureActive()
                if (!retain(candidate)) throw CancellationException("The owning Sync session stopped.")
                currentCoroutineContext()[Job]?.invokeOnCompletion { cause -> if (cause is CancellationException) candidate.requestStop() }
                candidate.start()
                return candidate
            } catch (failure: Exception) {
                candidate.requestStop()
                candidate.session.unbindRuntime(candidate.now())
                candidate.session.close()
                candidate.scope.cancel()
                throw failure
            }
        }

        private suspend fun construct(engine: FacetEngineRunner, account: ObsidianAccountHost, profileId: String, changed: suspend () -> Unit, state: suspend (String) -> Unit): ObsidianReplicaSession {
            val owningGeneration = account.generation
            val metadata = account.sessionMetadata(profileId)
            val (token, key) = account.sessionSecrets(profileId)
            try {
                if (account.generation != owningGeneration) throw CancellationException("The owning account changed during credential capture.")
                val options = ObsidianSessionOptions(metadata.getValue("host").jsonPrimitive.content, token.toString(Charsets.UTF_8), metadata.getValue("id").jsonPrimitive.content, "Facet Android", metadata.getValue("encryptionVersion").jsonPrimitive.int.toUByte(), metadata.getValue("salt").jsonPrimitive.content, key, engine.checkpoint(profileId), null)
                val session = FfiObsidianSession(options)
                try {
                    engine.bindSession(session, profileId)
                    if (account.generation != owningGeneration) throw CancellationException("The owning account changed while binding its session.")
                }
                catch (failure: Throwable) {
                    withContext(NonCancellable) {
                        val at = SystemClock.elapsedRealtime().toULong()
                        val cleanup = cleanupBackgroundResources(listOf(
                            { replayFacetBusy({ true }) { session.unbindRuntime(at) } },
                            { session.close() }
                        )) { }
                        cleanup?.let(failure::addSuppressed)
                    }
                    throw failure
                }
                return ObsidianReplicaSession(engine, account, profileId, session, changed, state, owningGeneration)
            } finally { token.fill(0); key.fill(0) }
        }
    }
}
