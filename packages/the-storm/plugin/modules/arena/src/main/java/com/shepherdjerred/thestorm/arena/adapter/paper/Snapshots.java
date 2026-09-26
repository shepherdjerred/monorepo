package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.app.store.SnapshotStore;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import com.shepherdjerred.thestorm.arena.domain.snapshot.SnapshotBook;
import java.time.Duration;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Predicate;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Every arena's snapshots, and the vault loot waiting for players outside. Main thread only.
 *
 * <p>Joining takes the snapshot and empties the player in the same tick, keeping the snapshot in
 * the book, then stores it; if storing fails the player is put back from memory. Restoring puts the
 * snapshot back, marks the stored snapshot restored, saves the player's data and then deletes the
 * stored snapshot, so a crash leaves either the player's belongings or one snapshot that is
 * restored once.
 */
final class Snapshots {

  /** How many times marking a restored snapshot is tried. */
  private static final int MARK_ATTEMPTS = 6;

  private final PaperContext runtime;
  private final SnapshotStore store;
  private final RewardStore rewards;
  private final Texts texts;
  private final PlayerSaver saver;
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> restoreOnRespawn = new HashSet<>();
  private final Set<UUID> restoring = new HashSet<>();
  private SnapshotBook book = SnapshotBook.UNLOADED;

  /**
   * What the snapshots are kept with.
   *
   * @param store stored snapshots
   * @param rewards waiting vault loot
   * @param texts messages
   * @param saver saves a player's data to disk
   */
  record Parts(SnapshotStore store, RewardStore rewards, Texts texts, PlayerSaver saver) {}

  Snapshots(PaperContext runtime, Parts parts) {
    this.runtime = runtime;
    this.store = parts.store();
    this.rewards = parts.rewards();
    this.texts = parts.texts();
    this.saver = parts.saver();
  }

  /**
   * Reads back the snapshots a crash left behind, then restores every online player who has one and
   * is not in an arena.
   */
  void load(Predicate<UUID> inArena) {
    runtime.onMain(
        store.loadAll(),
        stored -> {
          book = book.withLoaded(stored);
          if (!stored.isEmpty()) {
            runtime.logger().warn("{} arena snapshots were left by the last run", stored.size());
          }
          for (var player : runtime.server().getOnlinePlayers()) {
            if (!inArena.test(player.getUniqueId())) {
              recover(player);
            }
          }
        },
        "read arena snapshots");
  }

  /** Why a new snapshot of {@code player} cannot be taken yet, if it cannot. */
  Optional<SnapshotBook.Refusal> refusal(UUID player) {
    return book.refusal(player);
  }

  /**
   * Takes a snapshot and empties the player in this same tick, then stores the snapshot. {@code
   * done} runs on the main thread with whether it was stored; if not, the player has already been
   * put back from memory.
   */
  void capture(Player player, String arena, Consumer<Boolean> done) {
    PlayerStates.settle(player);
    var snapshot = PlayerStates.capture(player, arena, runtime.time().instant());
    book = book.withHeld(snapshot);
    PlayerStates.wipe(player, player.getGameMode());
    var _ =
        store
            .save(snapshot)
            .whenCompleteAsync(
                (saved, failure) ->
                    runtime.guarded(
                        "finishing the join of " + player.getName(),
                        () -> stored(player, failure, done)),
                runtime.mainThread());
  }

  private void stored(Player player, @Nullable Throwable failure, Consumer<Boolean> done) {
    if (failure == null) {
      done.accept(true);
      return;
    }
    runtime
        .logger()
        .error(
            "Could not store the arena snapshot of {}; putting them back",
            player.getName(),
            failure);
    if (player.isOnline()) {
      restore(player);
    }
    done.accept(false);
  }

  /**
   * A snapshot finished storing after its player left the arena. Usually they were already put back
   * from memory, so the stored copy must never be restored: it is marked restored, then deleted. If
   * their restore is still waiting (they died while joining and have not respawned), the stored
   * copy is their only copy on disk and is kept for that restore.
   */
  void forget(UUID player) {
    if (book.holds(player)) {
      runtime
          .logger()
          .info("Keeping the arena snapshot of {} until their restore after respawning", player);
      return;
    }
    runtime.onMain(
        store.markRestored(player, runtime.time().instant()),
        marked ->
            runtime.logFailure(
                store.deleteRestored(player), "delete the arena snapshot of " + player),
        "retire the arena snapshot of " + player);
  }

