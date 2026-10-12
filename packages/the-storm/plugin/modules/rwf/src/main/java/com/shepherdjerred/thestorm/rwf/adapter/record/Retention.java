package com.shepherdjerred.thestorm.rwf.adapter.record;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * Deletes old recordings: everything older than the retention age, then the oldest until the folder
 * fits the size cap. Runs off the main thread at enable.
 */
public final class Retention {

  /**
   * What was pruned.
   *
   * @param deleted files removed
   * @param kept files left
   * @param bytesKept their total size
   */
  public record Report(int deleted, int kept, long bytesKept) {}

  private Retention() {}

  /** Prunes {@code root}; a missing folder is an empty one. */
  public static Report prune(Path root, Duration maxAge, long maxBytes, Instant now) {
    if (!Files.isDirectory(root)) {
      return new Report(0, 0, 0);
    }
    var files = new ArrayList<Path>();
    try (Stream<Path> walk = Files.walk(root)) {
      walk.filter(Files::isRegularFile)
          .filter(path -> path.getFileName().toString().endsWith(GzipRecorder.SUFFIX))
          .forEach(files::add);
    } catch (IOException e) {
      throw new UncheckedIOException("could not list recordings under " + root, e);
    }
    files.sort(Comparator.comparing(Retention::modified));
    var deleted = 0;
    var kept = new ArrayList<Path>();
    var cutoff = now.minus(maxAge);
    for (var file : files) {
      if (modified(file).toInstant().isBefore(cutoff)) {
        delete(file);
        deleted++;
      } else {
        kept.add(file);
      }
    }
    var total = kept.stream().mapToLong(Retention::size).sum();
    var oldest = 0;
    while (total > maxBytes && oldest < kept.size()) {
      var file = kept.get(oldest++);
      total -= size(file);
      delete(file);
      deleted++;
    }
    return new Report(deleted, kept.size() - oldest, total);
  }

  private static FileTime modified(Path file) {
    try {
      return Files.getLastModifiedTime(file);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static long size(Path file) {
    try {
      return Files.size(file);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static void delete(Path file) {
    try {
      Files.deleteIfExists(file);
    } catch (IOException e) {
      throw new UncheckedIOException("could not delete recording " + file, e);
    }
  }

  /** Every recording under {@code root}, for tests and diagnostics. */
  public static List<Path> list(Path root) {
    if (!Files.isDirectory(root)) {
      return List.of();
    }
    try (Stream<Path> walk = Files.walk(root)) {
      return walk.filter(Files::isRegularFile)
          .filter(path -> path.getFileName().toString().endsWith(GzipRecorder.SUFFIX))
          .sorted()
          .toList();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
