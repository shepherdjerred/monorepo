package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;

/** Standing still before a teleport. Moving a block or taking damage cancels it. */
final class Warmups {

  private final Scheduler scheduler;
  private final Map<UUID, Pending> pending = new HashMap<>();

  Warmups(Scheduler scheduler) {
    this.scheduler = scheduler;
  }

  /** Runs {@code success} after {@code warmup} unless the player moves or is hurt. */
  void start(Player player, Duration warmup, Runnable success, Runnable cancel) {
    if (warmup.isZero()) {
      success.run();
      return;
    }
    var from = player.getLocation();
    if (from == null) {
      throw new IllegalStateException("player " + player.getName() + " has no location");
    }
    var id = player.getUniqueId();
    var task =
        scheduler.runOnMainThreadLater(
            warmup,
            () -> {
              pending.remove(id);
              if (player.isOnline()) {
                success.run();
              } else {
                cancel.run();
              }
            });
    pending.put(
        id, new Pending(from.getBlockX(), from.getBlockY(), from.getBlockZ(), task, cancel));
  }

  /** Cancels the warmup when the player has changed block. */
  void moved(Player player) {
    var waiting = pending.get(player.getUniqueId());
    if (waiting == null) {
      return;
    }
    var at = player.getLocation();
    if (at == null) {
      throw new IllegalStateException("player " + player.getName() + " has no location");
    }
    if (at.getBlockX() != waiting.x()
        || at.getBlockY() != waiting.y()
        || at.getBlockZ() != waiting.z()) {
      cancel(player.getUniqueId());
    }
  }

  /** Cancels the warmup. */
  void hurt(UUID player) {
    cancel(player);
  }

  private void cancel(UUID player) {
    var waiting = pending.remove(player);
    if (waiting == null) {
      return;
    }
    waiting.task().cancel();
    waiting.cancel().run();
  }

  private record Pending(int x, int y, int z, Cancellable task, Runnable cancel) {}
}
