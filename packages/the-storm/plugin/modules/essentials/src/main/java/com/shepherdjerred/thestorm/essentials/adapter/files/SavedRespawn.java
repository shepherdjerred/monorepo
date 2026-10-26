package com.shepherdjerred.thestorm.essentials.adapter.files;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.nbt.NbtReader;
import com.shepherdjerred.thestorm.core.snapshot.PlayerDataFiles;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.zip.GZIPInputStream;
import org.jspecify.annotations.Nullable;

/**
 * The single respawn stored in a player's saved data. Paper 26.2 writes {@code respawn} as {@code
 * ServerPlayer.RespawnConfig}: one dimension and block, not one bed per world.
 */
public final class SavedRespawn {

  private SavedRespawn() {}

  /** A respawn block and the facing vanilla stored with it. */
  public record Spot(String dimension, int x, int y, int z, float yaw) {
    public Spot {
      if (dimension.isBlank()) {
        throw new IllegalArgumentException("dimension must not be blank");
      }
      if (!Float.isFinite(yaw)) {
        throw new IllegalArgumentException("yaw must be finite");
      }
    }
  }

  /** One player file that contained a respawn. */
  public record Found(UUID player, Spot spot) {}

  /** A player file whose respawn could not be read. */
  public record Problem(String file, Throwable failure) {}

  /** Every respawn under {@code directory}, plus the files that could not be read. */
  public record Scan(List<Found> found, List<Problem> problems) {}

  /** All directory discovery and reading run on the compute pool. */
  public static CompletableFuture<Scan> load(Path level, ComputePool compute) {
    return compute.submit(
        () -> {
          try {
            var files =
                PlayerDataFiles.locate(level)
                    .orElseThrow(() -> new IOException("No player-data folder under " + level));
            return readAll(files.directory());
          } catch (IOException failure) {
            throw new UncheckedIOException(failure);
          }
        });
  }

  static Scan readAll(Path directory) throws IOException {
    var found = new ArrayList<Found>();
    var problems = new ArrayList<Problem>();
    try (var files = Files.newDirectoryStream(directory)) {
      for (var file : files) {
        readOne(file, found, problems);
      }
    }
    return new Scan(List.copyOf(found), List.copyOf(problems));
  }

  private static void readOne(Path file, List<Found> found, List<Problem> problems) {
    var name = file.getFileName().toString();
    if (!name.endsWith(".dat")) {
      return;
    }
    UUID player;
    try {
      player = UUID.fromString(name.substring(0, name.length() - 4));
    } catch (IllegalArgumentException ignored) {
      return;
    }
    try {
      read(file).ifPresent(spot -> found.add(new Found(player, spot)));
    } catch (UncheckedIOException | IllegalStateException failure) {
      problems.add(new Problem(file.toString(), failure));
    }
  }

  /** The respawn in {@code file}, or empty when the player has never set one. */
  static Optional<Spot> read(Path file) {
    try (var in =
        new DataInputStream(
            new BufferedInputStream(new GZIPInputStream(Files.newInputStream(file))))) {
      var root = NbtReader.readRoot(in);
      if (in.read() != -1) {
        throw new IOException("data follows the root compound");
      }
      return read(root);
    } catch (IOException failure) {
      throw new UncheckedIOException("could not read saved player data " + file, failure);
    }
  }

  /** The respawn in a decoded player file, or empty when {@code respawn} is absent. */
  static Optional<Spot> read(Map<String, Object> root) {
    if (!root.containsKey("respawn")) {
      return Optional.empty();
    }
    var data =
        compound(required(compound(root.get("respawn"), "respawn"), "respawnData"), "respawnData");
    var global = compound(required(data, "globalPos"), "globalPos");
    var pos = coordinates(required(global, "pos"));
    return Optional.of(
        new Spot(
            dimension(required(global, "dimension")),
            pos[0],
            pos[1],
            pos[2],
            yaw(required(data, "yaw"))));
  }

  private static Object required(Map<String, Object> compound, String field) {
    var value = compound.get(field);
    if (value == null) {
      throw new IllegalStateException(field + " is missing");
    }
    return value;
  }

  private static Map<String, Object> compound(@Nullable Object value, String field) {
    if (!(value instanceof Map<?, ?> raw)) {
      throw new IllegalStateException(field + " is not a compound");
    }
    var compound = new java.util.LinkedHashMap<String, Object>();
    for (var entry : raw.entrySet()) {
      if (!(entry.getKey() instanceof String name)) {
        throw new IllegalStateException(field + " has a non-string name");
      }
      compound.put(name, entry.getValue());
    }
    return compound;
  }

  private static String dimension(@Nullable Object value) {
    if (!(value instanceof String text) || text.isBlank()) {
      throw new IllegalStateException("dimension is not a world key");
    }
    return text;
  }

  private static int[] coordinates(@Nullable Object value) {
    if (!(value instanceof int[] coords) || coords.length != 3) {
      throw new IllegalStateException("pos is not a block position");
    }
    return coords;
  }

  private static float yaw(@Nullable Object value) {
    if (!(value instanceof Float number) || !Float.isFinite(number)) {
      throw new IllegalStateException("yaw is not a finite float");
    }
    return number;
  }
}
