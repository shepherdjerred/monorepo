// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/damage/DamageManager.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

/**
 * Red Warfare's take on invulnerability frames. While a victim is in the second half of their
 * no-damage window (more than half of {@link CombatRules#MAX_NO_DAMAGE_TICKS} ticks left), a hit no
 * stronger than the last is blocked and a stronger one deals only the difference. Attacks that
 * ignore the rate, and instant deaths, always land in full.
 */
public final class HitWindow {

  /** A hit must beat the last by more than this to count inside the window. */
  public static final double EPSILON = 0.001;

  private HitWindow() {}

  /** What {@code damage} does to a victim in {@code guard}. */
  public static Resolution resolve(double damage, AttackType attack, Guard guard) {
    if (attack.has(AttackType.Flag.IGNORE_RATE) || attack.has(AttackType.Flag.INSTANT_DEATH)) {
      return new Resolution.Full(damage);
    }
    if (!guard.inWindow()) {
      return new Resolution.Full(damage);
    }
    if (damage <= guard.lastDamage() + EPSILON) {
      return new Resolution.Blocked();
    }
    return new Resolution.Partial(damage - guard.lastDamage());
  }

  /**
   * Whether an attacker may land {@code damage} on a victim they hit {@code ticksSinceHit} ticks
   * ago for {@code previous}: not within half the window, and not for no more than before.
   */
  public static boolean canHit(int ticksSinceHit, double previous, double damage) {
    if (ticksSinceHit <= CombatRules.MAX_NO_DAMAGE_TICKS / 2F) {
      return false;
    }
    return damage > previous + EPSILON;
  }

  /**
   * The victim's invulnerability state.
   *
   * @param noDamageTicks ticks of invulnerability left
   * @param lastDamage the damage that started the window
   */
  public record Guard(int noDamageTicks, double lastDamage) {

    public static final Guard NONE = new Guard(0, 0);

    public Guard {
      if (noDamageTicks < 0 || lastDamage < 0) {
        throw new IllegalArgumentException("ticks and damage must not be negative");
      }
    }

    /** Whether more than half the window is left. */
    public boolean inWindow() {
      return noDamageTicks > CombatRules.MAX_NO_DAMAGE_TICKS / 2.0F;
    }

    /** The guard after a full hit of {@code damage} lands. */
    public Guard afterFullHit(double damage) {
      return new Guard(CombatRules.MAX_NO_DAMAGE_TICKS, damage);
    }

    /**
     * The guard after a partial hit raises the damage to {@code damage}; the window is not reset.
     */
    public Guard afterPartialHit(double damage) {
      return new Guard(noDamageTicks, damage);
    }
  }

  /** What a hit does. */
  public sealed interface Resolution {

    /** The whole hit lands and a fresh window starts. */
    record Full(double damage) implements Resolution {}

    /** Only the amount by which this hit beats the last lands; the window is not reset. */
    record Partial(double extra) implements Resolution {}

    /** Nothing lands (though a melee hit is still logged). */
    record Blocked() implements Resolution {}
  }
}
