package com.shepherdjerred.thestorm.essentials.app;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.entity.Player;

/**
 * Tells the rest of the server when a new player's spawn teleport has finished. Main thread only. A
 * player who already played is never marked ready here; callers that still need the dialog show it
 * themselves.
 */
public final class NewcomerPlacements {
  private final Set<UUID> ready = new HashSet<>();
  private final Map<UUID, List<Consumer<Player>>> waiting = new HashMap<>();

  /** The spawn teleport finished, or it could not run. Queued actions run now. */
  public void ready(Player player) {
    var id = player.getUniqueId();
    ready.add(id);
    var queued = waiting.remove(id);
    if (queued != null) {
      for (var action : queued) {
        action.accept(player);
      }
    }
  }

  /** Runs {@code action} now when placement already finished, otherwise after {@link #ready}. */
  public void whenReady(Player player, Consumer<Player> action) {
    var id = player.getUniqueId();
    if (ready.contains(id)) {
      action.accept(player);
      return;
    }
    waiting.computeIfAbsent(id, ignored -> new ArrayList<>()).add(action);
    if (ready.contains(id)) {
      var queued = waiting.remove(id);
      if (queued != null) {
        for (var queuedAction : queued) {
          queuedAction.accept(player);
        }
      }
    }
  }

  public void left(UUID player) {
    ready.remove(player);
    waiting.remove(player);
  }
}
