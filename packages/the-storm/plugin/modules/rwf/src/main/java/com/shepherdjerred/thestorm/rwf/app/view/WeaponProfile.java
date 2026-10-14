package com.shepherdjerred.thestorm.rwf.app.view;

import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.util.Objects;

/** RWF's weapon capabilities, exported to body controllers without exposing Paper items. */
public record WeaponProfile(
    Kind kind, double minReach, double maxReach, int chargeTicks, double projectileSpeed) {

  public enum Kind {
    NONE,
    LEGACY_MELEE,
    BOW,
    CROSSBOW,
    TRIDENT,
    SPEAR,
    MACE
  }

  public WeaponProfile {
    Objects.requireNonNull(kind);
    if (!(Double.isFinite(minReach)
            && Double.isFinite(maxReach)
            && minReach >= 0
            && maxReach >= minReach)
        || chargeTicks < 0
        || !Double.isFinite(projectileSpeed)
        || projectileSpeed < 0) {
      throw new IllegalArgumentException("invalid weapon capabilities");
    }
  }

  public boolean nativeMelee() {
    return kind == Kind.SPEAR || kind == Kind.TRIDENT || kind == Kind.MACE;
  }

  public boolean ranged() {
    return kind == Kind.BOW || kind == Kind.CROSSBOW || kind == Kind.TRIDENT;
  }

  /** Capabilities of the exact item in the authoritative kit catalog. */
  public static WeaponProfile of(ItemSpec item) {
    var material = item.material();
    if (material.endsWith("_SPEAR")) {
      return new WeaponProfile(Kind.SPEAR, 2, 4.5, 0, 0);
    }
    return switch (material) {
      case "BOW" -> new WeaponProfile(Kind.BOW, 0, 3, 20, 3);
      case "CROSSBOW" ->
          new WeaponProfile(
              Kind.CROSSBOW,
              0,
              3,
              Math.max(1, 25 - 5 * item.enchantmentLevel("quick_charge")),
              3.15);
      case "TRIDENT" -> new WeaponProfile(Kind.TRIDENT, 0, 3, 10, 2.5);
      case "MACE" -> new WeaponProfile(Kind.MACE, 0, 3, 0, 0);
      default ->
          new WeaponProfile(
              material.endsWith("_SWORD") || material.endsWith("_AXE")
                  ? Kind.LEGACY_MELEE
                  : Kind.NONE,
              0,
              3,
              0,
              0);
    };
  }
}
