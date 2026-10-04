package com.shepherdjerred.thestorm.arena.domain.survival;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * A deliberate second click on the same fixture; duplicate hand events never confirm a purchase.
 */
public final class PurchaseConfirmation {
  private record Click(String id, Instant at) {}

  private final Map<UUID, Click> pending = new HashMap<>();

  public boolean confirm(UUID player, String fixture, Instant now) {
    var before = pending.get(player);
    if (before != null
        && before.id().equals(fixture)
        && !now.isBefore(before.at().plusMillis(200))
        && !now.isAfter(before.at().plusSeconds(3))) {
      pending.remove(player);
      return true;
    }
    if (before == null || !before.id().equals(fixture) || now.isAfter(before.at().plusSeconds(3))) {
      pending.put(player, new Click(fixture, now));
    }
    return false;
  }

  public void remove(UUID player) {
    pending.remove(player);
  }
}