  /**
   * Restores {@code player}'s snapshot if they have one, and hands out vault loot waiting for them.
   * Returns false if there was nothing to restore. A dead player is restored once they respawn.
   *
   * <p>The order makes a restore happen at most once: put the snapshot back, mark the stored
   * snapshot restored (one writer transaction), then save the player's data, then delete the stored
   * snapshot best-effort. A crash before the mark restores it again on the next join (the player's
   * data was not saved yet); after the mark it is never restored again.
   */
  boolean restore(Player player) {
    var id = player.getUniqueId();
    if (!book.holds(id)) {
      return false;
    }
    if (player.isDead()) {
      restoreOnRespawn.add(id);
      return true;
    }
    var taken = book.take(id);
    book = taken.book();
    PlayerStates.discardHeld(player);
    restoring.add(id);
    try {
      apply(player, taken.snapshot().orElseThrow());
    } finally {
      restoring.remove(id);
    }
    mark(player, 1);
    deliver(player);
    return true;
  }

  /** Whether {@code player} is being put back right now: their restore teleport is allowed. */
  boolean restoring(UUID player) {
    return restoring.contains(player);
  }

  /** Marks the stored snapshot restored, then saves the player; retries the mark with backoff. */
  private void mark(Player player, int attempt) {
    var id = player.getUniqueId();
    var _ =
        store
            .markRestored(id, runtime.time().instant())
            .whenCompleteAsync(
                (marked, failure) ->
                    runtime.guarded(
                        "finishing the restore of " + player.getName(),
                        () -> marked(player, attempt, failure)),
                runtime.mainThread());
  }

  private void marked(Player player, int attempt, @Nullable Throwable failure) {
    var id = player.getUniqueId();
    if (player.isOnline()) {
      saver.save(player);
    }
    if (failure == null) {
      book = book.cleaned(id);
      runtime.logFailure(
          store.deleteRestored(id), "delete the restored arena snapshot of " + player.getName());
      return;
    }
    if (attempt >= MARK_ATTEMPTS) {
      runtime
          .logger()
          .error(
              "GAVE UP marking the arena snapshot of {} restored after {} attempts; if the server"
                  + " restarts first it will be restored again, rolling them back. Delete it"
                  + " from arena_snapshots by hand.",
              player.getName(),
              attempt,
              failure);
      return;
    }
    var backoff = Duration.ofSeconds(1L << attempt);
    runtime
        .logger()
        .error(
            "Could not mark the arena snapshot of {} restored (attempt {}); retrying in {}",
            player.getName(),
            attempt,
            backoff,
            failure);
    var _ = runtime.scheduler().runOnMainThreadLater(backoff, () -> mark(player, attempt + 1));
  }

  /**
   * On join: restores a snapshot left by a crash (after respawning, if dead), and hands out loot.
   */
  void recover(Player player) {
    if (restore(player)) {
      if (!player.isDead()) {
        texts.notice(player, Notice.of(NoticeKind.RESTORED));
      }
    } else {
      deliver(player);
    }
  }

  /** The player respawned: restore them if their restore waited for it. */
  void respawned(Player player) {
    if (restoreOnRespawn.remove(player.getUniqueId())) {
      recover(player);
    }
  }

  /** Whether {@code player}'s restore waits for them to respawn. */
  boolean waitsForRespawn(UUID player) {
    return restoreOnRespawn.contains(player);
  }

  private void apply(Player player, Snapshot snapshot) {
    if (!PlayerStates.apply(player, snapshot, runtime.server())) {
      runtime
          .logger()
          .error(
              "{}'s snapshot names world {}, which is gone; they stay where they are",
              player.getName(),
              snapshot.position().world());
    }
  }

  /**
   * Hands {@code player} the vault loot waiting for them. The loot is claimed (read and removed in
   * one transaction) before anything is given, and put back if they cannot take it now.
   */
  void deliver(Player player) {
    var id = player.getUniqueId();
    if (!delivering.add(id)) {
      return;
    }
    var _ =
        rewards
            .claimAll(id)
            .whenCompleteAsync(
                (claimed, failure) -> {
                  delivering.remove(id);
                  if (failure != null) {
                    runtime.logger().error("Could not claim waiting vault loot", failure);
                  } else {
                    runtime.guarded(
                        "handing out vault loot to " + player.getName(),
                        () -> handOut(player, claimed));
                  }
                },
                runtime.mainThread());
  }

  private void handOut(Player player, List<RewardStore.PendingReward> claimed) {
    if (claimed.isEmpty()) {
      return;
    }
    var id = player.getUniqueId();
    if (!player.isOnline() || player.isDead() || runtime.inArena(id)) {
      runtime.logFailure(
          rewards.requeue(id, claimed, runtime.time().instant()),
          "put back vault loot for " + player.getName());
      return;
    }
    for (var reward : claimed) {
      var items =
          Arrays.stream(ItemStack.deserializeItemsFromBytes(reward.items().bytes()))
              .filter(item -> !item.isEmpty())
              .toArray(ItemStack[]::new);
      var leftovers = player.getInventory().addItem(items);
      leftovers.values().forEach(item -> player.getWorld().dropItem(Places.at(player), item));
    }
    texts.notice(player, Notice.of(NoticeKind.VAULT_DELIVERED));
  }

  /** Whether {@code player} has a snapshot waiting to be restored. */
  boolean holds(UUID player) {
    return book.holds(player);
  }
}
