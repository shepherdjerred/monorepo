package com.shepherdjerred.thestorm.quests.domain.engine;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Tracks recent play so nearby idle accounts do not share quest credit. */
public final class PartyActivity {

  private final Map<UUID, Instant> lastActive = new HashMap<>();

  /** The player joined, moved, or acted at {@code now}. */
  public void acted(UUID player, Instant now) {
    lastActive.put(player, now);
  }

  /** Whether the player acted within {@code window} before {@code now}. */
  public boolean active(UUID player, Instant now, Duration window) {
    var last = lastActive.get(player);
    return last != null && !last.plus(window).isBefore(now);
  }

  /** Discards state when the player quits. */
  public void forget(UUID player) {
    lastActive.remove(player);
  }
}
