package com.shepherdjerred.thestorm.arena.domain.snapshot;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The snapshots waiting to be restored, mirrored from storage. A snapshot enters the book only once
 * it is safely stored, and leaves it exactly once, when it is taken for restoring, so a player is
 * never restored twice.
 *
 * <p>After a crash the book starts empty and not {@link #loaded}; nobody may join an arena until
 * the stored snapshots are read back, so a stale kit can never overwrite a real snapshot.
 *
 * @param held player to their stored snapshot
 * @param loaded whether the snapshots left by the last run have been read back
 */
public record SnapshotBook(Map<UUID, Snapshot> held, boolean loaded) {

  public static final SnapshotBook UNLOADED = new SnapshotBook(Map.of(), false);

  public SnapshotBook {
    held = Map.copyOf(held);
  }

  /** Why a player may not have a new snapshot taken yet. */
  public enum Refusal {
    /** Snapshots from before a restart are still being read. */
    NOT_LOADED,
    /** The player still has a snapshot waiting to be restored. */
    RESTORE_PENDING,
  }

  /** Whether a new snapshot of {@code player} may be taken, or why not. */
  public Optional<Refusal> refusal(UUID player) {
    if (!loaded) {
      return Optional.of(Refusal.NOT_LOADED);
    }
    return held.containsKey(player) ? Optional.of(Refusal.RESTORE_PENDING) : Optional.empty();
  }

  public boolean holds(UUID player) {
    return held.containsKey(player);
  }

  /** The book with {@code snapshot} stored. */
  public SnapshotBook withStored(Snapshot snapshot) {
    var next = new HashMap<>(held);
    next.put(snapshot.player(), snapshot);
    return new SnapshotBook(next, loaded);
  }

  /**
   * The book with the snapshots left by the last run added and marked loaded. A snapshot already in
   * the book wins over the stored one.
   */
  public SnapshotBook withLoaded(List<Snapshot> stored) {
    var next = new HashMap<>(held);
    for (var snapshot : stored) {
      next.putIfAbsent(snapshot.player(), snapshot);
    }
    return new SnapshotBook(next, true);
  }

  /** Takes {@code player}'s snapshot out of the book for restoring. */
  public Taken take(UUID player) {
    var snapshot = held.get(player);
    if (snapshot == null) {
      return new Taken(Optional.empty(), this);
    }
    var next = new HashMap<>(held);
    next.remove(player);
    return new Taken(Optional.of(snapshot), new SnapshotBook(next, loaded));
  }

  /**
   * The result of {@link #take}.
   *
   * @param snapshot the snapshot to restore, if the player had one
   * @param book the book without it
   */
  public record Taken(Optional<Snapshot> snapshot, SnapshotBook book) {}
}
