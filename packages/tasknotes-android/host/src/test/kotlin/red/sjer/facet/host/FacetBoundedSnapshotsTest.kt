package red.sjer.facet.host

import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.BasicFileAttributes
import org.junit.Assert.*
import org.junit.Test

/** Physical JVM read images; the injected copier is not Android JNI/runtime evidence. */
class FacetBoundedSnapshotsTest {
    private val owner = "source-vault"
    private fun temporary(block: (File) -> Unit) {
        val directory = Files.createTempDirectory("facet-bounded-snapshot-").toFile()
        try { block(directory) } finally { directory.deleteRecursively() }
    }
    private class JvmFiles(private val substitute: File? = null, private val changed: ((Int) -> Boolean)? = null) : SnapshotFiles {
        var copies = 0
        private val descriptors = java.util.IdentityHashMap<RandomAccessFile, File>()
        override fun open(file: File): RandomAccessFile {
            val actual = substitute ?: file
            return RandomAccessFile(actual, "r").also { descriptors[it] = actual }
        }
        override fun descriptorIdentity(file: RandomAccessFile) = identity(descriptors.getValue(file))!!
        override fun identity(file: File): FacetFileStamp? {
            if (!Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return null
            val value = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            check(value.isRegularFile)
            return FacetFileStamp(0, value.fileKey().hashCode().toLong(), value.size(), value.lastModifiedTime().toMillis() / 1000, value.lastModifiedTime().toMillis() % 1000 * 1_000_000)
        }
        override fun capture(source: File, destination: File): FacetFileStamp {
            val before = identity(source)!!
            source.inputStream().use { input -> destination.outputStream().use { output -> input.copyTo(output, 65_536) } }
            copies++
            if (changed?.invoke(copies) == true) throw UnstableSnapshotException()
            return before
        }
    }

    @Test fun immutableChunksExactRangesAndSignedClosedHandles() = temporary { directory ->
        val source = File(directory, "file.bin").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }
        val private = File(directory, "images")
        FacetBoundedSnapshots(private, owner, JvmFiles()).use { snapshots ->
            val image = snapshots.capture(owner, source)!!
            source.writeBytes(byteArrayOf(9))
            assertArrayEquals(byteArrayOf(2, 3), snapshots.read(owner, image.id, 1uL, 2u))
            assertArrayEquals(byteArrayOf(), snapshots.read(owner, image.id, 4uL, 0u))
            assertThrows(IllegalArgumentException::class.java) { snapshots.read(owner, image.id, 4uL, 1u) }
            assertThrows(IllegalArgumentException::class.java) { snapshots.read(owner, image.id, 0uL, 1_048_577u) }
            assertThrows(IllegalArgumentException::class.java) { snapshots.read("another-vault", image.id, 0uL, 1u) }
            assertThrows(IllegalArgumentException::class.java) { snapshots.closeSnapshot(owner, "snapshot:" + "0".repeat(32) + ":" + "0".repeat(64)) }
            FacetBoundedSnapshots(private, owner, JvmFiles()).use { reopened ->
                assertThrows(IllegalArgumentException::class.java) { reopened.closeSnapshot(owner, image.id) }
            }
            snapshots.closeSnapshot(owner, image.id); snapshots.closeSnapshot(owner, image.id)
            assertThrows(IllegalStateException::class.java) { snapshots.read(owner, image.id, 0uL, 1u) }
            assertEquals(0, private.listFiles()!!.size)
        }
    }

    @Test fun fourImagesAreBoundedAndCloseReleasesCapacityAndPrivateFiles() = temporary { directory ->
        val source = File(directory, "file.bin").apply { writeBytes(byteArrayOf(1)) }
        val private = File(directory, "images")
        val snapshots = FacetBoundedSnapshots(private, owner, JvmFiles())
        val images = (1..4).map { snapshots.capture(owner, source)!! }
        assertThrows(IllegalStateException::class.java) { snapshots.capture(owner, source) }
        assertNull(snapshots.capture(owner, File(directory, "absent.bin")))
        snapshots.closeSnapshot(owner, images.first().id)
        assertNotNull(snapshots.capture(owner, source))
        snapshots.close(); snapshots.close()
        assertEquals(0, private.listFiles()!!.size)
        assertThrows(IllegalStateException::class.java) { snapshots.capture(owner, source) }
    }

    @Test fun sourceChangeRetriesExactlyTwiceAndLeavesNoImages() = temporary { directory ->
        val source = File(directory, "file.bin").apply { writeBytes(byteArrayOf(1)) }
        val private = File(directory, "images")
        val io = JvmFiles { true }
        FacetBoundedSnapshots(private, owner, io).use { snapshots ->
            assertThrows(UnstableSnapshotException::class.java) { snapshots.capture(owner, source) }
            assertEquals(2, io.copies)
            assertEquals(0, private.listFiles()!!.size)
        }
        val settles = JvmFiles { it == 1 }
        FacetBoundedSnapshots(private, owner, settles).use { snapshots ->
            assertNotNull(snapshots.capture(owner, source))
            assertEquals(2, settles.copies)
        }
    }

    @Test fun retainedHashSizeAndPrivateImageMutationRejectWithoutReleasingSource() = temporary { directory ->
        val source = File(directory, "displaced.bin").apply { writeBytes(byteArrayOf(1, 2)) }
        val private = File(directory, "images")
        FacetBoundedSnapshots(private, owner, JvmFiles()).use { snapshots ->
            assertThrows(IllegalStateException::class.java) { snapshots.capture(owner, source, expectedSize = 1uL) }
            assertThrows(IllegalStateException::class.java) { snapshots.capture(owner, source, expectedRevision = "0".repeat(64)) }
            assertEquals(0, private.listFiles()!!.size)
            val image = snapshots.capture(owner, source)!!
            private.listFiles()!!.single().writeBytes(byteArrayOf(7))
            assertThrows(IllegalStateException::class.java) { snapshots.read(owner, image.id, 0uL, 1u) }
            snapshots.closeSnapshot(owner, image.id)
            assertArrayEquals(byteArrayOf(1, 2), source.readBytes())
        }
    }

    @Test fun sameSizeImageSubstitutionAtDescriptorOpenIsRejected() = temporary { directory ->
        val source = File(directory, "source.bin").apply { writeBytes(byteArrayOf(1, 2)) }
        val foreign = File(directory, "another-inode.bin").apply { writeBytes(byteArrayOf(1, 2)) }
        val private = File(directory, "images")
        FacetBoundedSnapshots(private, owner, JvmFiles(substitute = foreign)).use { snapshots ->
            assertThrows(IllegalStateException::class.java) { snapshots.capture(owner, source) }
            assertEquals(0, private.listFiles()!!.size)
            assertArrayEquals(byteArrayOf(1, 2), foreign.readBytes())
        }
    }
}
