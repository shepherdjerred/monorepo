package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.app.store.SnapshotStore;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import com.shepherdjerred.thestorm.arena.domain.snapshot.SnapshotBook;
import java.time.Duration;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
 * snapshot back with a matching player-data marker. The database copy stays unrestored until a
 * later login proves that Paper persisted the marker and belongings together.
 */
final class Snapshots {

  /** How many times marking a restored snapshot is tried. */
  private static final int MARK_ATTEMPTS = 6;

  private final PaperContext runtime;
  private final SnapshotStore store;
  private final RewardStore rewards;
  private final Texts texts;
  private final RestoreMarker marker;
  private final VaultReceipt vaultReceipt;
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> settlingRewards = new HashSet<>();
  private final Set<UUID> restoreOnRespawn = new HashSet<>();
  private final Set<UUID> restoring = new HashSet<>();
  private final Set<UUID> joinedFromDisk = new HashSet<>();
  private final Set<UUID> loadedFromStore = new HashSet<>();
  private final Set<UUID> marking = new HashSet<>();
  private final Map<UUID, Snapshot> awaitingProof = new HashMap<>();
  private SnapshotBook book = SnapshotBook.UNLOADED;

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
    this.store = parts.store();
    this.rewards = parts.rewards();
    this.texts = parts.texts();
    this.marker = new RestoreMarker(runtime.plugin());
    this.vaultReceipt = new VaultReceipt(runtime.plugin());
  }

  /**
   * Reads back the snapshots a crash left behind, then restores every online player who has one and
   * is not in an arena.
   */
  void load(Predicate<UUID> inArena) {
    runtime.onMain(
        store.loadAll(),
        stored -> {
          stored.forEach(snapshot -> loadedFromStore.add(snapshot.player()));
          book = book.withLoaded(stored);
          if (!stored.isEmpty()) {
            runtime.logger().warn("{} arena snapshots were left by the last run", stored.size());
          }
          for (var player : runtime.server().getOnlinePlayers()) {
            if (!inArena.test(player.getUniqueId())) {
              recover(player, joinedFromDisk.contains(player.getUniqueId()));
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
    if (!PlayerStates.settle(player)) {
      done.accept(false);
      return;
    }
    var snapshot = PlayerStates.capture(player, arena, runtime.time().instant());
    loadedFromStore.remove(player.getUniqueId());
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
      restoreFailedCapture(player);
    }
    done.accept(false);
  }

  /**
   * A snapshot finished storing after its player left the arena. It remains in the database until a
   * later login proves that the restored player data reached disk.
   */
  void forget(UUID player) {
    runtime
        .logger()
        .debug("Keeping arena snapshot of {} until player data confirms restore", player);
  }

  /**
   * Restores {@code player}'s snapshot if they have one, and hands out vault loot waiting for them.
   * Returns false if there was nothing to restore. A dead player is restored once they respawn.
   *
   * <p>The marker is written after all belongings have been applied. Paper saves them in the same
   * player data record. If a crash happens first, the next login replays this snapshot; if the
   * marker survived, the database row can be retired without applying it again.
   */
  boolean restore(Player player) {
    return restore(player, false);
  }

  private boolean restore(Player player, boolean loadedFromDisk) {
    var id = player.getUniqueId();
    if (!book.holds(id)) {
      return false;
    }
    if (player.isDead()) {
      restoreOnRespawn.add(id);
      return true;
    }
    var snapshot = book.held().get(id);
    if (snapshot == null) {
      throw new IllegalStateException("held arena snapshot disappeared for " + id);
    }
    if (loadedFromStore.contains(id) && marker.matches(player, snapshot)) {
      awaitProof(snapshot);
      if (loadedFromDisk) {
        mark(player, 1);
      }
      deliver(player);
      return true;
    }
    awaitProof(snapshot);
    PlayerStates.discardHeld(player);
    restoring.add(id);
    try {
      apply(player, snapshot);
      marker.record(player, snapshot);
    } finally {
      restoring.remove(id);
    }
    deliver(player);
    return true;
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

  /** Whether {@code player} is being put back right now: their restore teleport is allowed. */
  boolean restoring(UUID player) {
    return restoring.contains(player);
  }

  /** Retires a snapshot after a fresh login proved its marker reached player data. */
  private void mark(Player player, int attempt) {
    var id = player.getUniqueId();
    if (attempt == 1 && !marking.add(id)) {
      return;
    }
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
    if (failure == null) {
      marking.remove(id);
      awaitingProof.remove(id);
      book = book.cleaned(id);
      runtime.logFailure(
          store.deleteRestored(id), "delete the restored arena snapshot of " + player.getName());
      return;
    }
    if (attempt >= MARK_ATTEMPTS) {
      marking.remove(id);
      runtime
          .logger()
          .error(
              "GAVE UP marking the arena snapshot of {} restored after {} attempts; the player"
                  + " cannot re-enter an arena until a later login retries cleanup.",
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
    recover(player, true);
  }

  /** Rechecks a player already online, without treating the in-memory marker as disk proof. */
  void recoverWhileOnline(Player player) {
    recover(player, false);
  }

  private void recover(Player player, boolean loadedFromDisk) {
    var id = player.getUniqueId();
    if (loadedFromDisk) {
      joinedFromDisk.add(id);
      settleRewards(player);
    }
    var pending = awaitingProof.get(id);
    if (pending != null) {
      if (loadedFromDisk && marker.matches(player, pending)) {
        mark(player, 1);
      } else if (loadedFromDisk) {
        restoring.add(id);
        try {
          apply(player, pending);
          marker.record(player, pending);
        } finally {
          restoring.remove(id);
        }
      }
      deliver(player);
      return;
    }
    if (restore(player, loadedFromDisk)) {
      if (!player.isDead()) {
        texts.notice(player, Notice.of(NoticeKind.RESTORED));
      }
    } else {
      deliver(player);
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
    if (restoreOnRespawn.remove(player.getUniqueId())) {
      recoverWhileOnline(player);
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
    return book.holds(player);
  }
}
