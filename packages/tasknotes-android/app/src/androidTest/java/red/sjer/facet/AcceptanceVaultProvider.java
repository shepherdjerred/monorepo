package red.sjer.facet;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Objects;
import java.util.UUID;

/** Standalone instrumentation-APK bootstrap uses Android/Java only: target-APK Kotlin dependencies are deduplicated by AGP. */
public final class AcceptanceVaultProvider extends ContentProvider {
    public static final String AUTHORITY = "red.sjer.facet.test.synthetic-vault";
    @Override public boolean onCreate() { return true; }
    private static void require(boolean value) { if (!value) throw new IllegalArgumentException("Invalid owned synthetic document request"); }
    private static File canonical(File file) {
        try { return file.getCanonicalFile(); }
        catch (IOException failure) { throw new IllegalStateException("Synthetic document path could not be resolved", failure); }
    }
    private File root(String id) {
        require(UUID.fromString(id).toString().equals(id));
        return canonical(new File(Objects.requireNonNull(getContext()).getFilesDir(), "synthetic-vaults/" + id));
    }
    @Override public Bundle call(String method, String arg, Bundle extras) {
        require("prepare".equals(method));
        String id = Objects.requireNonNull(arg);
        File root = root(id);
        require(!root.exists() && root.mkdirs());
        Bundle files = Objects.requireNonNull(Objects.requireNonNull(extras).getBundle("files"));
        for (String path : files.keySet()) {
            require(!path.isEmpty() && !path.startsWith("/"));
            for (String part : path.split("/")) require(!part.equals(".") && !part.equals(".."));
            File target = canonical(new File(root, path));
            require(target.getPath().startsWith(root.getPath() + File.separator));
            File parent = Objects.requireNonNull(target.getParentFile());
            require(parent.isDirectory() || parent.mkdirs());
            try (FileOutputStream output = new FileOutputStream(target)) {
                output.write(Objects.requireNonNull(files.getString(path)).getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
            } catch (IOException failure) { throw new IllegalStateException("Synthetic document preparation failed", failure); }
        }
        Bundle result = new Bundle();
        result.putString("tree", DocumentsContract.buildTreeDocumentUri(AUTHORITY, id + "|").toString());
        return result;
    }
    private static final class Owned {
        final String id; final File root; final File file;
        Owned(String id, File root, File file) { this.id = id; this.root = root; this.file = file; }
    }
    private Owned owned(Uri uri) {
        require(AUTHORITY.equals(uri.getAuthority()));
        String[] parts = DocumentsContract.getDocumentId(uri).split("\\|", 2);
        require(parts.length == 2);
        File root = root(parts[0]);
        File file = canonical(new File(root, parts[1]));
        require(root.isDirectory() && (file.equals(root) || file.getPath().startsWith(root.getPath() + File.separator)));
        return new Owned(parts[0], root, file);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        require(selection == null && selectionArgs == null);
        Owned owned = owned(uri);
        String[] columns = projection != null ? projection : new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        MatrixCursor cursor = new MatrixCursor(columns);
        File[] files = "children".equals(uri.getLastPathSegment()) ? Objects.requireNonNull(owned.file.listFiles()) : new File[] { owned.file };
        Arrays.sort(files, Comparator.comparing(File::getName));
        for (File file : files) {
            require(file.isFile() || file.isDirectory());
            String path = file.equals(owned.root) ? "" : owned.root.toPath().relativize(file.toPath()).toString().replace(File.separatorChar, '/');
            Object[] row = new Object[columns.length];
            for (int index = 0; index < columns.length; index++) {
                String column = columns[index];
                if (column.equals(DocumentsContract.Document.COLUMN_DOCUMENT_ID)) row[index] = owned.id + "|" + path;
                else if (column.equals(DocumentsContract.Document.COLUMN_DISPLAY_NAME)) row[index] = file.getName();
                else if (column.equals(DocumentsContract.Document.COLUMN_MIME_TYPE)) row[index] = file.isDirectory() ? DocumentsContract.Document.MIME_TYPE_DIR : "application/octet-stream";
                else if (column.equals(DocumentsContract.Document.COLUMN_SIZE)) row[index] = file.isFile() ? file.length() : null;
                else if (column.equals(DocumentsContract.Document.COLUMN_LAST_MODIFIED)) row[index] = file.lastModified();
                else throw new IllegalArgumentException("Unsupported synthetic document projection: " + column);
            }
            cursor.addRow(row);
        }
        return cursor;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        require("r".equals(mode));
        File file = owned(uri).file; require(file.isFile());
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode, CancellationSignal signal) throws FileNotFoundException {
        if (signal != null) signal.throwIfCanceled();
        return openFile(uri, mode);
    }
    @Override public String getType(Uri uri) { return owned(uri).file.isDirectory() ? DocumentsContract.Document.MIME_TYPE_DIR : "application/octet-stream"; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Synthetic trees are read-only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Synthetic trees are read-only"); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Synthetic trees are read-only"); }
}
