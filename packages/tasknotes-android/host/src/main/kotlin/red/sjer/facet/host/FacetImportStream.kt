package red.sjer.facet.host

import java.io.InputStream
import java.io.OutputStream
import java.io.IOException
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

internal object FacetImportStream {
    suspend fun copy(source: InputStream, destination: OutputStream): Long {
        val buffer = ByteArray(64 * 1024)
        var copied = 0L
        var emptyReads = 0
        while (true) {
            coroutineContext.ensureActive()
            val count = source.read(buffer)
            if (count < 0) return copied
            if (count == 0) {
                if (++emptyReads > 16) throw IOException("The provider stream did not advance.")
                continue
            }
            emptyReads = 0
            destination.write(buffer, 0, count)
            copied = Math.addExact(copied, count.toLong())
        }
    }
}
