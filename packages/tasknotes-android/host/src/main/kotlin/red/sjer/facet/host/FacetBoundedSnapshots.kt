package red.sjer.facet.host

import android.system.ErrnoException
import android.system.OsConstants
import android.system.Os
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.Files
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** ABI-independent read images; the capability adapter supplies validated source paths. */
internal class FacetBoundedSnapshots(
    private val directory: File,
    private val profile: String,
    private val io: SnapshotFiles = NativeSnapshotFiles,
) : Closeable {
    private val epochKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
    private val active = mutableMapOf<String, Image>()
    private var closed = false

    init {
        require(profile.isNotBlank())
        Files.createDirectories(directory.toPath())
        require(!Files.isSymbolicLink(directory.toPath())) { "Read images cannot use a linked directory." }
    }

    @Synchronized
    fun capture(owner: String, source: File, expectedSize: ULong? = null, expectedRevision: String? = null): BoundedSnapshot? {
        requireOwner(owner)
        if (io.identity(source) == null) return null
        check(active.size < 4) { "Close a read image before opening another snapshot." }
        repeat(2) { attempt ->
            val nonce = ByteArray(16).also { SecureRandom().nextBytes(it) }.hex()
            val id = "snapshot:$nonce:${signature(nonce)}"
            val target = File(directory, "$nonce.read-image")
            var retained = false
            try {
                val copied = io.capture(source, target)
                val stamp = io.identity(target) ?: error("The private captured read image is missing.")
                check(stamp.size == copied.size) { "The captured read image has an inconsistent size." }
                val descriptor = io.open(target)
                try {
                    check(io.descriptorIdentity(descriptor) == stamp) { "The opened read descriptor differs from the immutable image." }
                    val digest = MessageDigest.getInstance("SHA-256")
                    val buffer = ByteArray(65_536)
                    while (true) {
                        val count = descriptor.read(buffer)
                        if (count < 0) break
                        digest.update(buffer, 0, count)
                    }
                    buffer.fill(0)
                    val revision = digest.digest().hex()
                    check(io.descriptorIdentity(descriptor) == stamp && io.identity(target) == stamp) { "The captured read image changed while hashing." }
                    check(expectedSize == null || expectedSize == stamp.size.toULong()) { "The retained predecessor size changed." }
                    check(expectedRevision == null || expectedRevision == revision) { "The retained predecessor revision changed." }
                    val metadata = BoundedSnapshot(id, stamp.size.toULong(), revision)
                    active[id] = Image(target, descriptor, stamp, metadata)
                    retained = true
                    return metadata
                } catch (failure: Throwable) {
                    descriptor.close()
                    throw failure
                }
            } catch (failure: UnstableSnapshotException) {
                if (attempt == 1) throw failure
            } finally {
                if (!retained) Files.deleteIfExists(target.toPath())
            }
        }
        error("A bounded snapshot attempt ended without a result.")
    }

    @Synchronized
    fun read(owner: String, id: String, offset: ULong, length: UInt): ByteArray {
        requireOwner(owner)
        validateId(id)
        val image = active[id] ?: error("The read snapshot is closed or unknown.")
        require(length <= 1_048_576u && offset <= image.metadata.size && length.toULong() <= image.metadata.size - offset) { "The requested chunk is outside the exact read image." }
        check(io.descriptorIdentity(image.descriptor) == image.stamp && io.identity(image.path) == image.stamp) { "The private snapshot changed identity or metadata." }
        val bytes = ByteArray(length.toInt())
        image.descriptor.seek(offset.toLong())
        image.descriptor.readFully(bytes)
        check(io.descriptorIdentity(image.descriptor) == image.stamp && io.identity(image.path) == image.stamp) { "The private snapshot changed during a chunk read." }
        return bytes
    }

    @Synchronized
    fun closeSnapshot(owner: String, id: String) {
        requireOwner(owner)
        validateId(id)
        val image = active[id] ?: return // Signed owner/lifetime proof; no historical closed-ID set.
        image.descriptor.close()
        Files.deleteIfExists(image.path.toPath())
        active.remove(id)
    }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        var failure: Throwable? = null
        active.values.forEach { image ->
            try { image.descriptor.close() } catch (problem: Throwable) { if (failure == null) failure = problem else failure.addSuppressed(problem) }
            try { Files.deleteIfExists(image.path.toPath()) } catch (problem: Throwable) { if (failure == null) failure = problem else failure.addSuppressed(problem) }
        }
        active.clear()
        epochKey.fill(0)
        failure?.let { throw it }
    }

    private fun requireOwner(owner: String) {
        check(!closed) { "The read snapshot owner has closed." }
        require(owner == profile) { "The read snapshot belongs to another vault." }
        check(!Files.isSymbolicLink(directory.toPath())) { "The private read directory changed." }
    }

    private fun validateId(id: String) {
        val fields = id.split(':')
        require(fields.size == 3 && fields[0] == "snapshot" && fields[1].length == 32 && fields[1].all { it in '0'..'9' || it in 'a'..'f' } && fields[2].length == 64) { "The read handle is invalid." }
        require(MessageDigest.isEqual(fields[2].toByteArray(Charsets.US_ASCII), signature(fields[1]).toByteArray(Charsets.US_ASCII))) { "The read handle belongs to another owner or engine lifetime." }
    }

    private fun signature(nonce: String): String = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(epochKey, "HmacSHA256"))
        doFinal("$profile\u0000$nonce".toByteArray(Charsets.UTF_8)).hex()
    }

    private data class Image(val path: File, val descriptor: RandomAccessFile, val stamp: FacetFileStamp, val metadata: BoundedSnapshot)
}

internal data class BoundedSnapshot(val id: String, val size: ULong, val revision: String)
internal class UnstableSnapshotException : IOException("The source changed during both bounded snapshot attempts; retry after the writer finishes.")
internal interface SnapshotFiles {
    fun identity(file: File): FacetFileStamp?
    fun capture(source: File, destination: File): FacetFileStamp
    fun open(file: File): RandomAccessFile
    fun descriptorIdentity(file: RandomAccessFile): FacetFileStamp
}

internal object NativeSnapshotFiles : SnapshotFiles {
    override fun open(file: File) = RandomAccessFile(file, "r")

    override fun descriptorIdentity(file: RandomAccessFile): FacetFileStamp {
        // Public API21 fstat + API27 nanosecond fields support the existing min29.
        // This checks the retained descriptor, not a subsequently substituted path.
        val value = Os.fstat(file.fd)
        check(OsConstants.S_ISREG(value.st_mode) && value.st_size >= 0) { "The read descriptor is not a regular file." }
        return FacetFileStamp(value.st_dev, value.st_ino, value.st_size, value.st_mtim.tv_sec, value.st_mtim.tv_nsec)
    }
    override fun identity(file: File): FacetFileStamp? = try {
        AtomicFiles.identity(file)
    } catch (failure: ErrnoException) {
        if (failure.errno == OsConstants.ENOENT) null else throw failure
    }

    override fun capture(source: File, destination: File): FacetFileStamp = try {
        AtomicFiles.capture(source, destination)
    } catch (failure: ErrnoException) {
        if (failure.errno == OsConstants.EAGAIN) throw UnstableSnapshotException().also { it.initCause(failure) }
        throw failure
    }
}

private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }
