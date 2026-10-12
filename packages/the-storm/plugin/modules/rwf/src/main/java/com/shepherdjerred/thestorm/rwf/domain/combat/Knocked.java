// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/condition/types/ConditionFall.java and
// ConditionManager.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import java.time.Duration;
import java.time.Instant;

/**
 * Red Warfare's "Fall" condition: a fighter knocked by another member's hit keeps that hit on
 * record while they fly, so a fall or a drop into the void is theirs. World damage taken in between
 * (fire, the border) does not clear it. It lasts at most {@link #LASTS}, and ends sooner once the
 * fighter has settled: on the ground, no longer falling, and {@link #SETTLE_STILL} (when barely
 * moving) or {@link #SETTLE} after the hit.
 *
 * @param how the hit that knocked them: melee or a projectile
 * @param at when
 */
public record Knocked(AttackType how, Instant at) {

  /** The condition's own duration: 200 ticks. */
  public static final Duration LASTS = Duration.ofSeconds(10);

  /** How long after the hit a grounded fighter who is barely moving is settled. */
  public static final Duration SETTLE_STILL = Duration.ofMillis(500);

  /** How long after the hit a grounded fighter who is still moving is settled. */
  public static final Duration SETTLE = Duration.ofSeconds(5);

  /** Below this speed, in blocks a tick, a fighter is barely moving. */
  public static final double STILL_SPEED = 0.05;

  /**
   * Whether the condition has ended at {@code now} for a fighter who is {@code grounded}, has
   * fallen {@code fallDistance} so far, and moves at {@code speed}.
   */
  public boolean expired(Instant now, boolean grounded, double fallDistance, double speed) {
    if (now.isAfter(at.plus(LASTS))) {
      return true;
    }
    var settle = speed < STILL_SPEED ? SETTLE_STILL : SETTLE;
    return fallDistance <= 0 && grounded && now.isAfter(at.plus(settle));
  }

  /** A fall while knocked: shot or pushed. */
  public AttackType fall() {
    return how.has(AttackType.Flag.PROJECTILE) ? AttackType.FALL_SHOT : AttackType.FALL_PUSHED;
  }

  /** A drop into the void while knocked: shot or pushed. */
  public AttackType intoVoid() {
    return how.has(AttackType.Flag.PROJECTILE) ? AttackType.VOID_SHOT : AttackType.VOID_PUSHED;
  }
}
