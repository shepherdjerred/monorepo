package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.snapshot.RestoreMarker;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotBook;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotKeeper;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotStore;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Predicate;
import org.bukkit.entity.Player;

/**
 * The match's snapshots of human players: core's {@link SnapshotKeeper} over rwf's own table and
 * marker key, plus the match's own notices. Main thread only.
 */
final class Snapshots {

  /** The scope every rwf snapshot is taken for. */
  static final String SCOPE = "rwf";

  private final PaperContext runtime;
  private final SnapshotKeeper keeper;

  Snapshots(PaperContext runtime, SnapshotStore store) {
    this.runtime = runtime;
    this.keeper =
        new SnapshotKeeper(
            new SnapshotKeeper.Parts(
                runtime.plugin(),
                runtime.scheduler(),
                runtime.time(),
                store,
                new RestoreMarker(runtime.plugin(), "rwf_restored_snapshot")));
  }

  /**
   * Reads back the snapshots a crash left behind, then restores every online player who has one and
   * is not in the match.
   */
  void load(Predicate<UUID> inMatch, Runnable loaded) {
    keeper.load(
        () -> {
          for (var player : runtime.server().getOnlinePlayers()) {
            if (!inMatch.test(player.getUniqueId())) {
              recover(player, keeper.joinedFromDisk(player.getUniqueId()));
            }
          }
          loaded.run();
        });
  }

  Optional<SnapshotBook.Refusal> refusal(UUID player) {
    return keeper.refusal(player);
  }

  /**
   * Takes a snapshot and empties the player in this same tick, then stores the snapshot. {@code
   * done} runs on the main thread with whether it was stored; if not, the player has already been
   * put back from memory.
   */
  void capture(Player player, Consumer<Boolean> done) {
    keeper.capture(player, SCOPE, done);
  }

  /** Restores {@code player}'s snapshot if they have one; a dead player once they respawn. */
  SnapshotKeeper.Outcome restore(Player player) {
    return keeper.restore(player);
  }

  /** Whether {@code player} is being put back right now: their restore teleport is allowed. */
  boolean restoring(UUID player) {
    return keeper.restoring(player);
  }

  /** On join: restores a snapshot left by a crash (after respawning, if dead). */
  void recover(Player player) {
    recover(player, true);
  }

  /** Rechecks a player already online, without treating the in-memory marker as disk proof. */
  void recoverWhileOnline(Player player) {
    recover(player, false);
  }

  private void recover(Player player, boolean loadedFromDisk) {
    if (keeper.recover(player, loadedFromDisk) == SnapshotKeeper.Outcome.RESTORED) {
      Texts.success(player, "Your belongings from your last match are back.");
    }
  }

  /** The player respawned: restore them if their restore waited for it. */
  void respawned(Player player) {
    if (keeper.respawned(player.getUniqueId())) {
      recoverWhileOnline(player);
    }
  }

  boolean waitsForRespawn(UUID player) {
    return keeper.waitsForRespawn(player);
  }

  boolean holds(UUID player) {
    return keeper.holds(player);
  }
}
