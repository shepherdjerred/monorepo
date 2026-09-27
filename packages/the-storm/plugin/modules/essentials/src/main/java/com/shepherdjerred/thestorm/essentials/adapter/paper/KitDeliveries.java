package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore;
import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore.PendingKit;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Delivers durable kit claims to an online player, one at a time on the main thread. */
final class KitDeliveries {

  private static final Duration ACK_RETRY = Duration.ofSeconds(5);

  private final PaperRuntime runtime;
  private final KitClaimStore claims;
  private final KitItems items;
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> rerun = new HashSet<>();

  KitDeliveries(PaperRuntime runtime, KitClaimStore claims, KitItems items) {
    this.runtime = runtime;
    this.claims = claims;
    this.items = items;
  }

  /** Checks what is owed now or on the next join if the player has disconnected. Main thread. */
  void deliver(UUID player) {
    if (!delivering.add(player)) {
      rerun.add(player);
      return;
    }
    if (runtime.server().getPlayer(player) == null) {
      finished(player);
      return;
    }
    runtime.onMain(
        claims.pending(player),
        "loading pending kits",
        pending -> next(player, pending, 0),
        failure -> finished(player));
  }

  private void next(UUID player, List<PendingKit> pending, int index) {
    if (index >= pending.size()) {
      finished(player);
      return;
    }
    var online = runtime.server().getPlayer(player);
    if (online == null) {
      finished(player);
      return;
    }
    var kit = pending.get(index);
    try {
      items.give(online, kit.name());
    } catch (RuntimeException failure) {
      runtime.report("delivering kit " + kit.name() + " to " + player, failure);
      finished(player);
      return;
    }
    Say.success(online, Say.KITS, "You received the " + kit.name() + " kit.");
    acknowledge(player, pending, index);
  }

  private void acknowledge(UUID player, List<PendingKit> pending, int index) {
    var kit = pending.get(index);
    runtime.onMain(
        claims.acknowledge(player, kit),
        "acknowledging kit " + kit.name(),
        ignored -> next(player, pending, index + 1),
        failure -> {
          var _ =
              runtime
                  .scheduler()
                  .runOnMainThreadLater(ACK_RETRY, () -> acknowledge(player, pending, index));
        });
  }

  private void finished(UUID player) {
    delivering.remove(player);
    if (rerun.remove(player)) {
      deliver(player);
    }
  }
}
