package red.sjer.facet.host

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.LinkOption
import java.nio.file.StandardOpenOption
import java.util.UUID
import kotlinx.serialization.json.*

/** Durable host envelope identity; Rust owns action semantics and receipts. */
internal class FacetMutationDrafts(private val directory: File) {
    init { if (!directory.isDirectory) check(directory.mkdirs()) }
    fun envelope(profileId: String, id: String, command: JsonObject, at: String): JsonObject {
        require(UUID.fromString(id).toString() == id.lowercase())
        val target = File(directory, "$id.json")
        val previous = read(id)
        if (previous != null) {
            val mutation = previous.mutation
            if (previous.profileId != profileId || mutation.getValue("command") != command) {
                throw FacetActionError("This saved action belongs to a different draft or vault. Start a new action to save the changed draft.")
            }
            return mutation
        }
        val mutation = buildJsonObject {
            put("schemaVersion", 1); put("mutationId", id); put("at", at); put("command", command)
            put("executionContext", buildJsonObject { put("today", java.time.LocalDate.now().toString()); put("timezone", java.time.ZoneId.systemDefault().id) })
        }
        val draft = buildJsonObject { put("profileId", profileId); put("mutation", mutation) }
        val temporary = File(directory, "${UUID.randomUUID()}.pending")
        FileOutputStream(temporary).use { stream -> stream.write(draft.toString().toByteArray()); stream.fd.sync() }
        AtomicFiles.rename(temporary, target, false)
        AtomicFiles.synchronize(directory)
        return mutation
    }

    fun pending(profileId: String? = null, afterId: String? = null, limit: Int = 128): List<PendingFacetMutation> {
        require(limit in 1..128)
        afterId?.let(::validateId)
        val ids = Files.newDirectoryStream(directory.toPath()).use { entries ->
            entries.mapNotNull { entry ->
                val name = entry.fileName.toString()
                if (name.endsWith(".pending") || name.endsWith(".payload") || name.endsWith(".payload-meta") || name.endsWith(".observed")) {
                    val id = name.substringBefore('.')
                    validateId(id)
                    null
                }
                else {
                    require(name.endsWith(".json")) { "Unexpected private action record." }
                    name.removeSuffix(".json").also(::validateId)
                }
            }.sorted()
        }
        return ids.asSequence().filter { afterId == null || it > afterId }
            .map { requireNotNull(read(it)) { "A saved action disappeared during recovery." } }
            .filter { profileId == null || it.profileId == profileId }.take(limit).toList()
    }

    fun read(id: String): PendingFacetMutation? {
        validateId(id)
        val target = File(directory, "$id.json").toPath()
        val bytes = try {
            Files.newByteChannel(target, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
                require(channel.size() <= 4 * 1024 * 1024) { "Private action record exceeds its bound." }
                java.nio.channels.Channels.newInputStream(channel).readBytes()
            }
        } catch (_: NoSuchFileException) { return null }
        val draft = Json.parseToJsonElement(bytes.toString(Charsets.UTF_8)).jsonObject
        require(draft.keys == setOf("profileId", "mutation")) { "Invalid private action record." }
        val profile = draft.getValue("profileId").jsonPrimitive
        require(profile.isString && profile.content.isNotBlank())
        val mutation = draft.getValue("mutation").jsonObject
        require(mutation.getValue("mutationId").jsonPrimitive.content == id) { "Private action identity differs from its filename." }
        return PendingFacetMutation(profile.content, mutation)
    }

    private fun validateId(id: String) { require(UUID.fromString(id).toString() == id) }

    fun preparePayload(id: String, payload: ByteArray?) {
        validateId(id)
        val metadata = buildJsonObject {
            put("deleted", payload == null); put("size", payload?.size ?: 0)
            put("revision", payload?.let(::digest)?.let(::JsonPrimitive) ?: JsonNull)
        }
        val meta = File(directory, "$id.payload-meta")
        val existing = readMetadata(meta)
        if (existing != null) {
            if (Json.parseToJsonElement(existing) != metadata) throw FacetActionError("This saved action has a different replacement. Start a new action for the changed draft.")
            return
        }
        if (payload != null) {
            val target = File(directory, "$id.payload")
            if (Files.exists(target.toPath(), LinkOption.NOFOLLOW_LINKS)) {
                require(digestFile(target) == digest(payload))
            } else writeNew(target, payload)
        }
        writeNew(meta, metadata.toString().toByteArray(Charsets.UTF_8))
    }

