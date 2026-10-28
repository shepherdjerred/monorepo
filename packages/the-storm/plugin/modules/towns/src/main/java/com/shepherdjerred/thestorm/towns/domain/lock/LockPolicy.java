package com.shepherdjerred.thestorm.towns.domain.lock;

/**
 * How locks behave, from {@code towns.yml}.
 *
 * @param maxPerPlayer the most locks one player may hold, automatic ones included; a double chest
 *     counts once
 * @param autoLockOnPlace true when every container, door, trapdoor, gate, item frame or armor stand
 *     a player places is locked for them at once
 * @param autocloseSeconds how long an iron door stays open, and how long any door stays open when
 *     its autoclose flag is on
 * @param lockCost crystals charged for a new lock; zero charges nothing
 * @param magnetRadius how many blocks a magnet lock pulls dropped items from
 * @param expireDays how long a lock may go unopened before an admin expiry removes it
 */
public record LockPolicy(
    int maxPerPlayer,
    boolean autoLockOnPlace,
    int autocloseSeconds,
    long lockCost,
    int magnetRadius,
    int expireDays) {

  /** Callers that predate the autoclose delay use two seconds and no fee. */
  public LockPolicy(int maxPerPlayer, boolean autoLockOnPlace) {
    this(maxPerPlayer, autoLockOnPlace, 2);
  }

  /** Callers that predate the fee, magnet radius and expiry use no fee, 3 blocks and 30 days. */
  public LockPolicy(int maxPerPlayer, boolean autoLockOnPlace, int autocloseSeconds) {
    this(maxPerPlayer, autoLockOnPlace, autocloseSeconds, 0, 3, 30);
  }

  public LockPolicy {
    if (maxPerPlayer < 1) {
      throw new IllegalArgumentException("maxPerPlayer must be at least 1");
    }
    if (autocloseSeconds < 1 || autocloseSeconds > 60) {
      throw new IllegalArgumentException("autocloseSeconds must be 1..60: " + autocloseSeconds);
    }
    if (lockCost < 0) {
      throw new IllegalArgumentException("lockCost must not be negative: " + lockCost);
    }
    if (magnetRadius < 1 || magnetRadius > 16) {
      throw new IllegalArgumentException("magnetRadius must be 1..16: " + magnetRadius);
    }
    if (expireDays < 1 || expireDays > 3650) {
      throw new IllegalArgumentException("expireDays must be 1..3650: " + expireDays);
    }
  }
}
