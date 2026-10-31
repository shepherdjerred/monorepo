package red.sjer.facet.host

import android.content.Context
import android.system.ErrnoException
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*

/** Private replicas only. An arbitrary SAF tree has no atomic-CAS contract. */
internal class PrivateVaultFiles(private val roots: File) {
    constructor(context: Context) : this(File(context.noBackupFilesDir, "vaults"))
    init { check(roots.isDirectory || roots.mkdirs()); require(!Files.isSymbolicLink(roots.toPath())) }
    private val lock = Any()

    // The runner will pass the actual future core.identity() before registration;
    // never derive a durable engine namespace from a profile or transient epoch.
    fun openBoundedCapability(profileId: String, engineIdentity: String): FacetBoundedVault = synchronized(lock) {
        val root = root(profileId)
        require(attributes(root)?.isDirectory == true)
        val directory = File(recovery(root), "bounded/$engineIdentity")
        require(Regex("[0-9a-f]{64}").matches(engineIdentity))
        require(attributes(File(recovery(root), "bounded"))?.isSymbolicLink != true && attributes(directory)?.isSymbolicLink != true)
        FacetBoundedVault(directory, profileId, engineIdentity, { path -> checked(root, path) }, {
            require(attributes(root)?.isDirectory == true && attributes(root)?.isSymbolicLink == false)
        }, legacy = FacetLegacyBackups(recovery(root), File(directory, "legacy-acknowledgements"), profileId, engineIdentity, { path -> checked(root, path) }))
    }

    fun createReplica(profileId: String): File = synchronized(lock) {
        val root = root(profileId)
        check(attributes(root)?.isDirectory == true || root.mkdirs())
        root
    }

    fun adoptImported(profileId: String, source: File) = synchronized(lock) {
        val target = root(profileId)
        check(attributes(target) == null)
        require(attributes(source)?.isDirectory == true && attributes(source)?.isSymbolicLink == false)
        AtomicFiles.rename(source, target, exchange = false)
        syncDirectory(roots)
        syncDirectory(requireNotNull(source.parentFile))
    }

    fun list(profileId: String): List<String> = synchronized(lock) {
        val root = root(profileId)
        require(attributes(root)?.isDirectory == true)
        val result = mutableListOf<String>()
        fun visit(directory: File) {
            Files.newDirectoryStream(directory.toPath()).use { entries ->
                for (entry in entries) {
                    val file = entry.toFile()
                    if (directory == root && file.name == ".facet-recovery") continue
                    val info = requireNotNull(attributes(file)) { "A vault entry disappeared during indexing." }
                    require(!info.isSymbolicLink)
                    if (info.isDirectory) visit(file)
                    else { require(info.isRegularFile); result.add(file.relativeTo(root).invariantSeparatorsPath) }
                }
            }
        }
        visit(root)
        result.sorted()
    }

    fun read(profileId: String, path: String): ByteArray? = synchronized(lock) {
        val file = checked(root(profileId), path)
        readBytes(file)
    }

    fun directory(profileId: String, path: String, deleted: Boolean) = synchronized(lock) {
        val root = root(profileId)
        val target = checked(root, path)
        if (deleted) {
            if (attributes(target) != null) {
                require(attributes(target)?.isDirectory == true)
                Files.newDirectoryStream(target.toPath()).use { children ->
                    if (!children.iterator().hasNext()) { Files.delete(target.toPath()); syncDirectory(requireNotNull(target.parentFile)) }
                }
            }
        } else {
            check(attributes(target)?.isDirectory == true || target.mkdirs())
            syncDirectory(target); syncDirectory(requireNotNull(target.parentFile))
        }
    }