    /** Open the exact retained descriptor; callers stage bounded chunks, never a whole-file array. */
    fun openPayload(id: String, maximumSize: ULong): DraftPayload? {
        validateId(id)
        val value = Json.parseToJsonElement(requireNotNull(readMetadata(File(directory, "$id.payload-meta")))).jsonObject
        require(value.keys == setOf("deleted", "size", "revision"))
        val deleted = value.getValue("deleted").jsonPrimitive
        val count = value.getValue("size").jsonPrimitive
        require(!deleted.isString && !count.isString)
        val size = count.long
        require(size >= 0 && size.toULong() <= maximumSize)
        if (deleted.boolean) {
            require(size == 0L && value.getValue("revision") == JsonNull)
            return null
        }
        val revision = value.getValue("revision").jsonPrimitive
        require(revision.isString && Regex("[0-9a-f]{64}").matches(revision.content))
        val file = File(directory, "$id.payload").toPath()
        val channel = Files.newByteChannel(file, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)
        try {
            require(channel.size() == size) { "The saved replacement length changed." }
            return DraftPayload(channel, size.toULong(), revision.content)
        } catch (failure: Throwable) {
            try { channel.close() } catch (cleanup: Throwable) { failure.addSuppressed(cleanup) }
            throw failure
        }
    }

    private fun digest(bytes: ByteArray): String = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun digestFile(file: File): String {
        val hash = java.security.MessageDigest.getInstance("SHA-256")
        Files.newByteChannel(file.toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
            val buffer = java.nio.ByteBuffer.allocate(65536)
            while (channel.read(buffer) != -1) { buffer.flip(); hash.update(buffer); buffer.clear() }
        }
        return hash.digest().joinToString("") { "%02x".format(it) }
    }
    private fun readMetadata(file: File): String? = try {
        Files.newByteChannel(file.toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
            require(channel.size() <= 4096)
            java.nio.channels.Channels.newInputStream(channel).readBytes().toString(Charsets.UTF_8)
        }
    } catch (_: NoSuchFileException) { null }
    private fun writeNew(target: File, bytes: ByteArray) {
        val temporary = File(directory, "${UUID.randomUUID()}.pending")
        FileOutputStream(temporary).use { stream -> stream.write(bytes); stream.fd.sync() }
        AtomicFiles.rename(temporary, target, false)
        AtomicFiles.synchronize(directory)
    }
    fun discard(id: String) {
        require(UUID.fromString(id).toString() == id.lowercase())
        Files.deleteIfExists(File(directory, "$id.payload").toPath())
        Files.deleteIfExists(File(directory, "$id.payload-meta").toPath())
        AtomicFiles.synchronize(directory)
        // Preserve the discoverable envelope until its retained blobs are gone.
        Files.deleteIfExists(File(directory, "$id.json").toPath())
        AtomicFiles.synchronize(directory)
    }

    fun recordObserved(id: String, profileId: String) {
        validateId(id)
        val value = buildJsonObject { put("schemaVersion", 1); put("mutationId", id); put("profileId", profileId) }
        val target = File(directory, "$id.observed")
        if (Files.exists(target.toPath(), LinkOption.NOFOLLOW_LINKS)) {
            require(observed(id) == value) { "The observed action record changed." }
        } else { writeNew(target, value.toString().toByteArray(Charsets.UTF_8)) }
    }

    fun reconcileObservedPayloads() {
        val ids = observedOrphans()
        ids.forEach(::discard)
    }

    internal fun observedOrphans(): List<String> = Files.newDirectoryStream(directory.toPath()).use { entries ->
        entries.filter { it.fileName.toString().endsWith(".observed") }.map { entry ->
            entry.fileName.toString().removeSuffix(".observed").also { id -> validateId(id); observed(id) }
        }.filter { id -> !Files.exists(File(directory, "$id.json").toPath(), LinkOption.NOFOLLOW_LINKS) }.sorted()
    }

    private fun observed(id: String): JsonObject {
        val bytes = Files.newByteChannel(File(directory, "$id.observed").toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
            require(channel.size() <= 4096) { "The observed action record exceeds its bound." }
            java.nio.channels.Channels.newInputStream(channel).readBytes()
        }
        val text = Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        val value = Json.parseToJsonElement(text).jsonObject
        require(value.keys == setOf("schemaVersion", "mutationId", "profileId"))
        require(value.getValue("schemaVersion") == JsonPrimitive(1) && value.getValue("mutationId") == JsonPrimitive(id))
        require(value.getValue("profileId").jsonPrimitive.content.isNotEmpty())
        return value
    }
}

data class PendingFacetMutation(val profileId: String, val mutation: JsonObject) {
    val mutationId: String get() = mutation.getValue("mutationId").jsonPrimitive.content
}
