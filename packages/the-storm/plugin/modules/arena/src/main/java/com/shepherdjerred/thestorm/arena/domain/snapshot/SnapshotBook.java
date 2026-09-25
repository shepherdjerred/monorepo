package com.shepherdjerred.thestorm.arena.domain.snapshot;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The snapshots of players inside arenas, and the restores still being cleaned up.
 *
 * <p>A snapshot enters the book the moment it is taken (the player is emptied in the same tick) and
 * leaves it exactly once, when it is taken for restoring, so a player is never restored twice.
 * Restoring then runs in a fixed order: put the snapshot back, save the player's data, and only
 * then delete the stored snapshot. Until that delete succeeds the player is {@link #cleaning}: a
 * new snapshot may not be taken, because a late delete would remove it.
 *
 * <p>After a crash the book starts empty and not {@link #loaded}; nobody may join an arena until
 * the stored snapshots are read back, so a stale kit can never overwrite a real snapshot.
 *
 * @param held player to the snapshot waiting to be restored
 * @param cleaning players restored whose stored snapshot is not yet deleted
 * @param loaded whether the snapshots left by the last run have been read back
 */
public record SnapshotBook(Map<UUID, Snapshot> held, Set<UUID> cleaning, boolean loaded) {

  public static final SnapshotBook UNLOADED = new SnapshotBook(Map.of(), Set.of(), false);

  public SnapshotBook {
    held = Map.copyOf(held);
    cleaning = Set.copyOf(cleaning);
    for (var player : cleaning) {
      if (held.containsKey(player)) {
        throw new IllegalArgumentException(player + " cannot be held and cleaning at once");
      }
    }
  }

  /** Why a player may not have a new snapshot taken yet. */
  public enum Refusal {
    /** Snapshots from before a restart are still being read. */
    NOT_LOADED,
    /** The player still has a snapshot waiting to be restored. */
    RESTORE_PENDING,
    /** The player's last restore has not finished deleting its stored snapshot. */
    CLEANUP_PENDING,
  }

  /** Whether a new snapshot of {@code player} may be taken, or why not. */
  public Optional<Refusal> refusal(UUID player) {
    if (!loaded) {
      return Optional.of(Refusal.NOT_LOADED);
    }
    if (held.containsKey(player)) {
      return Optional.of(Refusal.RESTORE_PENDING);
    }
    return cleaning.contains(player) ? Optional.of(Refusal.CLEANUP_PENDING) : Optional.empty();
  }

  public boolean holds(UUID player) {
    return held.containsKey(player);
  }

  /** The book with {@code snapshot} held; the player must be free to snapshot. */
  public SnapshotBook withHeld(Snapshot snapshot) {
    var refusal = refusal(snapshot.player());
    if (refusal.isPresent()) {
      throw new IllegalStateException(
          snapshot.player() + " cannot be snapshot: " + refusal.orElseThrow());
    }
    var next = new HashMap<>(held);
    next.put(snapshot.player(), snapshot);
    return new SnapshotBook(next, cleaning, loaded);
  }

  /**
   * The book with the snapshots left by the last run added and marked loaded. A snapshot already in
   * the book, or a restore still cleaning up, wins over the stored one.
   */
  public SnapshotBook withLoaded(List<Snapshot> stored) {
    var next = new HashMap<>(held);
    for (var snapshot : stored) {
      if (!cleaning.contains(snapshot.player())) {
        next.putIfAbsent(snapshot.player(), snapshot);
      }
    }
    return new SnapshotBook(next, cleaning, true);
  }

  /**
   * Takes {@code player}'s snapshot out of the book for restoring; the player is then cleaning
   * until {@link #cleaned}.
   */
  public Taken take(UUID player) {
    var snapshot = held.get(player);
    if (snapshot == null) {
      return new Taken(Optional.empty(), this);
    }
    var next = new HashMap<>(held);
    next.remove(player);
    var nowCleaning = new HashSet<>(cleaning);
    nowCleaning.add(player);
    return new Taken(Optional.of(snapshot), new SnapshotBook(next, nowCleaning, loaded));
  }

  /** The stored snapshot of a restored player is deleted: they may join again. */
  public SnapshotBook cleaned(UUID player) {
    if (!cleaning.contains(player)) {
      return this;
    }
    var next = new HashSet<>(cleaning);
    next.remove(player);
    return new SnapshotBook(held, next, loaded);
  }

  /**
   * The result of {@link #take}.
   *
   * @param snapshot the snapshot to restore, if the player had one
   * @param book the book without it
   */
  public record Taken(Optional<Snapshot> snapshot, SnapshotBook book) {}
}
