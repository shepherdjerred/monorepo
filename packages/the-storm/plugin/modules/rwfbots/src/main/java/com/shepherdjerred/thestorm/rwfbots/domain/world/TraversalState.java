package com.shepherdjerred.thestorm.rwfbots.domain.world;

/**
 * Actual movement and survival capabilities captured from the body, never inferred from a kit
 * approximation. Expiries use the snapshot's server tick; -1 means absent and Long.MAX_VALUE means
 * permanent. Healing inventory is availability, not health already received.
 */
public record TraversalState(
    boolean maySprint,
    double safeFallDistance,
    double fallDamageMultiplier,
    int fallProtectionPoints,
    int resistanceAmplifier,
    long resistanceUntilTick,
    long noFallUntilTick,
    long slowFallingUntilTick,
    int healingConsumables,
    int regenerationAmplifier,
    long regenerationUntilTick,
    int jumpBoostAmplifier,
    long jumpBoostUntilTick,
    double maxHealth) {
  /** Explicit ordinary vanilla capabilities for synthetic bodies only. */
  public static final TraversalState UNMODIFIED =
      new TraversalState(true, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20);

  public TraversalState {
    if (!Double.isFinite(maxHealth) || maxHealth <= 0)
      throw new IllegalArgumentException("Maximum health must be positive and finite");
    if (!Double.isFinite(safeFallDistance)
        || safeFallDistance < 0
        || !Double.isFinite(fallDamageMultiplier)
        || fallDamageMultiplier < 0
        || fallProtectionPoints < 0
        || fallProtectionPoints > 20
        || healingConsumables < 0)
      throw new IllegalArgumentException("Invalid traversal capabilities");
    effect(resistanceAmplifier, resistanceUntilTick);
    effect(regenerationAmplifier, regenerationUntilTick);
    effect(jumpBoostAmplifier, jumpBoostUntilTick);
    if (noFallUntilTick < -1 || slowFallingUntilTick < -1)
      throw new IllegalArgumentException("Invalid traversal expiry");
  }

  private static void effect(int amplifier, long untilTick) {
    if (amplifier < -1 || untilTick < -1 || (amplifier == -1) != (untilTick == -1))
      throw new IllegalArgumentException("Effect amplifier and expiry disagree");
  }
}
