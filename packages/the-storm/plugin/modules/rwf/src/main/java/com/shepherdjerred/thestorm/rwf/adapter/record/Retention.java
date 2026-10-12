package com.shepherdjerred.thestorm.rwf.adapter.record;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Prunes recordings, but only ones safely archived: everything archived and older than the
 * retention age, then the oldest archived until the folder fits the size cap. A recording that has
 * not been archived is never deleted, however old or however far over the cap the folder is; the
 * report says how much unarchived data is holding the folder over its cap so the module can warn.
 * Recordings still being written ({@code .rwfrec.gz.part}) are never touched. Runs off the main
 * thread at enable.
 *
 * <p>A recording is archived when a sibling {@code <file>.archived} marker exists whose recorded
 * size matches the file. The archiver writes the marker only after the object store has confirmed
 * the upload's SHA-256; see {@link Marker}.
 */
public final class Retention {

  /** The marker suffix: {@code <matchId>.rwfrec.gz.archived}. */
  public static final String MARKER_SUFFIX = ".archived";

  /**
   * What was pruned.
   *
   * @param deleted archived recordings removed
   * @param kept recordings left
   * @param bytesKept their total size
   * @param unarchived recordings kept because they are not archived yet
   * @param bytesOverCap how far the kept recordings still exceed the size cap; above zero only when
   *     unarchived recordings hold the folder over it
   */
  public record Report(int deleted, int kept, long bytesKept, int unarchived, long bytesOverCap) {}

  /**
   * The archiver's receipt beside a recording: one line, {@code rwf-archive-v1}, the object key,
   * the hex SHA-256 the object store confirmed, and the byte size, tab-separated.
   *
   * @param key where the recording was archived
   * @param sha256 its confirmed SHA-256
   * @param bytes its size
   */
  public record Marker(String key, String sha256, long bytes) {

    static final String VERSION = "rwf-archive-v1";
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");

    public Marker {
      if (key.isBlank() || key.contains("\t") || key.contains("\n")) {
        throw new IllegalArgumentException("marker key must be one plain field");
      }
      if (!SHA256.matcher(sha256).matches() || bytes < 0) {
        throw new IllegalArgumentException("marker needs a hex SHA-256 and a size");
      }
    }

    /** The marker's file text. */
    public String encode() {
      return VERSION + "\t" + key + "\t" + sha256 + "\t" + bytes + "\n";
    }

    /** The marker in {@code text}, or empty when it is not a valid marker. */
    public static Optional<Marker> decode(String text) {
      var fields = text.strip().split("\t", -1);
      if (fields.length != 4 || !fields[0].equals(VERSION)) {
        return Optional.empty();
      }
      try {
        return Optional.of(new Marker(fields[1], fields[2], Long.parseLong(fields[3])));
      } catch (IllegalArgumentException e) {
        return Optional.empty();
      }
    }
  }

  private Retention() {}

  /** Prunes {@code root}; a missing folder is an empty one. */
  public static Report prune(Path root, Duration maxAge, long maxBytes, Instant now) {
    var files = list(root);
    var byAge = new ArrayList<>(files);
    byAge.sort(Comparator.comparing(Retention::modified));
    var deleted = 0;
    var kept = new ArrayList<Path>();
    var cutoff = now.minus(maxAge);
    for (var file : byAge) {
      if (archived(file) && modified(file).toInstant().isBefore(cutoff)) {
        delete(file);
        deleted++;
      } else {
        kept.add(file);
      }
    }
    var total = kept.stream().mapToLong(Retention::size).sum();
    var remaining = new ArrayList<Path>();
    for (var file : kept) {
      if (total > maxBytes && archived(file)) {
        total -= size(file);
        delete(file);
        deleted++;
      } else {
        remaining.add(file);
      }
    }
    var unarchived = (int) remaining.stream().filter(file -> !archived(file)).count();
    return new Report(deleted, remaining.size(), total, unarchived, Math.max(0, total - maxBytes));
  }

  /** Whether {@code recording} has a valid archive marker that matches its size. */
  public static boolean archived(Path recording) {
    return marker(recording).filter(marker -> marker.bytes() == size(recording)).isPresent();
  }

  /** The archive marker beside {@code recording}, if there is a valid one. */
  public static Optional<Marker> marker(Path recording) {
    var path = markerOf(recording);
    try {
      return Marker.decode(Files.readString(path, StandardCharsets.UTF_8));
    } catch (NoSuchFileException e) {
      return Optional.empty();
    } catch (IOException e) {
      throw new UncheckedIOException("could not read archive marker " + path, e);
    }
  }

  /** Where {@code recording}'s archive marker lives. */
  public static Path markerOf(Path recording) {
    return recording.resolveSibling(recording.getFileName() + MARKER_SUFFIX);
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

  /** Deletes the recording first, then its marker: a marker never outlives what it vouches for. */
  private static void delete(Path file) {
    try {
      Files.deleteIfExists(file);
      Files.deleteIfExists(markerOf(file));
    } catch (IOException e) {
      throw new UncheckedIOException("could not delete recording " + file, e);
    }
  }

  /** Every finished recording under {@code root}, for tests, diagnostics and the archiver. */
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
      throw new UncheckedIOException("could not list recordings under " + root, e);
    }
  }
}
