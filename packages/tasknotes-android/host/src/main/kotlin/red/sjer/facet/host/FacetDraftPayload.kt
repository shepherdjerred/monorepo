package red.sjer.facet.host

import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel

/** The held descriptor is never reopened by path during staging. Native seal verifies the declared full digest. */
internal class DraftPayload(private val channel: SeekableByteChannel, val size: ULong, val revision: String) : Closeable {
    fun read(offset: ULong, length: Int): ByteArray {
        require(length in 0..1_048_576 && offset <= size && length.toULong() <= size - offset)
        require(channel.size().toULong() == size) { "The saved replacement length changed." }
        channel.position(offset.toLong())
        val result = ByteArray(length)
        val buffer = ByteBuffer.wrap(result)
        while (buffer.hasRemaining()) check(channel.read(buffer) > 0) { "The saved replacement was truncated." }
        require(channel.size().toULong() == size) { "The saved replacement length changed." }
        return result
    }
    override fun close() = channel.close()
}