    fun exchange(profileId: String, path: String, expected: String?, replacement: ByteArray?): ExchangeResult = synchronized(lock) {
        val root = root(profileId)
        val target = checked(root, path)
        val existing = readBytes(target)
        if (existing?.let(::revision) != expected) return@synchronized ExchangeResult(false)
        if (existing == null && replacement == null) return@synchronized ExchangeResult(true)
        check(target.parentFile?.let { it.isDirectory || it.mkdirs() } == true)
        val recovery = recovery(root)
        val id = UUID.randomUUID().toString()
        val captured = File(recovery, "$id.bytes")
        val metadata = File(recovery, "$id.json")
        if (replacement != null) durableWrite(captured, replacement)
        val prepared = buildJsonObject {
            put("id", id); put("path", path)
            put("replacementRevision", replacement?.let { JsonPrimitive(revision(it)) } ?: JsonNull)
            put("expectedRevision", expected?.let(::JsonPrimitive) ?: JsonNull)
        }
        durableWrite(metadata, prepared.toString().toByteArray(Charsets.UTF_8))
        syncDirectory(recovery)
        if (existing != null) {
            if (replacement != null) AtomicFiles.rename(captured, target, exchange = true)
            else AtomicFiles.rename(target, captured, exchange = false)
            syncDirectory(recovery); syncDirectory(requireNotNull(target.parentFile))
            val bytes = requireNotNull(readBytes(captured))
            replaceMetadata(metadata, JsonObject(prepared + mapOf("capturedSize" to JsonPrimitive(bytes.size), "capturedRevision" to JsonPrimitive(revision(bytes)))))
            return@synchronized ExchangeResult(true, bytes, id)
        }
        try { AtomicFiles.rename(captured, target, exchange = false) }
        catch (failure: ErrnoException) {
            if (failure.errno != OsConstants.EEXIST) throw failure
            check(metadata.delete()); check(captured.delete())
            syncDirectory(recovery)
            return@synchronized ExchangeResult(false)
        }
        syncDirectory(requireNotNull(target.parentFile))
        check(metadata.delete()); syncDirectory(recovery)
        ExchangeResult(true)
    }

    fun displaced(profileId: String): List<CapturedVersion> = synchronized(lock) {
        displacedMetadata(profileId).map { CapturedVersion(it.id, it.path, readDisplaced(profileId, it.id)) }
    }

    fun displacedMetadata(profileId: String, afterId: String? = null, limit: Int = 128): List<CapturedMetadata> = synchronized(lock) {
        require(limit in 1..128)
        if (afterId != null) require(UUID.fromString(afterId).toString() == afterId.lowercase())
        val recovery = recovery(root(profileId))
        requireNotNull(recovery.listFiles()).asSequence().filter { it.extension == "json" }.sortedBy { it.name }.filter { afterId == null || it.nameWithoutExtension > afterId }.mapNotNull { file ->
            val metadata = Json.parseToJsonElement(requireNotNull(readBytes(file)).toString(Charsets.UTF_8)).jsonObject
            require(metadata.keys.all { it in setOf("id", "path", "expectedRevision", "replacementRevision", "capturedSize", "capturedRevision") })
            val id = metadata.getValue("id").jsonPrimitive.content
            require(UUID.fromString(id).toString() == id.lowercase())
            require(file.name == "$id.json")
            val path = metadata.getValue("path").jsonPrimitive.content
            checked(root(profileId), path)
            val captured = File(recovery, "$id.bytes")
            val version = fingerprint(captured)
            val capturedRevision = metadata["capturedRevision"]?.jsonPrimitive?.contentOrNull
            if (version == null) {
                // A missing legacy slot has no durable outcome or descriptor
                // proof. Current destination bytes cannot establish whether
                // the exchange occurred or its predecessor was acknowledged.
                throw LegacyRecoveryProofException()
            }
            if (capturedRevision == null && metadata["replacementRevision"]?.jsonPrimitive?.contentOrNull == version.second) {
                // Legacy records have no prepared-slot inode proof. Equal bytes
                // can be either an unexchanged replacement or a real displaced
                // predecessor; preserve both instead of deleting by hash.
                throw LegacyRecoveryProofException()
            }
            if (capturedRevision == null) {
                replaceMetadata(file, JsonObject(metadata + mapOf("capturedSize" to JsonPrimitive(version.first), "capturedRevision" to JsonPrimitive(version.second))))
            } else {
                check(capturedRevision == version.second && metadata.getValue("capturedSize").jsonPrimitive.long == version.first) { "The captured recovery file changed." }
            }
            CapturedMetadata(id, path, version.first.toULong(), version.second)
        }.take(limit).toList()
    }

