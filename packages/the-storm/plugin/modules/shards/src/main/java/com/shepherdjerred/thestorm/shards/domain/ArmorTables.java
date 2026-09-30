package com.shepherdjerred.thestorm.shards.domain;

import java.util.EnumMap;
import java.util.Map;

/** Damage reductions for every armor slot. Every slot must be configured. */
public record ArmorTables(
    GearTable helmet, GearTable chestplate, GearTable leggings, GearTable boots) {

  /** The tables keyed by category. */
  public Map<GearCategory, GearTable> byCategory() {
    var tables = new EnumMap<GearCategory, GearTable>(GearCategory.class);
    tables.put(GearCategory.HELMET, helmet);
    tables.put(GearCategory.CHESTPLATE, chestplate);
    tables.put(GearCategory.LEGGINGS, leggings);
    tables.put(GearCategory.BOOTS, boots);
    return tables;
  }
}
