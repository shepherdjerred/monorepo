package red.sjer.facet.host

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*

/** Metadata-only migration of retained versions; acknowledgements precede unlink and survive restart. */
internal class FacetLegacyBackups(
    private val directory: File,
    private val receipts: File,
    private val profile: String,
    private val engineIdentity: String,
    private val resolve: (String) -> File,
    private val io: ExchangeFiles = NativeExchangeFiles,
    private val checkpoint: (String) -> Unit = {},
) {
    init { require(Regex("[0-9a-f]{64}").matches(engineIdentity)); Files.createDirectories(receipts.toPath()); check(!Files.isSymbolicLink(receipts.toPath())) }

    fun metadata(afterId: String?, limit: Int): List<BoundedDisplaced> {
        require(limit in 1..128)
        if (!Files.exists(directory.toPath(), LinkOption.NOFOLLOW_LINKS)) return emptyList()
        require(Files.isDirectory(directory.toPath(), LinkOption.NOFOLLOW_LINKS) && Files.isDirectory(receipts.toPath(), LinkOption.NOFOLLOW_LINKS))
        return Files.newDirectoryStream(directory.toPath(), "*.json").use { entries ->
            entries.map { it.fileName.toString().removeSuffix(".json") }.sorted().asSequence()
                .onEach { require(isLegacyId(it)) }.filter { afterId == null || it > afterId }
                .mapNotNull { id -> val observed = acknowledged(id); if (observed == null) source(id).first else { cleanup(observed); null } }
                .take(limit).toList()
        }
    }

    fun source(id: String): Pair<BoundedDisplaced, File> {
        require(Files.isDirectory(directory.toPath(), LinkOption.NOFOLLOW_LINKS) && Files.isDirectory(receipts.toPath(), LinkOption.NOFOLLOW_LINKS))
        require(isLegacyId(id))
        check(acknowledged(id) == null) { "The legacy predecessor has been acknowledged." }
        val metadataFile = File(directory, "$id.json")
        var document = requireNotNull(read(metadataFile)) { "The legacy backup metadata is missing." }
        require(document.keys.all { it in setOf("id", "path", "expectedRevision", "replacementRevision", "capturedSize", "capturedRevision") })
        require(text(document, "id") == id)
        val path = text(document, "path"); resolve(path)
        nullableHash(document, "expectedRevision"); val replacement = nullableHash(document, "replacementRevision")
        val source = File(directory, "$id.bytes")
        val capturedRevision = nullableHash(document, "capturedRevision")
        require((capturedRevision == null) == (document["capturedSize"] == null)) { "Legacy capture metadata is incomplete." }
        if (capturedRevision == null) {
            val actual = fingerprint(source) ?: throw LegacyRecoveryProofException()
            if (replacement == actual.second) throw LegacyRecoveryProofException()
            document = JsonObject(document + mapOf("capturedSize" to JsonPrimitive(actual.first), "capturedRevision" to JsonPrimitive(actual.second)))
            persist(metadataFile, document)
        }
        if (!Files.exists(source.toPath(), LinkOption.NOFOLLOW_LINKS)) throw LegacyRecoveryProofException()
        require(Files.isRegularFile(source.toPath(), LinkOption.NOFOLLOW_LINKS))
        val size = Files.newByteChannel(source.toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { it.size().toULong() }
        check(integer(document, "capturedSize") == size) { "The retained legacy backup size changed." }
        // Recorded metadata remains bounded; the snapshot streams and checks
        // the actual hash, and acknowledgement checks it before unlink.
        return BoundedDisplaced(id, path, size, requireNotNull(nullableHash(document, "capturedRevision"))) to source
    }

    fun acknowledge(id: String) {
        require(Files.isDirectory(directory.toPath(), LinkOption.NOFOLLOW_LINKS) && Files.isDirectory(receipts.toPath(), LinkOption.NOFOLLOW_LINKS))
        require(isLegacyId(id))
        var receipt = acknowledged(id)
        if (receipt == null) {
            val metadata = source(id).first
            persist(receiptFile(id), buildJsonObject {
                put("schemaVersion", 1); put("profile", profile); put("engineIdentity", engineIdentity)
                put("id", metadata.id); put("path", metadata.path); put("size", JsonPrimitive(metadata.size)); put("revision", metadata.revision)
            })
            receipt = metadata
            checkpoint("acknowledged")
        }
        cleanup(receipt)
    }

    private fun cleanup(receipt: BoundedDisplaced) {
        val metadataFile = File(directory, "${receipt.id}.json")
        read(metadataFile)?.let { value ->
            check(text(value, "id") == receipt.id && text(value, "path") == receipt.path && integer(value, "capturedSize") == receipt.size && text(value, "capturedRevision") == receipt.revision) { "The acknowledged legacy backup identity changed." }
        }
        val source = File(directory, "${receipt.id}.bytes")
        fingerprint(source)?.let { check(it.first == receipt.size && it.second == receipt.revision) { "The acknowledged legacy backup bytes changed." } }
        Files.deleteIfExists(source.toPath()); io.synchronize(directory); checkpoint("bytes-removed")
        Files.deleteIfExists(metadataFile.toPath()); io.synchronize(directory); checkpoint("metadata-removed")
    }

    private fun acknowledged(id: String): BoundedDisplaced? = read(receiptFile(id))?.let { value ->
        require(value.keys == setOf("schemaVersion", "profile", "engineIdentity", "id", "path", "size", "revision"))
        check(integer(value, "schemaVersion") == 1uL && text(value, "profile") == profile && text(value, "engineIdentity") == engineIdentity && text(value, "id") == id) { "The legacy acknowledgement belongs to another owner." }
        val path = text(value, "path"); resolve(path)
        BoundedDisplaced(id, path, integer(value, "size"), requireNotNull(nullableHash(value, "revision")))
    }

    private fun fingerprint(file: File): Pair<ULong, String>? {
        if (!Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return null
        require(Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS))
        return Files.newByteChannel(file.toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
            val size = channel.size(); val hash = MessageDigest.getInstance("SHA-256"); val buffer = java.nio.ByteBuffer.allocate(65_536)
            var count = 0L
            while (true) { val read = channel.read(buffer); if (read < 0) break; count += read; buffer.flip(); hash.update(buffer); buffer.clear() }
            check(size == count && channel.size() == size) { "The retained legacy image changed." }
            size.toULong() to hash.digest().joinToString("") { "%02x".format(it) }
        }
    }

    private fun read(file: File): JsonObject? {
        if (!Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return null
        require(Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS))
        return Files.newByteChannel(file.toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
            val size = channel.size()
            require(size in 0..65_536)
            checkpoint("metadata-opened")
            val bytes = java.nio.ByteBuffer.allocate(size.toInt())
            while (bytes.hasRemaining()) check(channel.read(bytes) > 0) { "Legacy metadata was truncated during its bounded read." }
            check(channel.read(java.nio.ByteBuffer.allocate(1)) == -1 && channel.size() == size) { "Legacy metadata grew during its bounded read." }
            bytes.flip()
            val text = Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(bytes).toString()
            Json.parseToJsonElement(text).jsonObject
        }
    }

    private fun persist(target: File, value: JsonObject) {
        val temporary = File(target.parentFile, UUID.randomUUID().toString() + ".pending")
        FileOutputStream(temporary).use { it.write(value.toString().toByteArray(Charsets.UTF_8)); it.fd.sync() }
        try { io.rename(temporary, target, Files.exists(target.toPath(), LinkOption.NOFOLLOW_LINKS)); io.synchronize(requireNotNull(target.parentFile)) }
        finally { Files.deleteIfExists(temporary.toPath()) }
    }
    private fun receiptFile(id: String) = File(receipts, MessageDigest.getInstance("SHA-256").digest(id.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) } + ".json")
    private fun text(value: JsonObject, key: String): String { val item = value.getValue(key).jsonPrimitive; require(item.isString); return item.content }
    private fun integer(value: JsonObject, key: String): ULong { val item = value.getValue(key).jsonPrimitive; require(!item.isString && Regex("0|[1-9][0-9]*").matches(item.content)); return item.content.toULong() }
    private fun nullableHash(value: JsonObject, key: String): String? {
        val item = value[key] ?: return null
        if (item == JsonNull) return null
        val text = text(value, key); require(Regex("[0-9a-f]{64}").matches(text)); return text
    }
    companion object { fun isLegacyId(id: String): Boolean = try { UUID.fromString(id).toString() == id.lowercase() } catch (_: IllegalArgumentException) { false } }
}
