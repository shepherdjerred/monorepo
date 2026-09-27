package com.shepherdjerred.thestorm.qol.app;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

/**
 * Whether players are in combat, published by qol for other modules (for example to keep a dialog
 * or a spell from being used as an escape). Main thread only.
 */
public interface CombatStatus {

  /** How long {@code player} stays in combat, or empty if they are not in combat. */
  Optional<Duration> remaining(UUID player);

  default boolean inCombat(UUID player) {
    return remaining(player).isPresent();
  }
}
