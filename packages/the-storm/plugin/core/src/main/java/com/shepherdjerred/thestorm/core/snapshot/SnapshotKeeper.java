package com.shepherdjerred.thestorm.core.snapshot;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/**
 * The crash-safe lifecycle of one game's snapshots. Main thread only.
 *
 * <p>Joining takes the snapshot and empties the player in the same tick, keeping the snapshot in
 * the book, then stores it; if storing fails the player is put back from memory. Restoring puts the
 * snapshot back with a matching player-data {@link RestoreMarker} and saves the player's data
 * through the shared {@link SavedPlayerData} (at most one player file a tick, server-wide), then
 * reads the saved file back off the main thread. Only once a fully read file on disk holds the
 * snapshot's marker is the database row marked restored and deleted; the marker and the belongings
 * reach disk in the same atomic file replace, so the row is never retired while the belongings
 * could still be lost. If the file cannot be confirmed after a few retries the player is {@link
 * SnapshotBook.Refusal#CLEANUP_STALLED stalled} and a later login proves the restore instead, as it
 * does when the server's player data cannot be read back at all. A game module owns one keeper over
 * its own {@link SnapshotStore} and marker key, and layers whatever else it hands out on top of the
 * {@link Outcome} each call reports.
 */
public final class SnapshotKeeper {

  /** How many times marking a restored snapshot is tried. */
  private static final int MARK_ATTEMPTS = 6;

  /** The waits before reading back again, after the first check failed. */
  static final List<Duration> CONFIRM_RETRIES =
      List.of(
          Duration.ofSeconds(1),
          Duration.ofSeconds(2),
          Duration.ofSeconds(4),
          Duration.ofSeconds(8));

  /**
   * What a restore or a recovery did for the player.
   *
   * <ul>
   *   <li>{@link #RESTORED}: the player stands outside the game with their belongings back (or a
   *       saved marker proved they already did).
   *   <li>{@link #AWAITING_RESPAWN}: the player is dead; they are restored once they respawn.
   *   <li>{@link #PROOF_PENDING}: an earlier restore still waits to be confirmed in saved player
   *       data; nothing new was applied, except replaying it when the proof was missing.
   *   <li>{@link #NOTHING}: the player had no snapshot.
   * </ul>
   */
  public enum Outcome {
    RESTORED,
    AWAITING_RESPAWN,
    PROOF_PENDING,
    NOTHING
  }

  /**
   * What the keeper works with.
   *
   * @param plugin the owning plugin, for its logger and server
   * @param scheduler main-thread scheduling, for retries and completing futures
   * @param time the clock snapshots are stamped with
   * @param store the module's stored snapshots
   * @param marker the module's player-data marker
   * @param saved the server's saved player data, to confirm a restore without a new login
   */
  public record Parts(
      Plugin plugin,
      Scheduler scheduler,
      InstantSource time,
      SnapshotStore store,
      RestoreMarker marker,
      SavedPlayerData saved) {}

  private final Plugin plugin;
  private final Scheduler scheduler;
  private final InstantSource time;
  private final SnapshotStore store;
  private final RestoreMarker marker;
  private final SavedPlayerData saved;
  private final Set<UUID> restoreOnRespawn = new HashSet<>();
  private final Set<UUID> restoring = new HashSet<>();
  private final Set<UUID> joinedFromDisk = new HashSet<>();
  private final Set<UUID> loadedFromStore = new HashSet<>();
  private final Set<UUID> marking = new HashSet<>();
  private final Map<UUID, Snapshot> awaitingProof = new HashMap<>();
  private final Map<UUID, Runnable> waiting = new HashMap<>();
  private SnapshotBook book = SnapshotBook.UNLOADED;

  public SnapshotKeeper(Parts parts) {
    this.plugin = parts.plugin();
    this.scheduler = parts.scheduler();
    this.time = parts.time();
    this.store = parts.store();
    this.marker = parts.marker();
    this.saved = parts.saved();
  }

  /**
   * Reads back the snapshots a crash left behind, then runs {@code loaded} on the main thread so
   * the game can recover every online player who has one (see {@link #joinedFromDisk}).
   */
  public void load(Runnable loaded) {
    onMain(
        store.loadAll(),
        stored -> {
          stored.forEach(snapshot -> loadedFromStore.add(snapshot.player()));
          book = book.withLoaded(stored);
          if (!stored.isEmpty()) {
            logger().warn("{} snapshots were left by the last run", stored.size());
          }
          loaded.run();
        },
        "read snapshots");
  }

