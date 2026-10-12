// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/damage/CustomDamageEvent.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.util.List;
import java.util.Optional;

/**
 * Red Warfare's damage pipeline as one pure function.
 *
 * <p>For a melee hit the weapon's Sharpness adds {@code 1.25 × level}. Unless the attack ignores
 * armor, the armor rating takes {@code rating / 25} of that off. Then Protection enchantments take
 * {@code total / 25} of what remains off (fire, blast, projectile and feather falling apply even to
 * attacks that ignore armor, as the original computed them). Finally one multiplier, if any, scales
 * the result. This is the steady-state value the original reached after its event handlers had all
 * asked {@code getDamage()}.
 */
public final class DamageFormula {

  /** Extra damage per Sharpness level. */
  public static final double SHARPNESS_PER_LEVEL = 1.25;

  private DamageFormula() {}

  /** The damage dealt by {@code hit} before the hit window is applied. */
  public static double finalDamage(Hit hit) {
    var damage = hit.baseDamage() + sharpness(hit);
    if (!hit.attack().has(AttackType.Flag.IGNORE_ARMOR)) {
      damage -= damage * (ArmorRating.rating(hit.victimArmor()) / 25D);
    }
    damage -= damage * (ArmorRating.protection(hit.victimArmor(), hit.attack()) / 25D);
    return Math.max(0, damage * hit.multiplier());
  }

  private static double sharpness(Hit hit) {
    if (!hit.attack().has(AttackType.Flag.MELEE) || hit.weapon().isEmpty()) {
      return 0;
    }
    return SHARPNESS_PER_LEVEL * hit.weapon().orElseThrow().enchantmentLevel("sharpness");
  }

  /**
   * One instance of damage.
   *
   * @param attack the kind of damage
   * @param baseDamage the raw damage; for melee, {@link WeaponDamage#of} of the held item
   * @param weapon the held item for melee hits, whose Sharpness counts
   * @param victimArmor what the victim wears
   * @param multiplier a kit's single damage multiplier, 1 when there is none
   */
  public record Hit(
      AttackType attack,
      double baseDamage,
      Optional<ItemSpec> weapon,
      List<ItemSpec> victimArmor,
      double multiplier) {

    public Hit {
      if (baseDamage < 0 || multiplier < 0) {
        throw new IllegalArgumentException("damage and multiplier must not be negative");
      }
      victimArmor = List.copyOf(victimArmor);
    }

    /** A melee swing with {@code weapon} at someone wearing {@code victimArmor}. */
    public static Hit melee(ItemSpec weapon, List<ItemSpec> victimArmor) {
      return new Hit(
          AttackType.MELEE,
          WeaponDamage.of(weapon.material()),
          Optional.of(weapon),
          victimArmor,
          1);
    }

    /** Any other damage of {@code amount}. */
    public static Hit of(AttackType attack, double amount, List<ItemSpec> victimArmor) {
      return new Hit(attack, amount, Optional.empty(), victimArmor, 1);
    }
  }
}
