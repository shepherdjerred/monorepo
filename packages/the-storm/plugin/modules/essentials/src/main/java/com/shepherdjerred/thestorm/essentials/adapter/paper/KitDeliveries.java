package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore;
import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore.PendingKit;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Delivers durable kit claims to an online player, one at a time on the main thread. */
final class KitDeliveries {

  private static final Duration ACK_RETRY = Duration.ofSeconds(5);

  private final PaperRuntime runtime;
  private final KitClaimStore claims;
  private final KitItems items;
  private final Plugin plugin;
  private final Set<UUID> delivering = new HashSet<>();
  private final Set<UUID> rerun = new HashSet<>();
  private final Map<UUID, Set<PendingKit>> deliveredThisSession = new HashMap<>();

  KitDeliveries(PaperRuntime runtime, KitClaimStore claims, KitItems items, Plugin plugin) {
    this.runtime = runtime;
    this.claims = claims;
    this.items = items;
    this.plugin = plugin;
  }

  /** Forget only volatile delivery guards. The player's inventory and marker save together. */
  void quit(UUID player) {
    deliveredThisSession.remove(player);
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
    if (deliveredThisSession.getOrDefault(player, Set.of()).contains(kit)) {
      next(player, pending, index + 1);
      return;
    }
    var marker = new NamespacedKey(plugin, "kit_delivery_" + kit.name());
    var persistedAt = online.getPersistentDataContainer().get(marker, PersistentDataType.LONG);
    if (persistedAt != null && persistedAt >= kit.claimedAt().toEpochMilli()) {
      acknowledge(player, pending, index);
      return;
    }
    try {
      if (!items.give(online, kit.name())) {
        Say.error(
            online, Say.STORM, "Make room in your inventory to receive your starter supplies.");
        finished(player);
        return;
      }
    } catch (RuntimeException failure) {
      runtime.report("delivering kit " + kit.name() + " to " + player, failure);
      finished(player);
      return;
    }
    online
        .getPersistentDataContainer()
        .set(marker, PersistentDataType.LONG, kit.claimedAt().toEpochMilli());
    deliveredThisSession.computeIfAbsent(player, ignored -> new HashSet<>()).add(kit);
    next(player, pending, index + 1);
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