  /** Whether {@code player} logged in since the plugin started, so their data came from disk. */
  public boolean joinedFromDisk(UUID player) {
    return joinedFromDisk.contains(player);
  }

  /** Why a new snapshot of {@code player} cannot be taken yet, if it cannot. */
  public Optional<SnapshotBook.Refusal> refusal(UUID player) {
    return book.refusal(player);
  }

  /**
   * Runs {@code then} on the main thread once {@code player}'s restore stops being confirmed: it
   * was either confirmed, so {@link #refusal} is empty, or it {@linkplain
   * SnapshotBook.Refusal#CLEANUP_STALLED stalled}. Callers recheck the refusal. A later call for
   * the same player replaces an earlier one; a player who is not being confirmed runs it next tick.
   */
  public void whenClean(UUID player, Runnable then) {
    if (book.refusal(player).equals(Optional.of(SnapshotBook.Refusal.CLEANUP_PENDING))) {
      waiting.put(player, then);
      return;
    }
    scheduler.runOnMainThread(() -> guarded("rechecking the restore of " + player, then));
  }

  /**
   * Takes a snapshot for {@code scope} and empties the player in this same tick, then stores the
   * snapshot. {@code done} runs on the main thread with whether it was stored; if not, the player
   * has already been put back from memory.
   */
  public void capture(Player player, String scope, Consumer<Boolean> done) {
    if (!PlayerStates.settle(player)) {
      done.accept(false);
      return;
    }
    var snapshot = PlayerStates.capture(player, scope, time.instant());
    loadedFromStore.remove(player.getUniqueId());
    book = book.withHeld(snapshot);
    PlayerStates.wipe(player, player.getGameMode());
    var _ =
        store
            .save(snapshot)
            .whenCompleteAsync(
                (stored, failure) ->
                    guarded(
                        "finishing the join of " + player.getName(),
                        () -> stored(player, failure, done)),
                scheduler.mainThread());
  }

  private void stored(Player player, @Nullable Throwable failure, Consumer<Boolean> done) {
    if (failure == null) {
      done.accept(true);
      return;
    }
    logger()
        .error("Could not store the snapshot of {}; putting them back", player.getName(), failure);
    if (player.isOnline()) {
      restoreFailedCapture(player);
    }
    done.accept(false);
  }

  /**
   * A snapshot finished storing after its player left the game. It remains in the database until
   * saved player data confirms the restore.
   */
  public void forget(UUID player) {
    logger().debug("Keeping snapshot of {} until player data confirms restore", player);
  }

  /**
   * Restores {@code player}'s snapshot if they have one. A dead player is restored once they
   * respawn.
   *
   * <p>The marker is written in the same tick as the belongings, so every later save of the
   * player's data (the keeper's, Paper's autosave, the save on quit) holds both or neither. If a
   * crash happens before one, the next login replays this snapshot; if the marker survived, the
   * database row can be retired without applying it again.
   */
  public Outcome restore(Player player) {
    return restore(player, false);
  }

  private Outcome restore(Player player, boolean loadedFromDisk) {
    var id = player.getUniqueId();
    if (!book.holds(id)) {
      return Outcome.NOTHING;
    }
    if (player.isDead()) {
      restoreOnRespawn.add(id);
      return Outcome.AWAITING_RESPAWN;
    }
    var snapshot = book.held().get(id);
    if (snapshot == null) {
      throw new IllegalStateException("held snapshot disappeared for " + id);
    }
    if (loadedFromStore.contains(id) && marker.matches(player, snapshot)) {
      awaitProof(snapshot);
      if (loadedFromDisk) {
        mark(player, 1);
      } else {
        confirm(player, snapshot, 0);
      }
      return Outcome.RESTORED;
    }
    awaitProof(snapshot);
    PlayerStates.discardHeld(player);
    applyMarked(player, snapshot);
    return Outcome.RESTORED;
  }

  private void awaitProof(Snapshot snapshot) {
    book = book.take(snapshot.player()).book();
    loadedFromStore.remove(snapshot.player());
    awaitingProof.put(snapshot.player(), snapshot);
  }

