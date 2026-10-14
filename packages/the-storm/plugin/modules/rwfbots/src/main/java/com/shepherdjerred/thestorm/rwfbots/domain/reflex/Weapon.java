package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import java.util.Objects;

/** Pure body-controller capabilities copied from RWF's authoritative item profile at admission. */
public record Weapon(
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

  public static final Weapon LEGACY = new Weapon(Kind.LEGACY_MELEE, 0, 3, 0, 0);
  public static final Weapon BOW = new Weapon(Kind.BOW, 0, 3, 20, 3);
  public static final Weapon NONE = new Weapon(Kind.NONE, 0, 3, 0, 0);

  public Weapon {
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
}
