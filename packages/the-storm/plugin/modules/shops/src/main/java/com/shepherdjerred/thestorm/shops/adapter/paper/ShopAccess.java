package com.shepherdjerred.thestorm.shops.adapter.paper;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Players who turned on trading at shops whose stock they may open, including their own. Forgotten
 * when they leave.
 */
final class ShopAccess {

  private final Set<UUID> trading = ConcurrentHashMap.newKeySet();

  /** Turns trading on, or back off. Returns true when it is now on. */
  boolean toggle(UUID player) {
    if (!trading.add(player)) {
      trading.remove(player);
      return false;
    }
    return true;
  }

  boolean enabled(UUID player) {
    return trading.contains(player);
  }

  void restore(UUID player, boolean enabled) {
    if (enabled) trading.add(player);
    else trading.remove(player);
  }

  void forget(UUID player) {
    trading.remove(player);
  }
}
