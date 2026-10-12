package com.shepherdjerred.thestorm.core.snapshot;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;

/**
 * The player data Paper keeps on disk, saved on demand and read back to prove what reached it. A
 * {@link SnapshotKeeper} saves a player right after restoring them and reads the file back to see
 * its restore marker there, so the player may join another game without logging in again.
 *
 * <p>Published by the plugin as a core service. When the server's player-data files cannot be
 * found, the published instance is {@link #UNAVAILABLE} and restores fall back to the proof of a
 * later login.
 */
public interface SavedPlayerData {

  /** Player data that cannot be saved or read back on this server. */
  SavedPlayerData UNAVAILABLE =
      new SavedPlayerData() {
        @Override
        public boolean available() {
          return false;
        }

        @Override
        public CompletableFuture<Void> save(Player player) {
          return CompletableFuture.failedFuture(
              new IllegalStateException("player data cannot be saved and read back here"));
        }

        @Override
        public CompletableFuture<Optional<String>> marker(UUID player, NamespacedKey key) {
          return CompletableFuture.failedFuture(
              new IllegalStateException("player data cannot be read back here"));
        }
      };

  /** Whether {@link #save} and {@link #marker} work on this server. */
  boolean available();

  /**
   * Writes {@code player}'s data to disk on the main thread, as Paper's autosave does, at most one
   * player a tick across every caller: now if nothing was written this tick, else in its turn. A
   * player who has left by then is not written (Paper saved them as they left). Main thread only;
   * the future completes on the main thread.
   */
  CompletableFuture<Void> save(Player player);

  /**
   * Reads {@code player}'s saved file off the main thread and returns the string stored under
   * {@code key} in its persistent data, or empty if the fully read file holds none. Fails if the
   * file is missing, truncated or otherwise unreadable.
   */
  CompletableFuture<Optional<String>> marker(UUID player, NamespacedKey key);
}
