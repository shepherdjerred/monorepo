package com.shepherdjerred.thestorm.qol.app.store;

import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Graves and their stacks. Each call is one transaction; taking stacks deletes them in the same
 * transaction that returns them, so a stack can be handed out once at most.
 */
public interface GraveStore {

  /** Every grave with its stacks (possibly none), oldest first. */
  CompletableFuture<List<GraveContents>> loadAll();

  /** Saves a new grave with all its stacks, or nothing if it fails. */
  CompletableFuture<Void> create(GraveContents grave);

  /**
   * The stacks taken out of a grave, and how many are left.
   *
   * @param items the stacks removed by this call
   * @param remaining how many stacks the grave still holds
   */
  record Taken(List<GraveItem> items, int remaining) {

    public Taken {
      items = List.copyOf(items);
    }
  }

  /**
   * Removes and returns the stacks at {@code indexes} that are still in the grave; stacks already
   * taken are skipped. The grave itself stays until {@link #delete}, so stacks can be put back.
   */
  CompletableFuture<Taken> take(UUID grave, Set<Integer> indexes);

  /** Puts stacks back into a grave (their taker left before receiving them). */
  CompletableFuture<Void> putBack(UUID grave, List<GraveItem> items);

  /** Removes a grave and returns every stack it still held. */
  CompletableFuture<List<GraveItem>> delete(UUID grave);
}
