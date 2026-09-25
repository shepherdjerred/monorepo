package com.shepherdjerred.thestorm.mechanics.domain.config;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;

/** Invariant checks shared by the config records. */
final class Checks {

  /** The highest level in every track (mirrors the tracks module). */
  static final int MAX_LEVEL = 5;

  private Checks() {}

  static int range(String name, int value, int min, int max) {
    if (value < min || value > max) {
      throw new IllegalArgumentException(
          name + " must be between " + min + " and " + max + ": " + value);
    }
    return value;
  }

  static double range(String name, double value, double min, double max) {
    if (!(value >= min && value <= max)) {
      throw new IllegalArgumentException(
          name + " must be between " + min + " and " + max + ": " + value);
    }
    return value;
  }

  /** A non-empty set of distinct, well-formed material keys, in the order written. */
  static List<String> materials(String name, Collection<String> materials) {
    if (materials.isEmpty()) {
      throw new IllegalArgumentException(name + " must list at least one block");
    }
    var set = new LinkedHashSet<String>();
    for (var material : materials) {
      Cell.requireMaterialKey(material);
      if (!set.add(material)) {
        throw new IllegalArgumentException(name + " lists " + material + " twice");
      }
    }
    return List.copyOf(set);
  }
}
