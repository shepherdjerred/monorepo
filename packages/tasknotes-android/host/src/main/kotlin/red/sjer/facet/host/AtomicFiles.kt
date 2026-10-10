package red.sjer.facet.host

import android.system.ErrnoException
import java.io.File

internal object AtomicFiles {
    init { System.loadLibrary("facet_files") }
    private external fun renameNative(source: ByteArray, destination: ByteArray, flags: Int): Int
    private external fun synchronizeNative(directory: ByteArray): Int
    private external fun identityNative(path: ByteArray): LongArray
    private external fun captureNative(source: ByteArray, destination: ByteArray): LongArray

    fun identity(file: File): FacetFileStamp = stamp(identityNative(file.absolutePath.toByteArray(Charsets.UTF_8)), "vault_file_identity")

    fun capture(source: File, destination: File): FacetFileStamp = stamp(captureNative(source.absolutePath.toByteArray(Charsets.UTF_8), destination.absolutePath.toByteArray(Charsets.UTF_8)), "vault_snapshot_capture")

    private fun stamp(values: LongArray, operation: String): FacetFileStamp {
        check(values.size == 7) { "Native file metadata has an invalid shape." }
        if (values[0] != 0L) throw ErrnoException(operation, values[0].toInt())
        check(values[3] >= 0 && values[5] in 0..999_999_999 && values[6] and 0xf000 == 0x8000L) { "Native file metadata is not a regular file." }
        return FacetFileStamp(values[1], values[2], values[3], values[4], values[5])
    }

    fun rename(source: File, destination: File, exchange: Boolean) {
        // RENAME_EXCHANGE=2, RENAME_NOREPLACE=1 are Linux UAPI flags.
        val errno = renameNative(source.absolutePath.toByteArray(Charsets.UTF_8), destination.absolutePath.toByteArray(Charsets.UTF_8), if (exchange) 2 else 1)
        if (errno != 0) throw ErrnoException("vault_atomic_rename", errno)
    }

    fun synchronize(directory: File) {
        val errno = synchronizeNative(directory.absolutePath.toByteArray(Charsets.UTF_8))
        if (errno != 0) throw ErrnoException("vault_directory_sync", errno)
    }
}

internal data class FacetFileStamp(val device: Long, val inode: Long, val size: Long, val modifiedSeconds: Long, val modifiedNanos: Long) {
    val identity: String get() = "${device.toULong()}:${inode.toULong()}"
}
