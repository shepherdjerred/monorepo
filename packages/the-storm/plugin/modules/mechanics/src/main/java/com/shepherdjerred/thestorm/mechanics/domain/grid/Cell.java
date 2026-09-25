package com.shepherdjerred.thestorm.mechanics.domain.grid;

import java.util.regex.Pattern;

/**
 * What occupies one block position.
 *
 * @param material the namespaced material key, for example {@code minecraft:oak_planks}
 * @param shape how the space behaves
 * @param mobility how vanilla pistons treat it
 * @param fixed the block holds data a move would lose (a block entity such as a chest, spawner or
 *     sign) or cannot be broken at all (bedrock, barrier); mechanisms never move or break it
 */
public record Cell(String material, Shape shape, Mobility mobility, boolean fixed) {

  /** The material key a mechanism leaves behind when it removes a block. */
  public static final String AIR = "minecraft:air";

  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

  public Cell {
    requireMaterialKey(material);
  }

  /** An empty cell. */
  public static Cell air() {
    return new Cell(AIR, Shape.EMPTY, Mobility.NORMAL, false);
  }

  /** An ordinary solid block of {@code material}. */
  public static Cell solid(String material) {
    return new Cell(material, Shape.SOLID, Mobility.NORMAL, false);
  }

  public boolean is(String otherMaterial) {
    return material.equals(otherMaterial);
  }

  /** Validates a namespaced material key such as {@code minecraft:stone}. */
  public static String requireMaterialKey(String material) {
    if (!KEY.matcher(material).matches()) {
      throw new IllegalArgumentException(
          "not a namespaced material key like minecraft:stone: '" + material + "'");
    }
    return material;
  }
}
