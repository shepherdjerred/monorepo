// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/explosion/CustomExplosion.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability;

import java.util.OptionalDouble;

/**
 * Red Warfare's explosion damage, before armor: within {@code power} blocks of the centre, with
 * {@code d = 1 − distance / power} scaled by how much of the target the blast can see, a target
 * takes {@code ⌊(d² + d) / 2 × 8 × power + 1⌋}, never more than the explosion's cap.
 */
public final class ExplosionDamage {

  private ExplosionDamage() {}

  /**
   * The damage an explosion deals a target, or empty when it is out of reach.
   *
   * @param distance from the centre to the target's feet
   * @param power the explosion's size
   * @param exposure the share of the target the blast can see, 0 to 1
   * @param most the explosion's damage cap
   */
  public static OptionalDouble of(double distance, float power, double exposure, double most) {
    if (power <= 0) {
      return OptionalDouble.empty();
    }
    var reach = distance / power;
    if (reach > 1) {
      return OptionalDouble.empty();
    }
    var d = (1 - reach) * Math.clamp(exposure, 0, 1);
    var damage = (int) ((d * d + d) / 2 * 8 * power + 1);
    return OptionalDouble.of(Math.min(damage, most));
  }
}
