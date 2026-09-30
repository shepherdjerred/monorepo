package com.shepherdjerred.thestorm.shards.domain;

import java.util.EnumMap;
import java.util.Map;

/** Damage bonuses for every weapon category. Every category must be configured. */
public record WeaponTables(
    GearTable sword,
    GearTable axe,
    GearTable mace,
    GearTable spear,
    GearTable trident,
    GearTable bow,
    GearTable crossbow) {

  /** The tables keyed by category. */
  public Map<GearCategory, GearTable> byCategory() {
    var tables = new EnumMap<GearCategory, GearTable>(GearCategory.class);
    tables.put(GearCategory.SWORD, sword);
    tables.put(GearCategory.AXE, axe);
    tables.put(GearCategory.MACE, mace);
    tables.put(GearCategory.SPEAR, spear);
    tables.put(GearCategory.TRIDENT, trident);
    tables.put(GearCategory.BOW, bow);
    tables.put(GearCategory.CROSSBOW, crossbow);
    return tables;
  }
}
