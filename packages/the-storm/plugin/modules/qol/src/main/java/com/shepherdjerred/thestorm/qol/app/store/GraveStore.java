package com.shepherdjerred.thestorm.qol.app.store;

import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Graves and their stacks. Claim and drop rows preserve the stored copy until a recipient's saved
 * player data confirms delivery. Each write is one transaction.
 */
public interface GraveStore {

  /** Every grave with its stacks (possibly none), oldest first. */
  CompletableFuture<List<GraveContents>> loadAll();

  /** Saves a new grave with all its stacks, or nothing if it fails. */
  CompletableFuture<Void> create(GraveContents grave);

  /** A durable reservation that still leaves every item in the grave table. */
  record Claim(UUID token, UUID grave, UUID taker, List<GraveItem> items, int remaining) {
    public Claim {
      items = List.copyOf(items);
    }
  }

  record TakeRequest(UUID grave, UUID taker, UUID token, Set<Integer> indexes, Instant at) {
    public TakeRequest {
      indexes = Set.copyOf(indexes);
    }
  }

  record DropRequest(UUID grave, int index, UUID taker, UUID token, Instant at) {}

  /** Reserves available stacks for one recipient without deleting their stored copy. */
  CompletableFuture<Claim> reserveTake(TakeRequest request);

  /** Reserves a projected expired/overflow stack for a player who picked up its entity. */
  CompletableFuture<Claim> reserveDrop(DropRequest request);

  /** Claims awaiting delivery or recovery after a crash, grouped by token. */
  CompletableFuture<List<Claim>> pendingClaims();

  /** Deletes stacks only after the recipient's saved player data contains the receipt. */
  CompletableFuture<Taken> finishTake(UUID token, UUID taker);

  /** Makes undelivered stacks available again. */
  CompletableFuture<Void> releaseTake(UUID token, UUID taker);

  /** A stored grave item offered as a replaceable world display entity. */
  record Drop(UUID grave, GraveItem item, GravePos pos, boolean ownerOnly) {}

  /** Marks an expired grave's stacks for world projection, idempotently. */
  CompletableFuture<List<Drop>> beginExpiry(UUID grave, Notice notice);

  /** Offers an owner's inventory overflow at their feet without deleting stored stacks. */
  CompletableFuture<List<Drop>> beginOverflow(UUID grave, Set<Integer> indexes, GravePos at);

  /** Every durable item projection, including ones whose world entity needs recreation. */
  CompletableFuture<List<Drop>> pendingDrops();

  /** Deletes grave metadata only when no stored stacks remain. */
  CompletableFuture<Void> deleteEmpty(UUID grave);

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

  /**
   * A message for a player who is offline.
   *
   * @param player who to tell
   * @param message what to tell them
   * @param at when it happened
   */
  record Notice(UUID player, String message, Instant at) {}

  /**
   * Removes an expired grave and, in the same transaction, leaves {@code notice} for its owner if
   * given. Returns every stack the grave still held.
   */
  CompletableFuture<List<GraveItem>> expire(UUID grave, Optional<Notice> notice);

  /** A pending notice and the row that should be acknowledged after delivery. */
  record PendingNotice(long id, String message) {}

  /** Reads {@code player}'s notices, oldest first, without deleting them. */
  CompletableFuture<List<PendingNotice>> listNotices(UUID player);

  /** Deletes only notices actually delivered to {@code player}. */
  CompletableFuture<Integer> acknowledgeNotices(UUID player, List<Long> ids);
}
