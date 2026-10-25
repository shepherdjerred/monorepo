package com.shepherdjerred.thestorm.creative.adapter.export;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
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

  /** Names saved for {@code player}, without the {@code .schem} suffix. */
  public CompletableFuture<List<String>> list(UUID player) {
    return database.read(dsl -> names(player));
  }

  /** The bytes of one personal schematic, or empty when that file is absent. */
  public CompletableFuture<Optional<byte[]>> read(String name) {
    return database.read(dsl -> readFile(name));
  }

  private List<String> names(UUID player) {
    var folder = file(player.toString());
    var found = folder.listFiles((dir, name) -> name.endsWith(".schem") && !name.contains(".."));
    if (found == null || found.length == 0) {
      return List.of();
    }
    var names = new ArrayList<String>();
    for (var schematic : found) {
      var name = schematic.getName();
      names.add(name.substring(0, name.length() - ".schem".length()));
    }
    names.sort(String::compareTo);
    return List.copyOf(names);
  }

  private Optional<byte[]> readFile(String name) {
    var target = file(name);
    if (!target.isFile()) {
      return Optional.empty();
    }
    try (var stream = new FileInputStream(target)) {
      return Optional.of(stream.readAllBytes());
    } catch (IOException failure) {
      throw new UncheckedIOException("creative schematic " + name + " was not read", failure);
    }
  }

  private void writeFile(String name, byte[] bytes) {
    var target = file(name);
    var parent = target.getParentFile();
    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
      throw new IllegalStateException("creative schematic directory was not created");
    }
    try (var stream = new FileOutputStream(target)) {
      stream.write(bytes);
    } catch (IOException failure) {
      throw new UncheckedIOException("creative schematic " + name + " was not written", failure);
    }
  }

  private File file(String name) {
    if (name.isBlank() || name.contains("..") || name.startsWith("/") || name.indexOf('\\') >= 0) {
      throw new IllegalArgumentException("creative schematic name is not safe");
    }
    try {
      var root = directory.getCanonicalFile().toPath();
      var target = new File(directory, name).getCanonicalFile();
      if (!target.toPath().startsWith(root)) {
        throw new IllegalArgumentException("creative schematic name is not safe");
      }
      return target;
    } catch (IOException failure) {
      throw new UncheckedIOException("creative schematic " + name + " was not resolved", failure);
    }
  }

  private static CompletableFuture<Void> done(CompletableFuture<?> write) {
    return write.thenAccept(result -> {});
  }
}
