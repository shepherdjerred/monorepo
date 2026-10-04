// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/damage/CustomDamageEvent.java,
// recalculateKnockback, and redwarfare-core/src/me/libraryaddict/core/damage/DamageManager.java,
// createEvent);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.random.RandomGenerator;

/**
 * Knockback as Red Warfare computed it.
 *
 * <p>The victim keeps half their velocity and is pushed {@code 0.4} away from the attacker and
 * {@code 0.4} up. Each knockback level (one for a sprinting attacker, plus the weapon's Knockback
 * enchantment) adds {@code level / 2} away and {@code 0.1} up. Arrows add {@code punch × 0.6} along
 * the existing push. Any knockback longer than {@code 0.1} is lifted to at least {@code 0.1} up. A
 * sprinting attacker stops sprinting and keeps only {@code 0.6} of their horizontal speed.
 */
public final class Knockback {

  public static final double BASE_PUSH = 0.4;
  public static final double BASE_LIFT = 0.4;
  public static final double LEVEL_LIFT = 0.1;
  public static final double ARROW_PUSH_PER_PUNCH = 0.6;
  public static final double MIN_LIFT = 0.1;

  /** What is left of a sprinting attacker's horizontal velocity after they hit. */
  public static final double SPRINT_RESET = 0.6;

  /** Below this squared horizontal distance the direction is jittered at random. */
  private static final double DEGENERATE = 0.0001;

  private Knockback() {}

  /** The victim's new velocity. One random draw pair is used only for a degenerate offset. */
  public static Vec3 compute(Params params, RandomGenerator random) {
    var dx = params.attacker().x() - params.victim().x();
    var dz = params.attacker().z() - params.victim().z();
    while (!Double.isFinite(dx * dx + dz * dz) || dx * dx + dz * dz < DEGENERATE) {
      dx = random.nextDouble(-0.01, 0.01);
      dz = random.nextDouble(-0.01, 0.01);
    }
    var dist = Math.sqrt(dx * dx + dz * dz);
    var result = Vec3.ZERO;
    if (params.calculateBase()) {
      result =
          params
              .victimVelocity()
              .scaled(0.5)
              .plus(new Vec3(-(dx / dist * BASE_PUSH), BASE_LIFT, -(dz / dist * BASE_PUSH)));
    }
    if (params.level() != 0) {
      var push = params.level() / 2D;
      result = result.plus(new Vec3(-(dx / dist * push), LEVEL_LIFT, -(dz / dist * push)));
    }
    return finish(result);
  }

  /** The extra push an arrow with {@code punch} adds along {@code knockback}. */
  public static Vec3 arrow(Vec3 knockback, int punch) {
    var dist = Math.sqrt(knockback.x() * knockback.x() + knockback.z() * knockback.z());
    if (punch <= 0 || dist <= 0) {
      return Vec3.ZERO;
    }
    var factor = punch * ARROW_PUSH_PER_PUNCH / dist;
    return new Vec3(knockback.x() * factor, LEVEL_LIFT, knockback.z() * factor);
  }

  /** Lifts any real knockback to at least {@link #MIN_LIFT}. */
  public static Vec3 finish(Vec3 knockback) {
    if (knockback.length() > MIN_LIFT && knockback.y() <= MIN_LIFT) {
      return knockback.withY(MIN_LIFT);
    }
    return knockback;
  }

  /** A sprinting attacker's velocity after landing a hit. */
  public static Vec3 sprintReset(Vec3 attackerVelocity) {
    return new Vec3(
        attackerVelocity.x() * SPRINT_RESET,
        attackerVelocity.y(),
        attackerVelocity.z() * SPRINT_RESET);
  }

  /**
   * One hit's knockback inputs.
   *
   * @param attacker where the attacker (or projectile) is
   * @param victim where the victim is
   * @param victimVelocity the victim's velocity now
   * @param level knockback levels: 1 for a sprinting attacker plus the Knockback enchantment
   * @param calculateBase whether the base push applies (false when a fixed knockback was set)
   */
  public record Params(
      Vec3 attacker, Vec3 victim, Vec3 victimVelocity, int level, boolean calculateBase) {

    /** A plain melee or projectile hit. */
    public static Params hit(Vec3 attacker, Vec3 victim, Vec3 victimVelocity, int level) {
      return new Params(attacker, victim, victimVelocity, level, true);
    }
  }
}
