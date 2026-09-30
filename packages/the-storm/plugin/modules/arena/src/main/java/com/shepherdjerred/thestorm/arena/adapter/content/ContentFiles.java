package com.shepherdjerred.thestorm.arena.adapter.content;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaBundle;
import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.config.ArenaSettings;
import com.shepherdjerred.thestorm.arena.domain.kit.ClassBook;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveFile;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.result.Result;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Loads the arena's files from {@code plugins/TheStorm}: {@code arena.yml}, {@code
 * arena/classes.yml}, {@code arena/waves.yml} and every {@code arena/arenas/<id>.yml}. Any missing
 * or invalid file stops the module, listing what is wrong.
 */
public final class ContentFiles {

  static final String SETTINGS = "arena.yml";
  static final String CLASSES = "arena/classes.yml";
  static final String WAVES = "arena/waves.yml";
  static final String ARENAS = "arena/arenas";

  private ContentFiles() {}

  /** Loads and cross-checks everything under {@code directory}. */
  public static ArenaBundle load(Path directory) {
    var settings = ConfigFiles.load(directory.resolve(SETTINGS), ArenaSettings.class);
    var classes = ConfigFiles.load(directory.resolve(CLASSES), ClassBook.class);
    var waves = table(directory.resolve(WAVES));
    var arenas = arenas(directory.resolve(ARENAS));
    try {
      return new ArenaBundle(settings, classes, waves, arenas);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("Arena content does not agree: " + e.getMessage(), e);
    }
  }

  private static WaveTable table(Path file) {
    var raw = ConfigFiles.load(file, WaveFile.class);
    return switch (WaveTable.of(raw)) {
      case Result.Ok<WaveTable, List<String>>(var table) -> table;
      case Result.Err<WaveTable, List<String>>(var problems) ->
          throw new IllegalStateException("Invalid " + file + ":\n" + String.join("\n", problems));
    };
  }

  private static List<ArenaDefinition> arenas(Path folder) {
    List<Path> files;
    try (var listing = Files.list(folder)) {
      files =
          listing.filter(path -> path.getFileName().toString().endsWith(".yml")).sorted().toList();
    } catch (IOException e) {
      throw new UncheckedIOException("Required folder " + folder + " could not be read", e);
    }
    if (files.isEmpty()) {
      throw new IllegalStateException(folder + " has no arenas; add at least one <id>.yml");
    }
    var arenas = new ArrayList<ArenaDefinition>();
    for (var file : files) {
      var arena = ConfigFiles.load(file, ArenaDefinition.class);
      var expected = arena.id() + ".yml";
      if (!file.getFileName().toString().equals(expected)) {
        throw new IllegalStateException(
            file + " defines arena " + arena.id() + "; name it " + expected);
      }
      arenas.add(arena);
    }
    return List.copyOf(arenas);
  }
}
