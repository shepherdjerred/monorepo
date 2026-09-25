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

/**
 * Every arena's snapshots, and the vault loot waiting for players outside. Main thread only.
 *
 * <p>Joining takes the snapshot and empties the player in the same tick, keeping the snapshot in
 * the book, then stores it; if storing fails the player is put back from memory. Restoring puts the
 * snapshot back, saves the player's data, and only then deletes the stored snapshot (retrying with
 * backoff), so a crash at any point leaves either the player's belongings or their snapshot.
 */
final class Snapshots {

  /** How many times a failed snapshot delete is retried. */
  private static final int DELETE_ATTEMPTS = 6;

  private final PaperContext runtime;
  private final SnapshotStore store;
  private final RewardStore rewards;
  private final Texts texts;
  private final PlayerSaver saver;
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> restoreOnRespawn = new HashSet<>();
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
                (saved, failure) -> {
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
                },
                runtime.mainThread());
  }

  /**
   * Deletes a stored snapshot that was already restored from memory (the player left while it was
   * being written).
   */
  void forget(UUID player) {
    if (book.holds(player)) {
      throw new IllegalStateException(player + "'s snapshot is still held; restore it instead");
    }
    runtime.logFailure(store.delete(player), "delete the arena snapshot of " + player);
  }

  /**
   * Restores {@code player}'s snapshot if they have one: puts it back, saves the player's data,
   * then deletes the stored snapshot, and hands out vault loot waiting for them. Returns false if
   * there was nothing to restore. A dead player is restored once they respawn.
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
    apply(player, taken.snapshot().orElseThrow());
    saver.save(player);
    delete(id, 1);
    deliver(player);
    return true;
  }

  /** Deletes a restored player's stored snapshot, retrying with backoff; loud when it fails. */
  private void delete(UUID player, int attempt) {
    var _ =
        store
            .delete(player)
            .whenCompleteAsync(
                (done, failure) -> {
                  if (failure == null) {
                    book = book.cleaned(player);
                    return;
                  }
                  if (attempt >= DELETE_ATTEMPTS) {
                    runtime
                        .logger()
                        .error(
                            "GAVE UP deleting the restored arena snapshot of {} after {} attempts;"
                                + " it will be restored again when they next join after a restart."
                                + " Delete it from arena_snapshots by hand.",
                            player,
                            attempt,
                            failure);
                    return;
                  }
                  var backoff = Duration.ofSeconds(1L << attempt);
                  runtime
                      .logger()
                      .error(
                          "Could not delete the restored arena snapshot of {} (attempt {});"
                              + " retrying in {}",
                          player,
                          attempt,
                          backoff,
                          failure);
                  var _ =
                      runtime
                          .scheduler()
                          .runOnMainThreadLater(backoff, () -> delete(player, attempt + 1));
                },
                runtime.mainThread());
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
                    handOut(player, claimed);
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
