package com.shepherdjerred.thestorm.mechanics.domain;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;

/** How materials and positions read in player-facing text. */
public final class Names {

  private Names() {}

  /** {@code minecraft:oak_planks} reads as {@code oak planks}. */
  public static String material(String key) {
    var colon = key.indexOf(':');
    return key.substring(colon + 1).replace('_', ' ');
  }

  /** {@code 3 oak planks}, {@code 1 oak planks}: counts read as plain numbers. */
  public static String count(int count, String key) {
    return count + " " + material(key);
  }

  public static String pos(Pos pos) {
    return pos.x() + ", " + pos.y() + ", " + pos.z();
  }
}
