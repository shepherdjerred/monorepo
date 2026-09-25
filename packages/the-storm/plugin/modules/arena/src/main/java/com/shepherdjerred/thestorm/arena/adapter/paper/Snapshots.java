package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.app.store.SnapshotStore;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import com.shepherdjerred.thestorm.arena.domain.snapshot.SnapshotBook;
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
 * Every arena's snapshots, and the vault loot waiting for players outside. A snapshot is written to
 * storage before anything of the player's is cleared, and taken out of the book exactly once when
 * it is restored. Main thread only.
 */
final class Snapshots {

  private final PaperContext runtime;
  private final SnapshotStore store;
  private final RewardStore rewards;
  private final Texts texts;
  private final Set<UUID> delivering = new HashSet<>();
  private SnapshotBook book = SnapshotBook.UNLOADED;

  Snapshots(PaperContext runtime, SnapshotStore store, RewardStore rewards, Texts texts) {
    this.runtime = runtime;
    this.store = store;
    this.rewards = rewards;
    this.texts = texts;
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

  /** Takes and stores a snapshot, calling {@code done} on the main thread with whether it stuck. */
  void capture(Player player, String arena, Consumer<Boolean> done) {
    var snapshot = PlayerStates.capture(player, arena, runtime.time().instant());
    var _ =
        store
            .save(snapshot)
            .whenCompleteAsync(
                (saved, failure) -> {
                  if (failure != null) {
                    runtime
                        .logger()
                        .error(
                            "Could not store the arena snapshot of {}", player.getName(), failure);
                    done.accept(false);
                  } else {
                    book = book.withStored(snapshot);
                    done.accept(true);
                  }
                },
                runtime.mainThread());
  }

  /** Drops a stored snapshot without restoring it: nothing of the player's was touched. */
  void forget(UUID player) {
    book = book.take(player).book();
    runtime.logFailure(store.delete(player), "delete the arena snapshot of " + player);
  }

  /**
   * Restores {@code player}'s snapshot if they have one, then hands out vault loot waiting for
   * them. Returns false if there was nothing to restore.
   */
  boolean restore(Player player) {
    var taken = book.take(player.getUniqueId());
    if (taken.snapshot().isEmpty()) {
      return false;
    }
    book = taken.book();
    apply(player, taken.snapshot().orElseThrow());
    runtime.logFailure(
        store.delete(player.getUniqueId()), "delete the arena snapshot of " + player.getName());
    deliver(player);
    return true;
  }

  /** On join: restores a snapshot left by a crash, and hands out waiting loot. */
  void recover(Player player) {
    if (restore(player)) {
      texts.notice(player, Notice.of(NoticeKind.RESTORED));
    } else {
      deliver(player);
    }
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

  /** Hands {@code player} the vault loot waiting for them, dropping what does not fit. */
  void deliver(Player player) {
    var id = player.getUniqueId();
    if (!delivering.add(id)) {
      return;
    }
    var _ =
        rewards
            .pending(id)
            .whenCompleteAsync(
                (waiting, failure) -> {
                  delivering.remove(id);
                  if (failure != null) {
                    runtime.logger().error("Could not read waiting vault loot", failure);
                  } else {
                    handOut(player, waiting);
                  }
                },
                runtime.mainThread());
  }

  private void handOut(Player player, List<RewardStore.PendingReward> waiting) {
    if (waiting.isEmpty() || !player.isOnline() || runtime.inArena(player.getUniqueId())) {
      return;
    }
    for (var reward : waiting) {
      var items =
          Arrays.stream(ItemStack.deserializeItemsFromBytes(reward.items().bytes()))
              .filter(item -> !item.isEmpty())
              .toArray(ItemStack[]::new);
      var leftovers = player.getInventory().addItem(items);
      leftovers.values().forEach(item -> player.getWorld().dropItem(Places.at(player), item));
      runtime.logFailure(rewards.delivered(reward.id()), "mark a vault reward delivered");
    }
    texts.notice(player, Notice.of(NoticeKind.VAULT_DELIVERED));
  }

  /** Whether {@code player} has a snapshot waiting to be restored. */
  boolean holds(UUID player) {
    return book.holds(player);
  }
}
