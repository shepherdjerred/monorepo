package com.shepherdjerred.thestorm.core.snapshot;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;

/**
 * Where the server keeps each player's saved data file. Paper 26.x writes {@code
 * <level>/players/data/<uuid>.dat} (the same directory its {@code PlayerDataStorage} resolves from
 * the level storage); older layouts used {@code <level>/playerdata/<uuid>.dat}.
 *
 * @param directory the folder holding the {@code <uuid>.dat} files
 */
public record PlayerDataFiles(Path directory) {

  /** The 26.x player-data folder, relative to the level directory. */
  static final Path CURRENT = Path.of("players", "data");

  /** The pre-26 player-data folder, relative to the level directory. */
  static final Path LEGACY = Path.of("playerdata");

  /**
   * The player-data folder under {@code level}, the server's level directory ({@code
   * Server#getLevelDirectory()}), preferring the 26.x layout; empty if the level has neither
   * folder. Paper creates {@code players/data} as it starts, before a fresh world has written its
   * {@code level.dat}, so only the folder is looked for.
   */
  public static Optional<PlayerDataFiles> locate(Path level) {
    for (var candidate : new Path[] {CURRENT, LEGACY}) {
      var directory = level.resolve(candidate);
      if (Files.isDirectory(directory)) {
        return Optional.of(new PlayerDataFiles(directory));
      }
    }
    return Optional.empty();
  }

  /** The saved data file of {@code player}. */
  public Path of(UUID player) {
    return directory.resolve(player + ".dat");
  }
}
