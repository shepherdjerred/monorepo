package com.shepherdjerred.thestorm.core.snapshot;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.nbt.NbtReader;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.zip.GZIPInputStream;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * Paper's player data: {@link Player#saveData()} writes the file in the calling tick (to a
 * temporary file, then replacing the old one), as Paper's own autosave and save on quit do; the
 * plugin may not reach the server internals that would let it write off the main thread. A {@link
 * SavePacer} writes at most one player a tick, server-wide. The file is read back on the compute
 * pool as gzipped NBT; persistent data lives in the root compound's {@code BukkitValues}, keyed by
 * the namespaced key.
 */
public final class PaperSavedPlayerData implements SavedPlayerData {

  private final PlayerDataFiles files;
  private final ComputePool pool;
  private final SavePacer pacer;

  PaperSavedPlayerData(PlayerDataFiles files, ComputePool pool, SavePacer pacer) {
    this.files = files;
    this.pool = pool;
    this.pacer = pacer;
  }

  /**
   * The server's player data, or {@link SavedPlayerData#UNAVAILABLE} if its files cannot be found
   * under the level directory.
   */
  public static SavedPlayerData locate(
      Server server, ComputePool pool, Scheduler scheduler, ComponentLogger logger) {
    var level = server.getLevelDirectory();
    var found = PlayerDataFiles.locate(level);
    if (found.isEmpty()) {
      logger.warn(
          "No player-data folder under {}; restored belongings are confirmed only by a later login",
          level);
      return UNAVAILABLE;
    }
    return new PaperSavedPlayerData(found.orElseThrow(), pool, new SavePacer(scheduler));
  }

  @Override
  public boolean available() {
    return true;
  }

  @Override
  public CompletableFuture<Void> save(Player player) {
    var written = new CompletableFuture<Void>();
    pacer.submit(
        () -> {
          try {
            if (player.isOnline()) {
              player.saveData();
            }
            written.complete(null);
          } catch (RuntimeException failure) {
            written.completeExceptionally(failure);
          }
        });
    return written;
  }

  @Override
  public CompletableFuture<Optional<String>> marker(UUID player, NamespacedKey key) {
    var file = files.of(player);
    return pool.submit(() -> read(file, key));
  }

  /**
   * The string under {@code key} in {@code file}'s persistent data. The whole file is read to the
   * end of its gzip stream, so a truncated or corrupt file fails instead of answering.
   */
  static Optional<String> read(Path file, NamespacedKey key) {
    try (var in =
        new DataInputStream(
            new BufferedInputStream(new GZIPInputStream(Files.newInputStream(file))))) {
      var root = NbtReader.readRoot(in);
      if (in.read() != -1) {
        throw new IOException("data follows the root compound");
      }
      return marker(root, key, file);
    } catch (IOException e) {
      throw new UncheckedIOException("could not read saved player data " + file, e);
    }
  }

  private static Optional<String> marker(Map<String, Object> root, NamespacedKey key, Path file) {
    var values = root.get("BukkitValues");
    if (values == null) {
      return Optional.empty();
    }
    if (!(values instanceof Map<?, ?> compound)) {
      throw new IllegalStateException(file + ": BukkitValues is not a compound");
    }
    var value = compound.get(key.toString());
    if (value == null) {
      return Optional.empty();
    }
    if (!(value instanceof String text)) {
      throw new IllegalStateException(file + ": " + key + " is not a string");
    }
    return Optional.of(text);
  }
}
