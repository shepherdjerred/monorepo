package com.shepherdjerred.thestorm.towns.app;

import java.util.OptionalInt;
import java.util.UUID;

/**
 * Players' Governor levels as the tracks module knows them now. Main thread only; it only knows
 * players who are online.
 */
@FunctionalInterface
public interface OwnerLevels {

  /** {@code player}'s Governor level, or empty when they are offline. */
  OptionalInt liveLevel(UUID player);
}
