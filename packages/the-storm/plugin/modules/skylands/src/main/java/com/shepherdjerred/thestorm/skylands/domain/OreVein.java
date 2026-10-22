package com.shepherdjerred.thestorm.skylands.domain;

import java.util.regex.Pattern;

/**
 * One kind of ore vein the islands carry beyond what vanilla's height bands reach.
 *
 * @param block the ore block key, e.g. {@code minecraft:diamond_ore}
 * @param attempts vein starts tried per chunk; a start that lands in the void places nothing, so
 *     the ore follows the islands' stone
 * @param size blocks a vein tries to place
 * @param minY lowest Beta terrain y a vein starts at (island cores sit at the bottom)
 * @param maxY highest Beta terrain y a vein starts at
 */
public record OreVein(String block, int attempts, int size, int minY, int maxY) {

  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

  public OreVein {
    if (!KEY.matcher(block).matches()) {
      throw new IllegalArgumentException("ore block must be a namespaced key: " + block);
    }
    if (attempts < 1 || attempts > 64) {
      throw new IllegalArgumentException("ore attempts must be 1-64: " + attempts);
    }
    if (size < 1 || size > 32) {
      throw new IllegalArgumentException("ore vein size must be 1-32: " + size);
    }
    if (minY < 0 || maxY >= SkyTerrain.HEIGHT || minY > maxY) {
      throw new IllegalArgumentException(
          "ore y range must lie in 0-" + (SkyTerrain.HEIGHT - 1) + ": " + minY + ".." + maxY);
    }
  }
}
