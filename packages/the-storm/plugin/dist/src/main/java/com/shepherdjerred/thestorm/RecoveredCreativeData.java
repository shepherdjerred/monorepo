package com.shepherdjerred.thestorm;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

/** Startup proof that opening creative cannot silently generate an empty replacement world. */
final class RecoveredCreativeData {
  private RecoveredCreativeData() {}

  static void require(Path container, String name) {
    if (!name.matches("[a-z0-9_-]+")) {
      throw new IllegalStateException("Recovered creative world must use one plain world name");
    }
    var legacy = container.resolve(name);
    var primary = container.resolve("world");
    var nativeWorld = primary.resolve("dimensions/minecraft").resolve(name);
    var legacyRegions = hasRegions(legacy.resolve("region"));
    var nativeRegions = hasRegions(nativeWorld.resolve("region"));
    if (legacyRegions == nativeRegions) {
      throw new IllegalStateException(
          "Recovered creative requires exactly one existing legacy or native terrain store");
    }
    var metadata = legacyRegions ? legacy.resolve("level.dat") : primary.resolve("level.dat");
    if (Files.isSymbolicLink(legacy)
        || Files.isSymbolicLink(primary)
        || Files.isSymbolicLink(primary.resolve("dimensions"))
        || Files.isSymbolicLink(primary.resolve("dimensions/minecraft"))
        || Files.isSymbolicLink(nativeWorld)
        || !Files.isRegularFile(metadata, LinkOption.NOFOLLOW_LINKS)) {
      throw new IllegalStateException("Recovered creative terrain requires regular world metadata");
    }
  }

  private static boolean hasRegions(Path region) {
    if (Files.isSymbolicLink(region)) {
      throw new IllegalStateException("Recovered creative region store cannot be linked");
    }
    if (!Files.isDirectory(region, LinkOption.NOFOLLOW_LINKS)) {
      return false;
    }
    try (var files = Files.list(region)) {
      var regions =
          files
              .filter(path -> path.getFileName().toString().matches("r\\.-?\\d+\\.-?\\d+\\.mca"))
              .toList();
      for (var file : regions) {
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
            || Files.size(file) < 8192
            || Files.size(file) % 4096 != 0) {
          throw new IllegalStateException("Recovered creative contains an invalid region file");
        }
      }
      return !regions.isEmpty();
    } catch (IOException error) {
      throw new UncheckedIOException("Could not inspect recovered creative terrain", error);
    }
  }
}
