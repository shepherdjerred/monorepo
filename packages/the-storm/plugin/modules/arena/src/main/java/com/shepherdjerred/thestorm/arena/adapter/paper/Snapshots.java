package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import com.shepherdjerred.thestorm.core.snapshot.RestoreMarker;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotBook;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotKeeper;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotStore;
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
 * <p>The snapshot lifecycle itself is core's {@link SnapshotKeeper} over the arena's own table and
 * marker key; this adds the arena's notices and hands out vault loot whenever a player stands
 * outside with their belongings back.
 */
final class Snapshots {

  private final PaperContext runtime;
  private final SnapshotKeeper keeper;
  private final RewardStore rewards;
  private final Texts texts;
  private final VaultReceipt vaultReceipt;
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> settlingRewards = new HashSet<>();

  /**
   * What the snapshots are kept with.
   *
   * @param store stored snapshots
   * @param rewards waiting vault loot
   * @param texts messages
   */
  record Parts(SnapshotStore store, RewardStore rewards, Texts texts) {}

  Snapshots(PaperContext runtime, Parts parts) {
    this.runtime = runtime;
    this.keeper =
        new SnapshotKeeper(
            new SnapshotKeeper.Parts(
                runtime.plugin(),
                runtime.scheduler(),
                runtime.time(),
                parts.store(),
                new RestoreMarker(runtime.plugin(), "arena_restored_snapshot")));
    this.rewards = parts.rewards();
    this.texts = parts.texts();
    this.vaultReceipt = new VaultReceipt(runtime.plugin());
  }

  /**
   * Reads back the snapshots a crash left behind, then restores every online player who has one and
   * is not in an arena.
   */
  void load(Predicate<UUID> inArena) {
    keeper.load(
        () -> {
          for (var player : runtime.server().getOnlinePlayers()) {
            if (!inArena.test(player.getUniqueId())) {
              recover(player, keeper.joinedFromDisk(player.getUniqueId()));
            }
          }
        });
  }

  /** Why a new snapshot of {@code player} cannot be taken yet, if it cannot. */
  Optional<SnapshotBook.Refusal> refusal(UUID player) {
    return keeper.refusal(player);
  }

  /**
   * Takes a snapshot and empties the player in this same tick, then stores the snapshot. {@code
   * done} runs on the main thread with whether it was stored; if not, the player has already been
   * put back from memory.
   */
  void capture(Player player, String arena, Consumer<Boolean> done) {
    keeper.capture(player, arena, done);
  }

  /**
   * A snapshot finished storing after its player left the arena. It remains in the database until a
   * later login proves that the restored player data reached disk.
   */
  void forget(UUID player) {
    keeper.forget(player);
  }

  /**
   * Restores {@code player}'s snapshot if they have one, and hands out vault loot waiting for them.
   * Returns false if there was nothing to restore. A dead player is restored once they respawn.
   */
  boolean restore(Player player) {
    var outcome = keeper.restore(player);
    if (outcome == SnapshotKeeper.Outcome.RESTORED) {
      deliver(player);
    }
    return outcome != SnapshotKeeper.Outcome.NOTHING;
  }

  /** Whether {@code player} is being put back right now: their restore teleport is allowed. */
  boolean restoring(UUID player) {
    return keeper.restoring(player);
  }

  /**
   * On join: restores a snapshot left by a crash (after respawning, if dead), and hands out loot.
   */
  void recover(Player player) {
    recover(player, true);
  }

  /** Rechecks a player already online, without treating the in-memory marker as disk proof. */
  void recoverWhileOnline(Player player) {
    recover(player, false);
  }

  private void recover(Player player, boolean loadedFromDisk) {
    if (loadedFromDisk) {
      settleRewards(player);
    }
    switch (keeper.recover(player, loadedFromDisk)) {
      case RESTORED -> {
        deliver(player);
        texts.notice(player, Notice.of(NoticeKind.RESTORED));
      }
      case PROOF_PENDING, NOTHING -> deliver(player);
      case AWAITING_RESPAWN -> {
        // Restored once they respawn.
      }
    }
  }

  /** A fresh login proves both the inventory and receipt survived the player-data save. */
  private void settleRewards(Player player) {
    var ids = vaultReceipt.ids(player);
    if (ids.isEmpty() || !settlingRewards.add(player.getUniqueId())) {
      return;
    }
    var _ =
        rewards
            .acknowledge(player.getUniqueId(), ids)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  settlingRewards.remove(player.getUniqueId());
                  if (failure != null) {
                    runtime.logger().error("Could not acknowledge saved vault loot", failure);
                    return;
                  }
                  if (player.isOnline()) {
                    vaultReceipt.clear(player, ids);
                    deliver(player);
                  }
                },
                runtime.mainThread());
  }

  /** The player respawned: restore them if their restore waited for it. */
  void respawned(Player player) {
    if (keeper.respawned(player.getUniqueId())) {
      recoverWhileOnline(player);
    }
  }

  /** Whether {@code player}'s restore waits for them to respawn. */
  boolean waitsForRespawn(UUID player) {
    return keeper.waitsForRespawn(player);
  }

  /**
   * Hands {@code player} whole reward rows that fit. The rows stay durable until the player logs in
   * again with matching receipts saved alongside their inventory.
   */
  void deliver(Player player) {
    var id = player.getUniqueId();
    if (settlingRewards.contains(id) || !delivering.add(id)) {
      return;
    }
    var _ =
        rewards
            .pending(id)
            .whenCompleteAsync(
                (pending, failure) -> {
                  delivering.remove(id);
                  if (failure != null) {
                    runtime.logger().error("Could not read waiting vault loot", failure);
                  } else {
                    runtime.guarded(
                        "handing out vault loot to " + player.getName(),
                        () -> handOut(player, pending));
                  }
                },
                runtime.mainThread());
  }

  private void handOut(Player player, List<RewardStore.PendingReward> pending) {
    if (pending.isEmpty()) {
      return;
    }
    var id = player.getUniqueId();
    if (!player.isOnline() || player.isDead() || runtime.inArena(id)) {
      return;
    }
    var recorded = vaultReceipt.ids(player);
    var delivered = false;
    for (var reward : pending) {
      if (recorded.contains(reward.id())) {
        continue;
      }
      var items =
          Arrays.stream(ItemStack.deserializeItemsFromBytes(reward.items().bytes()))
              .filter(item -> !item.isEmpty())
              .toArray(ItemStack[]::new);
      var before =
          Arrays.stream(player.getInventory().getStorageContents())
              .map(item -> item == null ? null : item.clone())
              .toArray(ItemStack[]::new);
      var leftovers = player.getInventory().addItem(items);
      if (!leftovers.isEmpty()) {
        player.getInventory().setStorageContents(before);
        continue;
      }
      try {
        vaultReceipt.record(player, reward.id());
      } catch (RuntimeException failure) {
        player.getInventory().setStorageContents(before);
        throw failure;
      }
      delivered = true;
    }
    if (delivered) {
      texts.notice(player, Notice.of(NoticeKind.VAULT_DELIVERED));
    }
  }

  /** Whether {@code player} has a snapshot waiting to be restored. */
  boolean holds(UUID player) {
    return keeper.holds(player);
  }
}