  private void restoreFailedCapture(Player player) {
    var id = player.getUniqueId();
    var taken = book.take(id);
    book = taken.book().cleaned(id);
    restoring.add(id);
    try {
      taken.snapshot().ifPresent(snapshot -> apply(player, snapshot));
    } finally {
      restoring.remove(id);
    }
  }

  /**
   * Applies {@code snapshot} and records its marker, flagging the player as restoring meanwhile,
   * then saves and confirms the player's data.
   */
  private void applyMarked(Player player, Snapshot snapshot) {
    var id = player.getUniqueId();
    restoring.add(id);
    try {
      apply(player, snapshot);
      marker.record(player, snapshot);
    } finally {
      restoring.remove(id);
    }
    confirm(player, snapshot, 0);
  }

  /**
   * Confirms a restore from saved player data. The first attempt saves the player through the
   * shared {@link SavedPlayerData}, which writes at most one player file a tick server-wide, then
   * reads the file back off the main thread. The snapshot is marked restored once the file holds
   * its marker; otherwise only the read is tried again after each of {@link #CONFIRM_RETRIES} (a
   * later save by Paper, such as its autosave or the save on quit, may still land the marker)
   * before the player is stalled.
   */
  private void confirm(Player player, Snapshot snapshot, int attempt) {
    var id = player.getUniqueId();
    if (!snapshot.equals(awaitingProof.get(id))) {
      return;
    }
    if (!saved.available()) {
      stall(id, player.getName(), "the server's player data cannot be read back");
      return;
    }
    book = book.confirming(id);
    if (attempt > 0) {
      readBack(player, new Attempt(snapshot, attempt));
      return;
    }
    if (player.isOnline() && !marker.matches(player, snapshot)) {
      logger().error("{} lost the restore marker of a snapshot awaiting proof", player.getName());
      stall(id, player.getName(), "their restore marker is gone");
      return;
    }
    var _ =
        saved
            .save(player)
            .whenCompleteAsync(
                (written, failure) ->
                    guarded(
                        "confirming the restore of " + player.getName(),
                        () -> {
                          if (failure != null) {
                            logger()
                                .error("Could not save the data of {}", player.getName(), failure);
                          }
                          if (snapshot.equals(awaitingProof.get(id))) {
                            readBack(player, new Attempt(snapshot, 0));
                          }
                        }),
                scheduler.mainThread());
  }

  /** Reads the player's saved file back off the main thread and checks it on the main thread. */
  private void readBack(Player player, Attempt read) {
    var _ =
        saved
            .marker(player.getUniqueId(), marker.key())
            .whenCompleteAsync(
                (found, failure) ->
                    guarded(
                        "confirming the restore of " + player.getName(),
                        () ->
                            checked(
                                player, read, failure == null ? found : Optional.empty(), failure)),
                scheduler.mainThread());
  }

  /**
   * One read-back of a restore.
   *
   * @param snapshot the snapshot being confirmed
   * @param number 0 for the first read-back, then one more for each retry
   */
  private record Attempt(Snapshot snapshot, int number) {}

  private void checked(
      Player player, Attempt read, Optional<String> found, @Nullable Throwable failure) {
    var snapshot = read.snapshot();
    var attempt = read.number();
    var id = player.getUniqueId();
    if (!snapshot.equals(awaitingProof.get(id))) {
      return;
    }
    var expected = RestoreMarker.fingerprint(snapshot);
    if (failure == null && found.equals(Optional.of(expected))) {
      mark(player, 1);
      return;
    }
    if (attempt >= CONFIRM_RETRIES.size()) {
      stall(id, player.getName(), "their saved data never showed the restore");
      return;
    }
    var wait = CONFIRM_RETRIES.get(attempt);
    if (failure != null) {
      logger()
          .warn(
              "Could not read back the saved data of {} (attempt {}); retrying in {}",
              player.getName(),
              attempt + 1,
              wait,
              failure);
    } else {
      logger()
          .warn(
              "The saved data of {} does not yet hold their restore (attempt {}); retrying in {}",
              player.getName(),
              attempt + 1,
              wait);
    }
    var _ = scheduler.runOnMainThreadLater(wait, () -> confirm(player, snapshot, attempt + 1));
  }

  /** The restore of {@code id} waits for a later login to be confirmed. */
  private void stall(UUID id, String name, String why) {
    book = book.stalled(id);
    logger().warn("The restore of {} waits for their next login: {}", name, why);
    settled(id);
  }

