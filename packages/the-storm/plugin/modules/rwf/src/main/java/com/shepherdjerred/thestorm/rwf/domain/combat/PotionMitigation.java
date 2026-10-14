package com.shepherdjerred.thestorm.rwf.domain.combat;

/** Resistance reduces authoritative custom damage once, after the kit and armour rules. */
public final class PotionMitigation {
  private PotionMitigation() {}

  public static double resistance(double damage, int amplifier, AttackType type) {
    if (amplifier < 0
        || type.has(AttackType.Flag.INSTANT_DEATH)
        || type.equals(AttackType.VOID)
        || type.equals(AttackType.VOID_PUSHED)
        || type.equals(AttackType.VOID_SHOT)
        || type.equals(AttackType.STARVATION)) return damage;
    return damage * Math.max(0, 1 - 0.2 * (amplifier + 1));
  }
}
