package red.sjer.facet.host

import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*

/** Isolated durable outcome adapter. A capability owner must validate/pin source and private directories. */
internal class FacetBoundedExchange(
    private val directory: File,
    private val profile: String,
    private val engineIdentity: String,
    private val stages: FacetBoundedStages,
    private val resolve: (String) -> File,
    private val io: ExchangeFiles = NativeExchangeFiles,
    private val checkpoint: (String) -> Unit = {},
) {
    init { requireHash(engineIdentity); Files.createDirectories(directory.toPath()); check(!Files.isSymbolicLink(directory.toPath())) }

    @Synchronized
    fun exchange(owner: String, operation: String, path: String, expected: String?, stageId: String?): BoundedExchangeOutcome {
        require(owner == profile)
        requireOperation(operation); expected?.let(::requireHash)
        val key = hash("$engineIdentity\u0000$profile\u0000$operation".toByteArray(Charsets.UTF_8))
        val manifest = File(directory, "$key.exchange.json")
        var intent: Intent
        if (Files.exists(manifest.toPath(), LinkOption.NOFOLLOW_LINKS)) {
            intent = read(manifest)
            io.synchronize(directory)
            check(intent.operation == operation && intent.path == path && intent.expected == expected && intent.stageId == stageId) { "A durable exchange cannot change intent." }
            intent.outcome?.let { outcome ->
                // Replay the original exact result after acknowledgement/cleanup,
                // without consulting a later mutable destination.
                io.synchronize(directory)
                return outcome
            }
        } else {
            resolve(path)
            stageId?.let { checkStage(it, operation, path, expected) }
            intent = Intent(profile, engineIdentity, operation, path, expected, stageId, key, null, null, false)
            persist(manifest, intent)
        }
        val target = resolve(path)
        val slot = File(directory, "$key.exchange-slot")
        val captured = File(directory, "$key.captured.bytes")
        if (io.identity(captured) != null) {
            check(intent.preparedIdentity != null) { "A captured predecessor has no durably prepared exchange." }
            return complete(manifest, intent, target, captured, true)
        }
        stageId?.let { checkStage(it, operation, path, expected) }
        if (intent.preparedIdentity == null) {
            if (fingerprintOrMissing(target) != expected) return complete(manifest, intent, target, null, false)
            intent = if (stageId != null) {
                Files.deleteIfExists(slot.toPath()) // No exchange is possible before prepared metadata commits.
                stages.copySealed(owner, stageId, slot)
                intent.copy(preparedIdentity = io.identity(slot)?.identity ?: error("The prepared slot is missing."))
            } else intent.copy(preparedIdentity = "tombstone")
            persist(manifest, intent)
            checkpoint("prepared")
        }
        if (stageId != null) {
            val slotIdentity = io.identity(slot)
            if (slotIdentity == null) {
                check(expected == null && io.identity(target)?.identity == intent.preparedIdentity) { "The unrecorded create cannot be proven. Preserve recovery state." }
                return complete(manifest, intent, target, null, true)
            }
            if (slotIdentity.identity != intent.preparedIdentity) {
                check(expected != null) { "A create slot changed without a captured exchange." }
                // RENAME_EXCHANGE changed the private slot's device/inode,
                // even if predecessor and replacement bytes were identical.
                io.rename(slot, captured, false)
                return complete(manifest, intent, target, captured, true)
            }
        }
        if (fingerprintOrMissing(target) != expected) return complete(manifest, intent, target, null, false)
        when {
            stageId == null && expected != null -> io.rename(target, captured, false)
            stageId != null && expected == null -> io.rename(slot, target, false)
            stageId != null -> {
                io.rename(slot, target, true)
                checkpoint("exchanged")
                io.rename(slot, captured, false)
            }
        }
        checkpoint("captured")
        return complete(manifest, intent, target, if (io.identity(captured) != null) captured else null, true)
    }

    @Synchronized
    fun metadata(afterId: String? = null, limit: Int = 128): List<BoundedDisplaced> {
        require(limit in 1..128)
        afterId?.let { if (!FacetLegacyBackups.isLegacyId(it)) requireHash(it) }
        // Read only compact recorded outcomes; pending journal replay owns
        // incomplete native exchanges before this metadata traversal.
        return Files.newDirectoryStream(directory.toPath(), "*.retained.json").use { entries ->
            entries.map { it.toFile() }.sortedBy { it.name }.asSequence()
                .map { it.name.removeSuffix(".retained.json") }
                .filter { afterId == null || it > afterId }
                .map { read(File(directory, "$it.exchange.json")) }.filter { !it.acknowledged }.mapNotNull { it.outcome?.displaced }
                .onEach { metadata ->
                    val marker = File(directory, "${metadata.id}.retained.json")
                    check(Files.isRegularFile(marker.toPath(), LinkOption.NOFOLLOW_LINKS) && marker.length() <= 65_536)
                    val document = Json.parseToJsonElement(marker.readText(Charsets.UTF_8)).jsonObject
                    require(document.keys == setOf("schemaVersion", "profile", "engineIdentity", "id", "path", "size", "revision"))
                    check(integer(document, "schemaVersion") == 1uL && text(document, "profile") == profile && text(document, "engineIdentity") == engineIdentity)
                    check(text(document, "id") == metadata.id && text(document, "path") == metadata.path && integer(document, "size") == metadata.size && text(document, "revision") == metadata.revision)
                    check(io.identity(File(directory, "${metadata.id}.captured.bytes")) != null) { "A retained captured predecessor is missing." }
                }
                .take(limit).toList()
        }
    }

    @Synchronized
    fun displacedSource(id: String): Pair<BoundedDisplaced, File> {
        requireHash(id)
        val intent = read(File(directory, "$id.exchange.json"))
        check(!intent.acknowledged) { "The captured predecessor has been acknowledged." }
        val metadata = intent.outcome?.displaced ?: error("The exchange has no recorded captured predecessor.")
        return metadata to File(directory, "$id.captured.bytes")
    }

    @Synchronized
    fun acknowledge(id: String) {
        requireHash(id)
        val manifest = File(directory, "$id.exchange.json")
        val intent = read(manifest)
        check(intent.outcome?.displaced != null) { "The exchange has no recorded captured predecessor to acknowledge." }
        if (!intent.acknowledged) persist(manifest, intent.copy(acknowledged = true))
        Files.deleteIfExists(File(directory, "$id.captured.bytes").toPath())
        Files.deleteIfExists(File(directory, "$id.retained.json").toPath())
        io.synchronize(directory)
    }

    @Synchronized
    fun discardSlot(operation: String) {
        requireOperation(operation)
        val key = hash("$engineIdentity\u0000$profile\u0000$operation".toByteArray(Charsets.UTF_8))
        val manifest = File(directory, "$key.exchange.json")
        if (!Files.exists(manifest.toPath(), LinkOption.NOFOLLOW_LINKS)) return
        val intent = read(manifest)
        check(intent.outcome != null) { "An unresolved exchange cannot discard its potentially captured slot." }
        val slot = File(directory, "$key.exchange-slot")
        val stamp = io.identity(slot)
        if (stamp != null) {
            check(stamp.identity == intent.preparedIdentity) { "The cleanup slot may contain an unacknowledged predecessor." }
            Files.delete(slot.toPath()); io.synchronize(directory)
        }
    }

    private fun checkStage(id: String, operation: String, path: String, expected: String?) {
        val stage = stages.requireSealed(profile, id)
        check(stage.operationId == operation && stage.path == path && stage.expectedRevision == expected) { "The sealed stage does not own this exchange." }
    }

    private fun complete(manifest: File, intent: Intent, target: File, captured: File?, applied: Boolean): BoundedExchangeOutcome {
        val displaced = captured?.let { file ->
            val stamp = io.identity(file) ?: error("The captured predecessor is missing.")
            val revision = fingerprint(file)
            check(io.identity(file) == stamp) { "The captured predecessor changed during hashing." }
            RandomAccessFile(file, "rw").use { it.fd.sync() }
            BoundedDisplaced(intent.key, intent.path, stamp.size.toULong(), revision)
        }
        if (applied) {
            // Atomic rename alone is not power-loss durability. Persist both
            // directory entries before exposing an applied receipt.
            io.synchronize(requireNotNull(target.parentFile))
            io.synchronize(directory)
        }
        val outcome = BoundedExchangeOutcome(applied, displaced)
        if (displaced != null) commit(File(directory, "${displaced.id}.retained.json"), buildJsonObject {
            put("schemaVersion", 1); put("profile", profile); put("engineIdentity", engineIdentity)
            put("id", displaced.id); put("path", displaced.path); put("size", displaced.size.toLong()); put("revision", displaced.revision)
        })
        persist(manifest, intent.copy(outcome = outcome))
        checkpoint("outcome-recorded")
        return outcome
    }

    private fun persist(manifest: File, intent: Intent) {
        val document = buildJsonObject {
            put("schemaVersion", 1); put("profile", intent.profile); put("engineIdentity", intent.engineIdentity)
            put("operation", intent.operation); put("path", intent.path); put("key", intent.key)
            put("expected", intent.expected?.let(::JsonPrimitive) ?: JsonNull)
            put("stageId", intent.stageId?.let(::JsonPrimitive) ?: JsonNull)
            put("preparedIdentity", intent.preparedIdentity?.let(::JsonPrimitive) ?: JsonNull)
            put("acknowledged", intent.acknowledged)
            put("outcome", intent.outcome?.let { result -> buildJsonObject {
                put("applied", result.applied)
                put("displaced", result.displaced?.let { value -> buildJsonObject {
                    put("id", value.id); put("path", value.path); put("size", value.size.toLong()); put("revision", value.revision)
                } } ?: JsonNull)
            } } ?: JsonNull)
        }
        commit(manifest, document)
    }

    private fun commit(manifest: File, document: JsonObject) {
        val temporary = File(directory, UUID.randomUUID().toString() + ".temporary")
        try {
            check(temporary.createNewFile())
            FileOutputStream(temporary).use { it.write(document.toString().toByteArray(Charsets.UTF_8)); it.fd.sync() }
            Files.move(temporary.toPath(), manifest.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            io.synchronize(directory)
        } finally { Files.deleteIfExists(temporary.toPath()) }
    }

    private fun read(manifest: File): Intent {
        check(Files.isRegularFile(manifest.toPath(), LinkOption.NOFOLLOW_LINKS) && manifest.length() <= 65_536)
        val value = Json.parseToJsonElement(manifest.readText(Charsets.UTF_8)).jsonObject
        require(value.keys == setOf("schemaVersion", "profile", "engineIdentity", "operation", "path", "key", "expected", "stageId", "preparedIdentity", "outcome", "acknowledged"))
        require(integer(value, "schemaVersion") == 1uL)
        val operation = text(value, "operation"); requireOperation(operation)
        val key = hash("$engineIdentity\u0000$profile\u0000$operation".toByteArray(Charsets.UTF_8))
        check(text(value, "profile") == profile && text(value, "engineIdentity") == engineIdentity && text(value, "key") == key && manifest.name == "$key.exchange.json")
        val path = text(value, "path"); resolve(path)
        val expected = nullableText(value, "expected"); expected?.let(::requireHash)
        val prepared = nullableText(value, "preparedIdentity")
        val stageId = nullableText(value, "stageId")
        val outcome = if (value.getValue("outcome") == JsonNull) null else value.getValue("outcome").jsonObject.let { result ->
            require(result.keys == setOf("applied", "displaced"))
            val appliedValue = result.getValue("applied")
            require(appliedValue is JsonPrimitive && !appliedValue.isString && appliedValue != JsonNull)
            val applied = appliedValue.boolean
            val displaced = if (result.getValue("displaced") == JsonNull) null else result.getValue("displaced").jsonObject.let { old ->
                require(old.keys == setOf("id", "path", "size", "revision"))
                val revision = text(old, "revision"); requireHash(revision)
                val size = integer(old, "size")
                check(applied && text(old, "id") == key && text(old, "path") == path && size <= Long.MAX_VALUE.toULong())
                BoundedDisplaced(key, path, size, revision)
            }
            check(!applied || prepared != null)
            BoundedExchangeOutcome(applied, displaced)
        }
        val acknowledgedValue = value.getValue("acknowledged")
        require(acknowledgedValue is JsonPrimitive && !acknowledgedValue.isString && acknowledgedValue != JsonNull)
        val acknowledged = acknowledgedValue.boolean
        check(!acknowledged || outcome?.displaced != null)
        return Intent(profile, engineIdentity, operation, path, expected, stageId, key, prepared, outcome, acknowledged)
    }

    private fun fingerprintOrMissing(file: File): String? = if (io.identity(file) == null) null else fingerprint(file)
    private fun fingerprint(file: File): String = file.inputStream().use { input ->
        val digest = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(65_536)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        hashDigest(digest.digest())
    }
    private data class Intent(val profile: String, val engineIdentity: String, val operation: String, val path: String, val expected: String?, val stageId: String?, val key: String, val preparedIdentity: String?, val outcome: BoundedExchangeOutcome?, val acknowledged: Boolean)
    companion object {
        private fun text(value: JsonObject, key: String): String { val item = value.getValue(key); require(item is JsonPrimitive && item.isString); return item.content }
        private fun nullableText(value: JsonObject, key: String): String? = if (value.getValue(key) == JsonNull) null else text(value, key)
        private fun integer(value: JsonObject, key: String): ULong { val item = value.getValue(key); require(item is JsonPrimitive && !item.isString && item != JsonNull); return item.content.toULong() }
        private fun requireHash(value: String) { require(Regex("[0-9a-f]{64}").matches(value)) }
        private fun requireOperation(value: String) { require(value.startsWith("facet-write:") && value.length == 76); requireHash(value.substring(12)) }
        private fun hash(bytes: ByteArray) = hashDigest(MessageDigest.getInstance("SHA-256").digest(bytes))
        private fun hashDigest(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    }
}

internal data class BoundedDisplaced(val id: String, val path: String, val size: ULong, val revision: String)
internal data class BoundedExchangeOutcome(val applied: Boolean, val displaced: BoundedDisplaced?)
internal interface ExchangeFiles {
    fun identity(file: File): FacetFileStamp?
    fun rename(source: File, destination: File, exchange: Boolean)
    fun synchronize(directory: File)
}
internal object NativeExchangeFiles : ExchangeFiles {
    override fun identity(file: File) = NativeSnapshotFiles.identity(file)
    override fun rename(source: File, destination: File, exchange: Boolean) = AtomicFiles.rename(source, destination, exchange)
    override fun synchronize(directory: File) = AtomicFiles.synchronize(directory)
}