    fun readDisplaced(profileId: String, id: String): ByteArray = synchronized(lock) {
        require(UUID.fromString(id).toString() == id.lowercase())
        val recovery = recovery(root(profileId))
        val metadata = Json.parseToJsonElement(requireNotNull(readBytes(File(recovery, "$id.json"))).toString(Charsets.UTF_8)).jsonObject
        require(metadata.getValue("id").jsonPrimitive.content == id)
        checked(root(profileId), metadata.getValue("path").jsonPrimitive.content)
        val bytes = requireNotNull(readBytes(File(recovery, "$id.bytes")))
        check(metadata.getValue("capturedSize").jsonPrimitive.long == bytes.size.toLong() && metadata.getValue("capturedRevision").jsonPrimitive.content == revision(bytes)) { "The captured recovery file changed." }
        bytes
    }

    fun acknowledge(profileId: String, id: String) = synchronized(lock) {
        require(UUID.fromString(id).toString() == id.lowercase())
        val directory = recovery(root(profileId))
        listOf(".bytes", ".json").forEach { suffix ->
            val file = File(directory, id + suffix)
            Files.deleteIfExists(file.toPath())
        }
        syncDirectory(directory)
    }

    private fun root(id: String): File {
        require(UUID.fromString(id).toString() == id.lowercase())
        return File(roots, id).also { check(attributes(it)?.isSymbolicLink != true) }
    }

    private fun checked(root: File, path: String): File {
        require(path.isNotEmpty() && '\\' !in path && '\u0000' !in path)
        require(path.substringBefore('/').lowercase() != ".facet-recovery")
        require(attributes(root)?.isDirectory == true) { "The vault root is unavailable." }
        var file = root
        path.split('/').forEach { component ->
            require(component.isNotEmpty() && component != "." && component != "..")
            file = File(file, component)
            require(attributes(file)?.isSymbolicLink != true)
        }
        check(file.canonicalPath.startsWith(root.canonicalPath + File.separator))
        return file
    }

    private fun recovery(root: File): File = File(root, ".facet-recovery").also {
        check(attributes(it)?.isSymbolicLink != true); check(attributes(it)?.isDirectory == true || it.mkdirs())
    }

    private fun attributes(file: File): BasicFileAttributes? = try {
        Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
    } catch (_: NoSuchFileException) { null }

    private fun readBytes(file: File): ByteArray? {
        val info = attributes(file) ?: return null
        require(info.isRegularFile && !info.isSymbolicLink)
        return Files.readAllBytes(file.toPath())
    }

    private fun durableWrite(file: File, bytes: ByteArray) {
        check(file.createNewFile())
        FileOutputStream(file).use { stream -> stream.write(bytes); stream.fd.sync() }
    }

    private fun replaceMetadata(file: File, metadata: JsonObject) {
        val temporary = File(requireNotNull(file.parentFile), UUID.randomUUID().toString() + ".temporary")
        durableWrite(temporary, metadata.toString().toByteArray(Charsets.UTF_8))
        AtomicFiles.rename(temporary, file, exchange = true)
        Files.delete(temporary.toPath())
        syncDirectory(requireNotNull(file.parentFile))
    }

    private fun fingerprint(file: File): Pair<Long, String>? {
        val info = attributes(file) ?: return null
        require(info.isRegularFile && !info.isSymbolicLink)
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        Files.newInputStream(file.toPath(), LinkOption.NOFOLLOW_LINKS).use { stream ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                size += count
                digest.update(buffer, 0, count)
            }
        }
        return size to digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun syncDirectory(directory: File) {
        AtomicFiles.synchronize(directory)
    }

    companion object {
        fun revision(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}

internal data class ExchangeResult(val applied: Boolean, val displacedBytes: ByteArray? = null, val displacedVersionId: String? = null)
internal data class CapturedVersion(val id: String, val path: String, val bytes: ByteArray)
internal data class CapturedMetadata(val id: String, val path: String, val size: ULong, val revision: String)
internal class LegacyRecoveryProofException : java.io.IOException("An older recovery record cannot prove whether its equal-content predecessor was exchanged. Preserve the private record and captured file for explicit recovery.")