  /** Runs whatever waited for {@code id}'s restore to stop being confirmed. */
  private void settled(UUID id) {
    var then = waiting.remove(id);
    if (then != null) {
      guarded("rechecking the restore of " + id, then);
    }
  }

  /** Whether {@code player} is being put back right now: their restore teleport is allowed. */
  public boolean restoring(UUID player) {
    return restoring.contains(player);
  }

  /** Retires a snapshot after saved player data proved its marker reached disk. */
  private void mark(Player player, int attempt) {
    var id = player.getUniqueId();
    if (attempt == 1 && !marking.add(id)) {
      return;
    }
    var _ =
        store
            .markRestored(id, time.instant())
            .whenCompleteAsync(
                (marked, failure) ->
                    guarded(
                        "finishing the restore of " + player.getName(),
                        () -> marked(player, attempt, failure)),
                scheduler.mainThread());
  }

  private void marked(Player player, int attempt, @Nullable Throwable failure) {
    var id = player.getUniqueId();
    if (failure == null) {
      marking.remove(id);
      awaitingProof.remove(id);
      book = book.cleaned(id);
      logFailure(store.deleteRestored(id), "delete the restored snapshot of " + player.getName());
      settled(id);
      return;
    }
    if (attempt >= MARK_ATTEMPTS) {
      marking.remove(id);
      logger()
          .error(
              "GAVE UP marking the snapshot of {} restored after {} attempts; the player cannot"
                  + " re-enter until a later login retries cleanup.",
              player.getName(),
              attempt,
              failure);
      stall(id, player.getName(), "the database would not mark it restored");
      return;
    }
    var backoff = Duration.ofSeconds(1L << attempt);
    logger()
        .error(
            "Could not mark the snapshot of {} restored (attempt {}); retrying in {}",
            player.getName(),
            attempt,
            backoff,
            failure);
    var _ = scheduler.runOnMainThreadLater(backoff, () -> mark(player, attempt + 1));
  }

  /**
   * On join ({@code loadedFromDisk}) or for a player already online: restores a snapshot left by a
   * crash (after respawning, if dead), or proves and retires an earlier restore. A fresh login
   * whose loaded data holds the marker proves the restore at once; one without it replays the
   * snapshot.
   */
  public Outcome recover(Player player, boolean loadedFromDisk) {
    var id = player.getUniqueId();
    if (loadedFromDisk) {
      joinedFromDisk.add(id);
    }
    var pending = awaitingProof.get(id);
    if (pending != null) {
      if (loadedFromDisk && marker.matches(player, pending)) {
        mark(player, 1);
      } else if (loadedFromDisk) {
        applyMarked(player, pending);
      }
      return Outcome.PROOF_PENDING;
    }
    return restore(player, loadedFromDisk);
  }

  /**
   * The player respawned: true if their restore waited for it, in which case the game recovers them
   * now.
   */
  public boolean respawned(UUID player) {
    return restoreOnRespawn.remove(player);
  }

  /** Whether {@code player}'s restore waits for them to respawn. */
  public boolean waitsForRespawn(UUID player) {
    return restoreOnRespawn.contains(player);
  }

  /** Whether {@code player} has a snapshot waiting to be restored. */
  public boolean holds(UUID player) {
    return book.holds(player);
  }

  private void apply(Player player, Snapshot snapshot) {
    if (!PlayerStates.apply(player, snapshot, plugin.getServer())) {
      logger()
          .error(
              "{}'s snapshot names world {}, which is gone; they stay where they are",
              player.getName(),
              snapshot.position().world());
    }
  }

  private ComponentLogger logger() {
    return plugin.getComponentLogger();
  }

  /** Runs {@code then} on the main thread with the result, or logs why {@code what} failed. */
  private <T> void onMain(CompletableFuture<T> future, Consumer<T> then, String what) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                logger().error("Could not {}", what, failure);
              } else {
                guarded(what, () -> then.accept(value));
              }
            },
            scheduler.mainThread());
  }

  /** Runs {@code work}, logging anything it throws: an exception in a callback would vanish. */
  private void guarded(String what, Runnable work) {
    try {
      work.run();
    } catch (RuntimeException e) {
      logger().error("Unexpected failure while {}", what, e);
    }
  }

  private void logFailure(CompletableFuture<?> future, String what) {
    var _ =
        future.whenComplete(
            (value, failure) -> {
              if (failure != null) {
                logger().error("Could not {}", what, failure);
              }
            });
  }
}
