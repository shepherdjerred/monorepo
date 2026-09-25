package com.shepherdjerred.thestorm.shards.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The configured altars and the per-player attempt cooldown.
 *
 * <p>The cooldown stops one click from paying twice. Paper deduplicates a right-click that fires
 * for both hands only while the held item is unchanged, so after a successful upgrade (the item
 * changed) a second event can arrive in the same tick, and holding right-click repeats every four
 * ticks. Each player gets one attempt per window; the check runs before anything is consumed.
 */
public final class Altars {

  private final List<AltarLocation> locations;
  private final Duration cooldown;
  private final Map<UUID, Instant> lastAttempt = new HashMap<>();

  public Altars(List<AltarLocation> locations, Duration cooldown) {
    if (cooldown.isNegative() || cooldown.isZero()) {
      throw new IllegalArgumentException("altar cooldown must be positive: " + cooldown);
    }
    this.locations = List.copyOf(locations);
    this.cooldown = cooldown;
  }

  /** Whether {@code block} of {@code material} is one of the altars. */
  public boolean isAltar(BlockPos block, String material) {
    return locations.stream().anyMatch(altar -> altar.is(block, material));
  }

  /**
   * Claims {@code player}'s attempt at {@code now}: true when the last claimed attempt is at least
   * the cooldown ago (or there was none), false while still cooling down. A refused claim does not
   * extend the window.
   */
  public boolean tryAttempt(UUID player, Instant now) {
    lastAttempt.values().removeIf(at -> !now.isBefore(at.plus(cooldown)));
    if (lastAttempt.containsKey(player)) {
      return false;
    }
    lastAttempt.put(player, now);
    return true;
  }
}
