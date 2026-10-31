package red.sjer.facet.host

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/** Read-only provider access creates an independent private copy, never a SAF writer. */
internal class FacetFolderImport(private val context: Context) {
    internal data class Copy(val id: String, val directory: File, val files: Int, val bytes: Long)
    private data class Document(val id: String, val name: String, val mime: String, val size: Long?, val modified: Long?)
    private val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)

    suspend fun copy(tree: Uri): Copy {
        if (!DocumentsContract.isTreeUri(tree)) throw FolderImportException(FolderImportException.Reason.UNSUPPORTED)
        val id = UUID.randomUUID().toString()
        val imports = File(context.noBackupFilesDir, "import-staging")
        check(imports.isDirectory || imports.mkdirs())
        val stage = File(imports, id)
        check(stage.mkdir())
        val visited = mutableSetOf<String>()
        var files = 0
        var bytes = 0L
        suspend fun visit(parentId: String, destination: File, depth: Int) {
            coroutineContext.ensureActive()
            if (depth > 64 || !visited.add(parentId)) throw FolderImportException(FolderImportException.Reason.UNSUPPORTED)
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
            val cursor = context.contentResolver.query(children, projection, null, null, null)
                ?: throw FolderImportException(FolderImportException.Reason.PROVIDER)
            cursor.use {
                while (it.moveToNext()) {
                    coroutineContext.ensureActive()
                    val document = document(it)
                    validateName(document.name)
                    val target = File(destination, document.name)
                    if (document.mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                        check(target.mkdir())
                        visit(document.id, target, depth + 1)
                    } else {
                        if (!visited.add(document.id)) throw FolderImportException(FolderImportException.Reason.UNSUPPORTED)
                        val copied = copyFile(tree, document, target)
                        bytes = Math.addExact(bytes, copied)
                        files = Math.addExact(files, 1)
                    }
                }
            }
            AtomicFiles.synchronize(destination)
        }
        try { visit(DocumentsContract.getTreeDocumentId(tree), stage, 0) }
        catch (_: SecurityException) { throw FolderImportException(FolderImportException.Reason.PERMISSION) }
        catch (_: IOException) { throw FolderImportException(FolderImportException.Reason.PROVIDER) }
        AtomicFiles.synchronize(imports)
        return Copy(id, stage, files, bytes)
    }

    private suspend fun copyFile(tree: Uri, before: Document, target: File): Long {
        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, before.id)
        val input = context.contentResolver.openInputStream(uri)
            ?: throw FolderImportException(FolderImportException.Reason.PROVIDER)
        var copied = 0L
        input.use { source ->
            val descriptor = Os.open(target.absolutePath,
                OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_NOFOLLOW or OsConstants.O_CLOEXEC, 0x180)
            FileOutputStream(descriptor).use { output ->
                copied = FacetImportStream.copy(source, output)
                output.fd.sync()
            }
        }
        val cursor = context.contentResolver.query(uri, projection, null, null, null)
            ?: throw FolderImportException(FolderImportException.Reason.PROVIDER)
        val after = cursor.use {
            if (!it.moveToFirst()) throw FolderImportException(FolderImportException.Reason.CHANGED)
            document(it)
        }
        if (before.id != after.id || before.name != after.name || before.mime != after.mime ||
            before.size?.let { it != copied } == true || after.size?.let { it != copied } == true ||
            (before.modified != null && after.modified != null && before.modified != after.modified)) {
            throw FolderImportException(FolderImportException.Reason.CHANGED)
        }
        return copied
    }

    private fun document(cursor: android.database.Cursor): Document {
        fun text(column: String): String = cursor.getString(cursor.getColumnIndexOrThrow(column))
            ?: throw FolderImportException(FolderImportException.Reason.UNSUPPORTED)
        fun optional(column: String): Long? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getLong(index).takeIf { it >= 0 }
        }
        return Document(text(projection[0]), text(projection[1]), text(projection[2]), optional(projection[3]),
            optional(projection[4])?.takeIf { it > 0 })
    }

    private fun validateName(name: String) {
        if (name.isEmpty() || name == "." || name == ".." || name.lowercase() == ".facet-recovery" ||
            name.any { it == '/' || it == '\\' || it.isISOControl() }) {
            throw FolderImportException(FolderImportException.Reason.UNSUPPORTED)
        }
    }
}

class FolderImportException(val reason: Reason) : Exception(when (reason) {
    Reason.PERMISSION -> "The selected folder cannot be read. Choose it again to grant access."
    Reason.PROVIDER -> "The folder provider could not finish copying the vault. Check its connection and available storage."
    Reason.CHANGED -> "A vault file changed during copying. Retry after the other app finishes saving."
    Reason.UNSUPPORTED -> "This folder provider exposes an unsupported document or path. Choose another vault folder."
}) {
    enum class Reason { PERMISSION, PROVIDER, CHANGED, UNSUPPORTED }
}

data class ImportSnapshotResult(val profile: VaultProfile, val filesCopied: Int, val bytesCopied: Long)
