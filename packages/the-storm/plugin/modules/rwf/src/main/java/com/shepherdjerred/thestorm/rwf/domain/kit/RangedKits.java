package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The kits that fight with a bow, crossbow or trident, and whether their ammunition runs out. An
 * Infinity bow never runs out; a crossbow, or a bow without Infinity, has only the arrows its kit
 * carries; a Loyalty trident comes back. Offline tools read this list, exported to {@code
 * rwf-ranged-kits.json} beside the module's tests, to judge archers by their ammunition.
 */
public final class RangedKits {

  /** The ranged weapon a kit fights with. */
  public enum Weapon {
    BOW,
    CROSSBOW,
    TRIDENT,
  }

  /** How a ranged kit's ammunition lasts. */
  public enum Ammo {
    /** An Infinity bow: one arrow that is never used up. */
    INFINITE,
    /** Arrows the kit carries and spends: a crossbow's, or a bow's without Infinity. */
    FINITE,
    /** A Loyalty trident, which returns after each throw. */
    RETURNING,
  }

  /**
   * One ranged kit.
   *
   * @param kit the kit id
   * @param weapon its ranged weapon
   * @param ammo how its ammunition lasts
   * @param arrows the arrows a {@link Ammo#FINITE} kit starts with; 0 otherwise
   */
  public record Ranged(String kit, Weapon weapon, Ammo ammo, int arrows) {}

  private static final Set<String> WEAPONS = Set.of("BOW", "CROSSBOW", "TRIDENT");
  private static final Set<String> ARROWS = Set.of("ARROW", "TIPPED_ARROW", "SPECTRAL_ARROW");

  private RangedKits() {}

  /** The ranged kits among {@code kits}, in their order. */
  public static List<Ranged> of(List<KitSpec> kits) {
    return kits.stream().flatMap(kit -> ranged(kit).stream()).toList();
  }

  private static Optional<Ranged> ranged(KitSpec kit) {
    var weapon =
        kit.hotbar().stream().filter(item -> WEAPONS.contains(item.material())).findFirst();
    if (weapon.isEmpty()) {
      return Optional.empty();
    }
    var item = weapon.orElseThrow();
    var arrows =
        kit.hotbar().stream()
            .filter(spec -> ARROWS.contains(spec.material()))
            .mapToInt(ItemSpec::amount)
            .sum();
    return Optional.of(
        switch (item.material()) {
          case "TRIDENT" ->
              item.enchantmentLevel("loyalty") > 0
                  ? new Ranged(kit.id(), Weapon.TRIDENT, Ammo.RETURNING, 0)
                  : new Ranged(kit.id(), Weapon.TRIDENT, Ammo.FINITE, 1);
          case "BOW" ->
              item.enchantmentLevel("infinity") > 0
                  ? new Ranged(kit.id(), Weapon.BOW, Ammo.INFINITE, 0)
                  : new Ranged(kit.id(), Weapon.BOW, Ammo.FINITE, arrows);
          default -> new Ranged(kit.id(), Weapon.CROSSBOW, Ammo.FINITE, arrows);
        });
  }
}
