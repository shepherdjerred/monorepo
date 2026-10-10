package red.sjer.facet.host

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*

/** Isolated staging primitives; live61 callbacks remain unchanged until the coordinated ABI publication. */
internal class FacetBoundedStages(
    private val directory: File,
    private val profile: String,
    private val engineIdentity: String,
    private val synchronize: (File) -> Unit = AtomicFiles::synchronize,
    private val checkpoint: (String) -> Unit = {},
) {
    private val lock = Any()
    init {
        require(profile.isNotBlank())
        requireHash(engineIdentity)
        check(directory.isDirectory || directory.mkdirs())
        require(!Files.isSymbolicLink(directory.toPath()))
    }

    fun begin(owner: String, operationId: String, path: String, expectedRevision: String?, size: ULong, revision: String): BoundedStage = synchronized(lock) {
        requireOwner(owner); requireOperation(operationId); requirePath(path); requireHash(revision)
        expectedRevision?.let(::requireHash)
        require(size <= Long.MAX_VALUE.toULong())
        val id = stageId(engineIdentity, owner, operationId)
        if (Files.exists(manifest(id).toPath(), LinkOption.NOFOLLOW_LINKS)) {
            val existing = read(id)
            check(existing.operationId == operationId && existing.path == path && existing.expectedRevision == expectedRevision && existing.size == size && existing.revision == revision) { "A durable stage cannot change its write intent." }
            recover(existing); return@synchronized existing
        }
        val stage = BoundedStage(id, owner, engineIdentity, operationId, path, expectedRevision, size, revision, 0uL, false, false)
        persist(stage); recover(stage); stage
    }

    fun write(owner: String, id: String, offset: ULong, bytes: ByteArray): BoundedStage = synchronized(lock) {
        requireOwner(owner); require(bytes.size <= CHUNK_BYTES)
        val stage = read(id)
        check(!stage.retired) { "A retired stage cannot accept bytes." }
        recover(stage)
        require(offset <= stage.written && offset <= stage.size && bytes.size.toULong() <= stage.size - offset)
        if (offset < stage.written || stage.sealed) {
            check(bytes.size.toULong() <= stage.written - offset) { "A retry cannot overlap the committed prefix boundary." }
            RandomAccessFile(regular(payload(id)), "r").use { stream ->
                stream.seek(offset.toLong())
                val buffer = ByteArray(COPY_BYTES)
                var position = 0
                while (position < bytes.size) {
                    val count = minOf(buffer.size, bytes.size - position)
                    stream.readFully(buffer, 0, count)
                    check((0 until count).all { buffer[it] == bytes[position + it] }) { "The retried chunk changed its immutable bytes." }
                    position += count
                }
            }
            return@synchronized stage
        }
        RandomAccessFile(regular(payload(id)), "rw").use { stream -> stream.seek(offset.toLong()); stream.write(bytes); stream.fd.sync() }
        checkpoint("payload-written")
        val written = stage.copy(written = offset + bytes.size.toULong())
        persist(written); written
    }

    fun seal(owner: String, id: String): BoundedStage = synchronized(lock) {
        requireOwner(owner)
        val stage = read(id)
        check(!stage.retired)
        recover(stage)
        check(stage.written == stage.size && fingerprint(payload(id)) == stage.revision) { "The staged payload violates its exact size or hash." }
        if (stage.sealed) return@synchronized stage
        RandomAccessFile(regular(payload(id)), "rw").use { it.fd.sync() }
        stage.copy(sealed = true).also(::persist)
    }

    fun copySealed(owner: String, id: String, slot: File) = synchronized(lock) {
        requireOwner(owner)
        val stage = read(id)
        check(stage.sealed && !stage.retired)
        checkpoint("before-slot-copy")
        val source = regular(payload(id))
        check(source.length().toULong() == stage.size)
        check(slot.createNewFile()) { "An exchange slot must be newly reserved." }
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0uL
        FileInputStream(source).use { input -> FileOutputStream(regular(slot)).use { output ->
            val buffer = ByteArray(COPY_BYTES)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                check(count.toULong() <= stage.size - size) { "The sealed source grew while copying." }
                output.write(buffer, 0, count); digest.update(buffer, 0, count); size += count.toULong()
            }
            check(size == stage.size && input.channel.size().toULong() == stage.size && hex(digest.digest()) == stage.revision) { "Copied bytes violate the sealed receipt." }
            output.fd.sync()
        } }
        synchronize(requireNotNull(slot.parentFile))
        checkpoint("slot-copied")
        check(regular(slot).length().toULong() == stage.size && fingerprint(slot) == stage.revision) { "The durable slot violates the sealed receipt." }
    }

    fun discard(owner: String, id: String) = synchronized(lock) {
        requireOwner(owner)
        val stage = read(id)
        if (!stage.retired) persist(stage.copy(retired = true))
        Files.deleteIfExists(payload(id).toPath())
        synchronize(directory)
        // Retain compact owner/intent metadata for lazy exact retry. No captured
        // predecessor is released by stage retirement.
    }

    fun requireSealed(owner: String, id: String): BoundedStage = synchronized(lock) {
        requireOwner(owner)
        val stage = read(id)
        check(stage.sealed && !stage.retired) { "Exchange requires an active sealed stage." }
        recover(stage)
        stage
    }

    fun receipt(owner: String, id: String): BoundedStage = synchronized(lock) { requireOwner(owner); read(id) }

    private fun recover(stage: BoundedStage) {
        val file = payload(stage.id)
        if (stage.retired) { Files.deleteIfExists(file.toPath()); synchronize(directory); return }
        if (!Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) {
            check(stage.written == 0uL && !stage.sealed) { "The stage lost committed bytes." }
            check(file.createNewFile()); FileOutputStream(file).use { it.fd.sync() }; synchronize(directory)
        }
        RandomAccessFile(regular(file), "rw").use {
            check(it.length().toULong() >= stage.written && (!stage.sealed || it.length().toULong() == stage.size)) { "The durable prefix changed." }
            if (it.length().toULong() > stage.written) { it.setLength(stage.written.toLong()); it.fd.sync() }
        }
    }

    private fun persist(stage: BoundedStage) {
        val document = buildJsonObject {
            put("schemaVersion", 1); put("id", stage.id); put("profile", stage.profile); put("engineIdentity", stage.engineIdentity)
            put("operationId", stage.operationId); put("path", stage.path)
            put("expectedRevision", stage.expectedRevision?.let(::JsonPrimitive) ?: JsonNull)
            put("size", stage.size.toLong()); put("revision", stage.revision); put("written", stage.written.toLong())
            put("sealed", stage.sealed); put("retired", stage.retired)
        }
        val temporary = File(directory, UUID.randomUUID().toString() + ".temporary")
        try {
            check(temporary.createNewFile())
            FileOutputStream(temporary).use { it.write(document.toString().toByteArray(Charsets.UTF_8)); it.fd.sync() }
            Files.move(temporary.toPath(), manifest(stage.id).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            synchronize(directory)
        } finally { Files.deleteIfExists(temporary.toPath()) }
    }

    private fun read(id: String): BoundedStage {
        val file = regular(manifest(id))
        check(file.length() <= COPY_BYTES) { "The stage manifest exceeds its metadata bound." }
        val value = Json.parseToJsonElement(file.readText(Charsets.UTF_8)).jsonObject
        require(value.keys == setOf("schemaVersion", "id", "profile", "engineIdentity", "operationId", "path", "expectedRevision", "size", "revision", "written", "sealed", "retired"))
        fun text(key: String): String {
            val item = value.getValue(key)
            require(item is JsonPrimitive && item.isString) { "The private stage field $key must be a string." }
            return item.content
        }
        fun integer(key: String): ULong {
            val item = value.getValue(key)
            require(item is JsonPrimitive && !item.isString && item != JsonNull) { "The private stage field $key must be an integer." }
            return item.content.toULong()
        }
        fun flag(key: String): Boolean {
            val item = value.getValue(key)
            require(item is JsonPrimitive && !item.isString && item != JsonNull) { "The private stage field $key must be a boolean." }
            return item.boolean
        }
        require(integer("schemaVersion") == 1uL)
        val expected = if (value.getValue("expectedRevision") == JsonNull) null else text("expectedRevision")
        val stage = BoundedStage(text("id"), text("profile"), text("engineIdentity"), text("operationId"), text("path"), expected,
            integer("size"), text("revision"), integer("written"), flag("sealed"), flag("retired"))
        check(stage.profile == profile && stage.engineIdentity == engineIdentity && stage.id == id)
        requireOperation(stage.operationId); requirePath(stage.path); requireHash(stage.revision); stage.expectedRevision?.let(::requireHash)
        check(stageId(stage.engineIdentity, stage.profile, stage.operationId) == id && stage.size <= Long.MAX_VALUE.toULong() && stage.written <= stage.size && (!stage.sealed || stage.written == stage.size))
        return stage
    }

    private fun manifest(id: String) = File(directory, key(id) + ".json")
    private fun payload(id: String) = File(directory, key(id) + ".bytes")
    private fun requireOwner(owner: String) { require(owner == profile); require(!Files.isSymbolicLink(directory.toPath())) }
    private fun key(id: String): String { require(id.startsWith("facet-stage:") && id.length == 76); requireHash(id.substring(12)); return hash(id.toByteArray(Charsets.UTF_8)) }
    private fun regular(file: File): File { require(Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(file.toPath())); return file }
    private fun fingerprint(file: File): String = FileInputStream(regular(file)).use { stream ->
        val digest = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(COPY_BYTES)
        while (true) { val count = stream.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        hex(digest.digest())
    }
    companion object {
        const val CHUNK_BYTES = 1_048_576
        private const val COPY_BYTES = 65_536
        private fun requireHash(value: String) { require(Regex("[0-9a-f]{64}").matches(value)) }
        private fun requireOperation(value: String) { require(value.startsWith("facet-write:") && value.length == 76); requireHash(value.substring(12)) }
        private fun requirePath(value: String) { require(value.isNotBlank() && !value.startsWith('/') && '\\' !in value && value.none(Char::isISOControl) && value.split('/').none { it in setOf("", ".", "..") }) }
        private fun stageId(identity: String, profile: String, operation: String) = "facet-stage:" + hash("$identity\u0000$profile\u0000$operation".toByteArray(Charsets.UTF_8))
        private fun hash(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
        private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    }
}

internal data class BoundedStage(val id: String, val profile: String, val engineIdentity: String, val operationId: String, val path: String, val expectedRevision: String?, val size: ULong, val revision: String, val written: ULong, val sealed: Boolean, val retired: Boolean)
