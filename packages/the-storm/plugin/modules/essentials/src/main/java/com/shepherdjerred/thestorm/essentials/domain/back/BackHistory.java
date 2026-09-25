package com.shepherdjerred.thestorm.essentials.domain.back;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.List;

/**
 * The last {@code capacity} places a player left, newest first. Immutable.
 *
 * <p>{@code /back} goes to an entry without removing it; that teleport records the place it left,
 * so using {@code /back} twice returns the player to where they started, as in EssentialsX.
 */
public final class BackHistory {

  private final int capacity;
  private final List<BackEntry> newestFirst;

  private BackHistory(int capacity, List<BackEntry> newestFirst) {
    this.capacity = capacity;
    this.newestFirst = List.copyOf(newestFirst);
  }

  /** A history of {@code entries} (newest first), keeping at most {@code capacity}. */
  public static BackHistory of(int capacity, List<BackEntry> newestFirst) {
    if (capacity < 1) {
      throw new IllegalArgumentException("capacity must be at least 1: " + capacity);
    }
    return new BackHistory(
        capacity, newestFirst.subList(0, Math.min(capacity, newestFirst.size())));
  }

  /** This history with {@code entry} added as the newest, dropping the oldest beyond capacity. */
  public BackHistory push(BackEntry entry) {
    var next = new ArrayList<BackEntry>(capacity);
    next.add(entry);
    next.addAll(newestFirst.subList(0, Math.min(capacity - 1, newestFirst.size())));
    return new BackHistory(capacity, next);
  }

  /** The entry {@code steps} back: 1 is the most recent place left. */
  public Result<BackEntry, BackError> select(int steps) {
    if (newestFirst.isEmpty()) {
      return Result.err(new BackError.Empty());
    }
    if (steps < 1 || steps > newestFirst.size()) {
      return Result.err(new BackError.NotThatFar(steps, newestFirst.size()));
    }
    return Result.ok(newestFirst.get(steps - 1));
  }

  /** The entries, newest first. */
  public List<BackEntry> entries() {
    return newestFirst;
  }

  /** The most entries kept. */
  public int capacity() {
    return capacity;
  }
}
