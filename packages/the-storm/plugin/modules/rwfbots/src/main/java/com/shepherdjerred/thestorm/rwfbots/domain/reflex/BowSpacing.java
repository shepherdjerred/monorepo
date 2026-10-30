package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;

/**
 * How a bow kit keeps a sword at a distance. In production bow-kit bots got most of their kills in
 * melee (the longbow 10 of 12): an archer backed away from a sword without drawing, then turned to
 * its sword once the enemy was 6 blocks off. A bow kit now holds a sword at {@link #SWORD_NEAR}
 * blocks or more, backs off drawing when it comes closer, and takes out its own sword only within
 * {@link Reflex#BOW_KEEP_RANGE}.
 */
public final class BowSpacing {

  /** A bow kit backs off a sword closer than this, drawing as it goes. */
  public static final double SWORD_NEAR = 8;

  /** How much of a back-off step goes straight away from the sword; the rest goes across. */
  static final double AWAY = 1.0;

  static final double ACROSS = 0.35;

  private BowSpacing() {}

  /** Whether {@code enemy} fights with a sword alone, so has to close in to hurt the archer. */
  public static boolean sword(CombatantView enemy) {
    return !enemy.kit().hasBow();
  }

  /** The near edge of a bow kit's band against {@code enemy}, from its kit's {@code keepMin}. */
  public static double nearEdge(double keepMin, CombatantView enemy) {
    return sword(enemy) ? Math.min(keepMin, SWORD_NEAR) : keepMin;
  }

  /**
   * Whether {@code self} backs off {@code enemy} as it draws: a sword inside {@link #SWORD_NEAR}.
   */
  static boolean backsOff(CombatantView self, CombatantView enemy) {
    return sword(enemy) && enemy.pos().distance(self.pos()) < SWORD_NEAR;
  }
}
