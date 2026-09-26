package com.shepherdjerred.thestorm.mobs.domain.scaling;

/** What a level makes stronger or larger. */
public enum Stat {
  /** Maximum health, as a share of the mob's base health. */
  MAX_HEALTH(Kind.SHARE),
  /** Melee damage, as a share of the mob's base attack damage. */
  ATTACK_DAMAGE(Kind.SHARE),
  /** Damage from the mob's arrows, tridents and other projectiles, as a share. */
  RANGED_DAMAGE(Kind.SHARE),
  /** Damage from a creeper's blast, as a share. */
  CREEPER_BLAST(Kind.SHARE),
  /** Walking speed, as a share of the mob's base speed. */
  MOVEMENT_SPEED(Kind.SHARE),
  /** Armor points added. */
  ARMOR(Kind.POINTS),
  /** Armor toughness points added. */
  ARMOR_TOUGHNESS(Kind.POINTS),
  /** Experience dropped when a player earns the kill, as a share. */
  XP(Kind.SHARE),
  /**
   * Extra rolls of the mob's own loot table when a player earns the kill: 0.5 is one extra roll
   * half the time.
   */
  ITEM_DROPS(Kind.SHARE);

  /** How a stat's value is read. */
  public enum Kind {
    /** A share of the base value added at the cap: 1.1 means 2.1 times the base. */
    SHARE,
    /** Flat points added at the cap. */
    POINTS
  }

  private final Kind kind;

  Stat(Kind kind) {
    this.kind = kind;
  }

  public Kind kind() {
    return kind;
  }
}
