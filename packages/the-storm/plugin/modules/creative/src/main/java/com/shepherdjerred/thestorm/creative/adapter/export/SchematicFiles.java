package com.shepherdjerred.thestorm.creative.adapter.export;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.concurrent.CompletableFuture;

/**
 * One plot schematic under the plugin data folder. The write runs on the database writer thread so
 * the main thread only builds the bytes.
 */
public final class SchematicFiles {

  private final StormDatabase database;
  private final File directory;

  public SchematicFiles(StormDatabase database, File directory) {
    this.database = database;
    this.directory = directory;
  }

  public CompletableFuture<Void> write(String name, byte[] bytes) {
    return done(
        database.write(
            dsl -> {
              writeFile(name, bytes);
              return dsl.dialect();
            }));
  }

  private void writeFile(String name, byte[] bytes) {
    if (!directory.isDirectory() && !directory.mkdirs()) {
      throw new IllegalStateException("creative schematic directory was not created");
    }
    var target = new File(directory, name);
    try (var stream = new FileOutputStream(target)) {
      stream.write(bytes);
    } catch (IOException failure) {
      throw new UncheckedIOException("creative schematic " + name + " was not written", failure);
    }
  }

  private static CompletableFuture<Void> done(CompletableFuture<?> write) {
    return write.thenAccept(result -> {});
  }
}
