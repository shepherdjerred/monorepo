package red.sjer.facet.host

import java.io.InputStream
import java.io.OutputStream
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class FacetImportStreamTest {
    @Test fun largeAttachmentCopyKeepsOneBoundedBuffer() = runBlocking {
        val total = 199L * 1024 * 1024
        var read = 0L
        var written = 0L
        var largest = 0
        val source = object : InputStream() {
            override fun read(): Int = error("The importer must read bounded chunks.")
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                largest = maxOf(largest, buffer.size)
                if (read == total) return -1
                val count = minOf(length.toLong(), total - read).toInt()
                read += count
                return count
            }
        }
        val destination = object : OutputStream() {
            override fun write(value: Int) = error("The importer must write chunks.")
            override fun write(buffer: ByteArray, offset: Int, length: Int) { written += length }
        }
        assertEquals(total, FacetImportStream.copy(source, destination))
        assertEquals(total, written)
        assertTrue(largest <= 64 * 1024)
    }

    @Test fun aNonAdvancingProviderFailsInsteadOfSpinning() {
        val source = object : InputStream() {
            override fun read() = 0
            override fun read(buffer: ByteArray, offset: Int, length: Int) = 0
        }
        assertThrows(IOException::class.java) {
            runBlocking { FacetImportStream.copy(source, OutputStream.nullOutputStream()) }
        }
    }
}
